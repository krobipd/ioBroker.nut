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
]);

/** Known-string exact prefixes — always string. */
const KNOWN_STRING_PREFIXES = [
  "driver.flag.",
  "driver.parameter.port",
  "driver.parameter.synchronous",
  "driver.version.",
];

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
  /** Parsed value (number, string or boolean) */
  parsedValue: number | string | boolean;
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

// Only called for numeric variables (string vars never carry a unit).
function detectUnit(varName: string): string | undefined {
  if (varName.includes("voltage")) {
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
  if (varName.endsWith(".load") || varName.endsWith(".efficiency") || varName.endsWith(".percent")) {
    return "%";
  }
  if (varName.includes("temperature")) {
    return "°C";
  }
  if (varName.includes("runtime") || varName.includes(".delay.") || varName.includes(".timer.")) {
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
  if (varName.includes("voltage")) {
    return isWritable ? "level" : "value.voltage";
  }
  if (varName.includes("temperature")) {
    return "value.temperature";
  }
  if (varName.includes("current")) {
    return "value.current";
  }
  // "powerfactor" contains "power" but is a 0..1 factor, not a power value.
  if (varName.includes("power") && !varName.includes("powerfactor")) {
    return isWritable ? "level" : "value.power";
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
};

const OUTLET_ON_OFF: Record<string, string> = { on: "on", off: "off" };

// good / warning-low / warning-high / critical-low / critical-high — for *.voltage.status,
// *.frequency.status (incl. three-phase variants like input.L1.voltage.status).
const VOLTAGE_FREQUENCY_STATUS: Record<string, string> = {
  good: "good",
  "warning-low": "warning-low",
  "warning-high": "warning-high",
  "critical-low": "critical-low",
  "critical-high": "critical-high",
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
  if (/^outlet(\.\d+)?\.(switch|status)$/.test(varName)) {
    return OUTLET_ON_OFF;
  }
  if (/\.(voltage|frequency)\.status$/.test(varName)) {
    return VOLTAGE_FREQUENCY_STATUS;
  }
  return undefined;
}
