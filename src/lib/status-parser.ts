import type { I18nKey } from "./i18n";

/** Parsed status flags with individual booleans and computed severity. */
export interface StatusResult {
  /** Raw status string (e.g. "OL CHRG") */
  raw: string;
  /** Individual boolean flags */
  flags: Record<string, boolean>;
  /** Computed severity: 0=OK, 1=Info, 2=Warning, 3=Critical, 4=Emergency */
  severity: number;
}

/** One status-flag definition. Single source of truth for token, flag id, label, i18n key and role. */
interface StatusFlagDef {
  /** NUT ups.status token */
  token: string;
  /** ioBroker boolean state id (leaf under status.) */
  flag: string;
  /** Human-readable display label */
  label: string;
  /** admin/i18n key for the state name */
  i18nKey: I18nKey;
  /** ioBroker state role */
  role: string;
}

// Authoritative ups.status flag catalog, verified against the bundled NUT 2.8.5 source
// (`grep status_set(` across drivers/) and docs/new-drivers.txt. Documented standard set:
// the 14 core tokens (OL..FSD) + ALARM (set internally by alarm_set, not status_set) +
// WAIT (upsd's initial value while a driver connects). Non-documented but real extras
// emitted by multiple shipped drivers are also mapped: TEST (5 drivers incl. apc_modbus,
// powercom), OVERHEAT (belkinunv, microsol), and ECO (emerging eco-mode, real on Eaton
// Ellipse ECO; legacy name "HE" aliased via STATUS_ALIASES). Driver-private one-off tokens
// (ACFAIL/COMMFAULT/DEPLETED/BY/TIP/SD — mostly "self-invented" in a single driver) are
// intentionally NOT mapped: per new-drivers.txt clients MAY ignore unidentified tokens, and
// any such token still appears verbatim in status.raw / status.display.
const STATUS_CATALOG: StatusFlagDef[] = [
  { token: "OL", flag: "online", label: "Online", i18nKey: "flagOnline", role: "indicator" },
  { token: "OB", flag: "onBattery", label: "On Battery", i18nKey: "flagOnBattery", role: "indicator.alarm" },
  { token: "LB", flag: "lowBattery", label: "Low Battery", i18nKey: "flagLowBattery", role: "indicator.lowbat" },
  { token: "HB", flag: "highBattery", label: "High Battery", i18nKey: "flagHighBattery", role: "indicator" },
  {
    token: "RB",
    flag: "replaceBattery",
    label: "Replace Battery",
    i18nKey: "flagReplaceBattery",
    role: "indicator.maintenance",
  },
  { token: "CHRG", flag: "charging", label: "Charging", i18nKey: "flagCharging", role: "indicator" },
  { token: "DISCHRG", flag: "discharging", label: "Discharging", i18nKey: "flagDischarging", role: "indicator" },
  { token: "BYPASS", flag: "bypass", label: "Bypass", i18nKey: "flagBypass", role: "indicator" },
  { token: "CAL", flag: "calibrating", label: "Calibrating", i18nKey: "flagCalibrating", role: "indicator" },
  { token: "OFF", flag: "off", label: "Off", i18nKey: "flagOff", role: "indicator" },
  { token: "OVER", flag: "overloaded", label: "Overloaded", i18nKey: "flagOverloaded", role: "indicator.alarm" },
  { token: "TRIM", flag: "trimming", label: "Trimming", i18nKey: "flagTrimming", role: "indicator" },
  { token: "BOOST", flag: "boosting", label: "Boosting", i18nKey: "flagBoosting", role: "indicator" },
  {
    token: "FSD",
    flag: "forcedShutdown",
    label: "Forced Shutdown",
    i18nKey: "flagForcedShutdown",
    role: "indicator.alarm",
  },
  { token: "ALARM", flag: "alarm", label: "Alarm", i18nKey: "flagAlarm", role: "indicator.alarm" },
  { token: "WAIT", flag: "waiting", label: "Waiting", i18nKey: "flagWaiting", role: "indicator" },
  { token: "ECO", flag: "ecoMode", label: "ECO Mode", i18nKey: "flagEcoMode", role: "indicator" },
  { token: "TEST", flag: "testing", label: "Testing", i18nKey: "flagTesting", role: "indicator" },
  { token: "OVERHEAT", flag: "overheat", label: "Overheated", i18nKey: "flagOverheat", role: "indicator.alarm" },
];

/** Legacy / alternative tokens mapped to a catalog token (e.g. legacy "HE" → "ECO"). */
const STATUS_ALIASES: Record<string, string> = {
  HE: "ECO",
};

/** token → flag id (incl. aliases). */
export const STATUS_FLAGS: Record<string, string> = {};
/** token → display label (incl. aliases). */
const DISPLAY_LABELS: Record<string, string> = {};
/** flag id → { i18nKey, role } (for state-manager). */
export const FLAG_META: Record<string, { i18nKey: I18nKey; role: string }> = {};
for (const d of STATUS_CATALOG) {
  STATUS_FLAGS[d.token] = d.flag;
  DISPLAY_LABELS[d.token] = d.label;
  FLAG_META[d.flag] = { i18nKey: d.i18nKey, role: d.role };
}
for (const [alias, token] of Object.entries(STATUS_ALIASES)) {
  STATUS_FLAGS[alias] = STATUS_FLAGS[token];
  DISPLAY_LABELS[alias] = DISPLAY_LABELS[token];
}

/** All known flag keys for creating default-false states (catalog order). */
export const ALL_FLAG_KEYS = STATUS_CATALOG.map(d => d.flag);

/**
 * Parse ups.status space-separated flags into individual booleans and severity.
 *
 * @param rawStatus Raw ups.status value (e.g. "OL CHRG")
 * @param chargerStatus Optional battery.charger.status value (modern NUT source for charging/discharging)
 */
export function parseStatus(rawStatus: string, chargerStatus?: string): StatusResult {
  const tokens = rawStatus
    .trim()
    .split(/\s+/)
    .filter(t => t.length > 0);

  const flags: Record<string, boolean> = {};
  for (const key of ALL_FLAG_KEYS) {
    flags[key] = false;
  }

  const activeTokens = new Set<string>();
  for (const token of tokens) {
    const flag = STATUS_FLAGS[token];
    if (flag) {
      flags[flag] = true;
      activeTokens.add(token);
    }
  }

  // Modern NUT exposes charging state via battery.charger.status instead of CHRG/DISCHRG
  // flags (e.g. Eaton Ellipse ECO). Derive charging/discharging from it when present.
  if (chargerStatus) {
    const cs = chargerStatus.trim().toLowerCase();
    if (cs === "charging") {
      flags.charging = true;
    } else if (cs === "discharging") {
      flags.discharging = true;
    }
    // "floating" (maintained) / "resting" (idle) → neither charging nor discharging
  }

  const severity = computeSeverity(activeTokens);

  return { raw: rawStatus, flags, severity };
}

/**
 * Convert raw ups.status to human-readable display string.
 *
 * @param rawStatus Raw ups.status value (e.g. "OL CHRG")
 */
export function getDisplayString(rawStatus: string): string {
  return rawStatus
    .trim()
    .split(/\s+/)
    .filter(t => t.length > 0)
    .map(t => DISPLAY_LABELS[t] ?? t)
    .join(", ");
}

// Severity reflects the POWER-SOURCE state only (OL → trimming → on battery → critical →
// forced shutdown). Fault flags such as OVER/ALARM/OFF are intentionally NOT folded in —
// they are exposed as their own booleans; conflating them here would dilute a single-meaning
// value. Design decision (krobi 2026-05-31), not an oversight.
function computeSeverity(tokens: Set<string>): number {
  if (tokens.has("FSD")) {
    return 4;
  }
  if (tokens.has("OB") && tokens.has("LB")) {
    return 3;
  }
  if (tokens.has("OB") || tokens.has("RB") || tokens.has("BYPASS")) {
    return 2;
  }
  if (tokens.has("TRIM") || tokens.has("BOOST") || tokens.has("CAL")) {
    return 1;
  }
  return 0;
}
