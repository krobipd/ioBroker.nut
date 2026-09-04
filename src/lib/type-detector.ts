import { parseDecimal } from "./coerce";

/** Known-string suffixes — always string regardless of numeric parsing. */
const KNOWN_STRING_SUFFIXES = new Set([
  "model",
  "mfr",
  "serial",
  "firmware",
  "status",
  "alarm",
  "date",
  "type",
  "id",
  "name",
  "desc",
  "location",
  "contact",
  "vendorid",
  "productid",
  // Opaque identifiers per the NUT catalog — keep as strings (leading zeros etc. must survive).
  "part",
  "address",
  "color",
  "groupid",
]);

/** Known-string exact prefixes — always string. */
const KNOWN_STRING_PREFIXES = ["driver.parameter.port", "driver.parameter.synchronous", "driver.version."];

/**
 * Countdown timers (`ups.timer.*`, `outlet[.n].timer.*`, `outlet.group.n.timer.*`). Drivers
 * disagree on how they say "no countdown running": the HID drivers report the raw `-1` (measured
 * on an Eaton Ellipse PRO 1600), apc_modbus converts it to the words `NotActive` and
 * `CountdownExpired` (drivers/apc_modbus.c). Both are mapped onto one meaning below.
 */
const TIMER_VARIABLE_RE = /(^|\.)timer\.(shutdown|start|reboot)$/;

/** Result of type detection for a NUT variable. */
export interface TypeDetectResult {
  /** ioBroker state type */
  type: "number" | "string" | "boolean";
  /** ioBroker state role */
  role: string;
  /** Unit string if applicable */
  unit?: string;
  /** Always true */
  read: true;
  /** Whether the variable is writable via SET VAR */
  write: boolean;
  /** Parsed value (number, string or boolean; null for a countdown that is not running) */
  parsedValue: number | string | boolean | null;
  /**
   * True when the variable name denotes a numeric quantity (carries a unit) but
   * the raw value is not a strict number (garbage / non-finite). The caller
   * should discard the value and warn once rather than store junk.
   */
  expectedNumeric?: boolean;
}

/**
 * Detect ioBroker state type, role, and unit from a NUT variable name and raw value.
 *
 * @param varName NUT variable name (e.g. battery.charge)
 * @param rawValue Raw string value from LIST VAR
 * @param isWritable Whether the variable appears in LIST RW
 */
export function detectType(varName: string, rawValue: string, isWritable: boolean): TypeDetectResult {
  // Trim at the boundary: NUT pads some fields (measured on an Eaton Ellipse PRO 1600, whose
  // device.model reads "Ellipse PRO 1600 " with a trailing space). A padded string would show up
  // in every UI and break every comparison; the numeric and yes/no parsers trim anyway, so this
  // only ever changes text values.
  rawValue = rawValue.trim();
  // driver.flag.* is a NUT-core on/off flag (nut-names.txt: "Flag xxx"), reported by drivers as
  // enabled/disabled or 0/1. Model it as a real boolean instead of dead text. Kept read-only: the
  // only writable one (allow_killpower, ST_FLAG_NUMBER) is a dangerous kill-power switch whose SET
  // wire token (1/0) differs from the boolean write path's yes/no — read-only avoids both a silent
  // SET failure and an accidental toggle. An unrecognised value is kept as an opaque string
  // (below), never guessed as a number.
  if (varName.startsWith("driver.flag.")) {
    const flag = parseFlagValue(rawValue);
    if (flag !== undefined) {
      return {
        type: "boolean",
        role: "indicator",
        unit: undefined,
        read: true,
        write: false,
        parsedValue: flag,
      };
    }
    // A flag reporting an unexpected value stays an opaque string. Do NOT fall through to the
    // numeric heuristic: a value like "2" must not become a number state and flip the state's
    // type between polls. "Don't guess" — the flag namespace is only ever on/off in practice.
    return {
      type: "string",
      role: "text",
      unit: undefined,
      read: true,
      write: false,
      parsedValue: rawValue,
    };
  }

  // A countdown that is not running is EMPTY, not "minus one second" — and the apc_modbus wording
  // must not be discarded as garbage in a numeric field (it would warn on every poll).
  if (TIMER_VARIABLE_RE.test(varName)) {
    const idle = rawValue.toLowerCase();
    // The role has to match what the RUNNING countdown gets from detectRole below, or a writable
    // timer would carry a different role depending on which value the first poll happened to see.
    const idleRole = detectRole(varName, "number", isWritable);
    if (idle === "notactive" || rawValue === "-1") {
      return { type: "number", role: idleRole, unit: "s", read: true, write: isWritable, parsedValue: null };
    }
    if (idle === "countdownexpired") {
      return { type: "number", role: idleRole, unit: "s", read: true, write: isWritable, parsedValue: 0 };
    }
  }

  if (isKnownString(varName)) {
    return {
      type: "string",
      role: detectRole(varName, "string", isWritable),
      unit: undefined,
      read: true,
      write: isWritable,
      parsedValue: rawValue,
    };
  }

  // A yes/no reading is a real boolean state, not a text dump — even when the variable name
  // carries a numeric-unit substring (e.g. input.frequency.extended = "no", ambient.n.present =
  // "yes"). Value-driven so it covers every driver's yes/no variables, not a hand-kept list.
  // After the known-string check so an opaque text field that happens to read "no" stays a string.
  const bool = parseYesNo(rawValue);
  if (bool !== undefined) {
    return {
      type: "boolean",
      role: isWritable ? "switch" : "indicator",
      unit: undefined,
      read: true,
      write: isWritable,
      parsedValue: bool,
    };
  }

  // Strict decimal only (same fleet line as the config coerce): garbage suffixes
  // ("12abc" → 12) and non-finite tokens ("Infinity" → null on setState) must NOT
  // become numbers — a number field never holds letters. Such values stay raw strings.
  const num = parseDecimal(rawValue);
  if (Number.isFinite(num)) {
    return {
      type: "number",
      role: detectRole(varName, "number", isWritable),
      unit: detectUnit(varName),
      read: true,
      write: isWritable,
      parsedValue: num,
    };
  }

  // Not a known string and not a strict number → opaque string. If the variable
  // name denotes a numeric quantity (carries a unit), the value is garbage for a
  // number field → flag it so the caller discards it and warns once.
  return {
    type: "string",
    role: detectRole(varName, "string", isWritable),
    unit: undefined,
    read: true,
    write: isWritable,
    parsedValue: rawValue,
    expectedNumeric: detectUnit(varName) !== undefined,
  };
}

/**
 * NUT yes/no fields become real boolean states (the point of the typed rewrite), not text.
 *
 * @param rawValue Raw string value from LIST VAR
 */
function parseYesNo(rawValue: string): boolean | undefined {
  const v = rawValue.trim().toLowerCase();
  if (v === "yes") {
    return true;
  }
  if (v === "no") {
    return false;
  }
  return undefined;
}

/**
 * driver.flag.* surfaces as a NUT-core on/off flag whose textual form varies by driver
 * (enabled | disabled | 0 | 1). Map it to boolean; anything else is not a flag we recognise.
 * Scoped to driver.flag.* so bare 0/1 stays numeric for every other variable.
 *
 * @param rawValue Raw string value from LIST VAR
 */
function parseFlagValue(rawValue: string): boolean | undefined {
  const v = rawValue.trim().toLowerCase();
  if (v === "enabled" || v === "on" || v === "yes" || v === "true" || v === "1") {
    return true;
  }
  if (v === "disabled" || v === "off" || v === "no" || v === "false" || v === "0") {
    return false;
  }
  return undefined;
}

function isKnownString(varName: string): boolean {
  const lastDot = varName.lastIndexOf(".");
  if (lastDot >= 0) {
    const suffix = varName.slice(lastDot + 1);
    if (KNOWN_STRING_SUFFIXES.has(suffix)) {
      return true;
    }
  }

  for (const prefix of KNOWN_STRING_PREFIXES) {
    if (varName.startsWith(prefix) || varName === prefix) {
      return true;
    }
  }

  if (varName.includes(".version")) {
    return true;
  }

  return false;
}

// Transfer/bypass voltage set-points (input.transfer.{low,high,min,max}, input.transfer.hysteresis)
// carry no "voltage" token in the name but are volts — used for both unit and role detection.
function isTransferVoltage(varName: string): boolean {
  return /^input\.transfer\.(.*\.)?(low|high|min|max)$/.test(varName) || varName === "input.transfer.hysteresis";
}

// Only called for numeric variables (string vars never carry a unit).
function detectUnit(varName: string): string | undefined {
  // Percent-of-nominal ranges carry "frequency" in the name but are a percentage.
  if (/\.frequency\..+\.range$/.test(varName)) {
    return "%";
  }
  // Minutes (checked before the generic seconds rules that also match ".delay").
  if (varName === "battery.energysave.delay") {
    return "min";
  }
  if (varName.includes("voltage") || isTransferVoltage(varName)) {
    return "V";
  }
  if (varName.includes("frequency")) {
    return "Hz";
  }
  if (varName.includes("current")) {
    return "A";
  }
  if (varName.includes("charge")) {
    return "%";
  }
  if (varName.includes("humidity")) {
    return "%";
  }
  if (
    varName.endsWith(".load") ||
    varName.endsWith(".load.high") ||
    varName.endsWith(".efficiency") ||
    varName.endsWith(".percent")
  ) {
    return "%";
  }
  if (varName.includes("temperature")) {
    return "°C";
  }
  if (
    varName.includes("runtime") ||
    varName.includes(".delay.") ||
    varName.endsWith(".delay") ||
    varName.includes(".timer.") ||
    varName.endsWith(".uptime") ||
    varName.endsWith(".test.interval") ||
    varName.endsWith(".latency")
  ) {
    return "s";
  }
  if (varName.endsWith(".realpower") || varName.endsWith(".realpower.nominal")) {
    return "W";
  }
  if (varName.endsWith(".power") || varName.endsWith(".power.nominal")) {
    return "VA";
  }
  if (varName.includes("capacity")) {
    return "Ah";
  }
  if (varName === "input.phase.shift") {
    return "°";
  }
  return undefined;
}

function detectRole(varName: string, type: "number" | "string", isWritable: boolean): string {
  // ups.status is the one string that always gets a text role.
  if (varName === "ups.status") {
    return "text";
  }
  // String states never get a value.* role — they are text (or a writable text field).
  if (type === "string") {
    return "text";
  }

  // Numeric roles.
  if (varName === "battery.charge") {
    return "value.battery";
  }
  if (varName.includes("voltage") || isTransferVoltage(varName)) {
    return isWritable ? "level" : "value.voltage";
  }
  if (varName.includes("temperature")) {
    return "value.temperature";
  }
  if (varName.includes("current")) {
    return "value.current";
  }
  // Real frequency (Hz) → value.frequency. A "*.frequency.*.range" is a percentage-of-nominal
  // band (unit %), not a frequency reading, so it stays the generic value role.
  if (varName.includes("frequency") && !/\.frequency\..+\.range$/.test(varName)) {
    return isWritable ? "level" : "value.frequency";
  }
  if (varName.includes("humidity")) {
    return isWritable ? "level" : "value.humidity";
  }
  // "powerfactor" contains "power" but is a 0..1 factor, not a power value.
  if (varName.includes("power") && !varName.includes("powerfactor")) {
    if (isWritable) {
      return "level";
    }
    // realpower is real/active power (W); ups.power is apparent power (VA) — ioBroker has no
    // value.power.apparent role, so apparent stays value.power.
    return varName.includes("realpower") ? "value.power.active" : "value.power";
  }
  if (varName.includes("runtime") || varName.includes(".delay.") || varName.includes(".timer.")) {
    return isWritable ? "level" : "value.interval";
  }

  return isWritable ? "level" : "value";
}

const KNOWN_ENUM_STATES: Record<string, Record<string, string>> = {
  "battery.charger.status": {
    charging: "charging",
    discharging: "discharging",
    floating: "floating",
    resting: "resting",
  },
  "ups.beeper.status": {
    enabled: "enabled",
    disabled: "disabled",
    muted: "muted",
  },
  // Device type is a fixed enumeration per the NUT catalogue (nut-names.txt: device.type).
  "device.type": {
    ups: "ups",
    pdu: "pdu",
    scd: "scd",
    psu: "psu",
    ats: "ats",
  },
};

const OUTLET_ON_OFF: Record<string, string> = { on: "on", off: "off" };

// good / warning-low / warning-high / critical-low / critical-high — threshold status enum for
// *.voltage.status, *.current.status, ambient.*.{temperature,humidity}.status (incl. three-phase
// variants like input.L1.voltage.status).
const THRESHOLD_STATUS: Record<string, string> = {
  good: "good",
  "warning-low": "warning-low",
  "warning-high": "warning-high",
  "critical-low": "critical-low",
  "critical-high": "critical-high",
};

// Frequency status additionally reports "out-of-range".
const FREQUENCY_STATUS: Record<string, string> = { ...THRESHOLD_STATUS, "out-of-range": "out-of-range" };

// Two-state toggles reported as a word (ups.watchdog.status, ups.shutdown,
// input.transfer.bypass.{forced,overload,outlimits}, input.bypass.switchable,
// ambient.*.{temperature,humidity}.alarm) — an enum, not bare text.
const ENABLED_DISABLED: Record<string, string> = { enabled: "enabled", disabled: "disabled" };

// Dry-contact sensor status: raw open/closed, or active/inactive relative to its configuration.
const CONTACTS_STATUS: Record<string, string> = {
  open: "open",
  closed: "closed",
  active: "active",
  inactive: "inactive",
};

/**
 * Detect common.states for known enum variables.
 *
 * @param varName NUT variable name
 */
export function detectStates(varName: string): Record<string, string> | undefined {
  if (KNOWN_ENUM_STATES[varName]) {
    return KNOWN_ENUM_STATES[varName];
  }
  // on/off switches — individual outlets and outlet groups.
  if (/^outlet(\.\d+)?\.(switch|status)$/.test(varName) || /^outlet\.group(\.\d+)?\.status$/.test(varName)) {
    return OUTLET_ON_OFF;
  }
  // Threshold status enums (frequency additionally reports out-of-range). The (^|\.) anchor also
  // catches the top-level forms (voltage.status, current.status, frequency.status) the NUT catalogue
  // lists alongside the input.*/output.* variants — otherwise they fell through to opaque text.
  if (/(^|\.)frequency\.status$/.test(varName)) {
    return FREQUENCY_STATUS;
  }
  if (/(^|\.)(voltage|current|temperature|humidity)\.status$/.test(varName)) {
    return THRESHOLD_STATUS;
  }
  // Two-state enabled/disabled toggles that would otherwise fall through to bare text.
  if (
    varName === "ups.watchdog.status" ||
    varName === "ups.shutdown" ||
    varName === "input.bypass.switchable" ||
    /^input\.transfer\.bypass\.(forced|overload|outlimits)$/.test(varName) ||
    /^ambient(\.\d+)?\.(temperature|humidity)\.alarm$/.test(varName)
  ) {
    return ENABLED_DISABLED;
  }
  // Dry-contact sensor status.
  if (/^ambient(\.\d+)?\.contacts\.\d+\.status$/.test(varName)) {
    return CONTACTS_STATUS;
  }
  return undefined;
}
