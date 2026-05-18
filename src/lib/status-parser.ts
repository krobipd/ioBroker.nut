/** Parsed status flags with individual booleans and computed severity. */
export interface StatusResult {
  /** Raw status string (e.g. "OL CHRG") */
  raw: string;
  /** Individual boolean flags */
  flags: Record<string, boolean>;
  /** Computed severity: 0=OK, 1=Info, 2=Warning, 3=Critical, 4=Emergency */
  severity: number;
}

/** Map of NUT status flags to human-readable boolean state names. */
export const STATUS_FLAGS: Record<string, string> = {
  OL: "online",
  OB: "onBattery",
  LB: "lowBattery",
  HB: "highBattery",
  RB: "replaceBattery",
  CHRG: "charging",
  DISCHRG: "discharging",
  BYPASS: "bypass",
  CAL: "calibrating",
  OFF: "off",
  OVER: "overloaded",
  TRIM: "trimming",
  BOOST: "boosting",
  FSD: "forcedShutdown",
  ALARM: "alarm",
  COMM: "commEstablished",
  NOCOMM: "commLost",
  TEST: "testing",
};

/** All known flag keys for creating default-false states. */
export const ALL_FLAG_KEYS = Object.values(STATUS_FLAGS);

/**
 * Parse ups.status space-separated flags into individual booleans and severity.
 *
 * @param rawStatus Raw ups.status value (e.g. "OL CHRG")
 */
export function parseStatus(rawStatus: string): StatusResult {
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
    const name = STATUS_FLAGS[token];
    if (name) {
      flags[name] = true;
      activeTokens.add(token);
    }
  }

  const severity = computeSeverity(activeTokens);

  return { raw: rawStatus, flags, severity };
}

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
