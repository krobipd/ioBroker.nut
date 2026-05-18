/** Known-string suffixes — always string regardless of parseFloat. */
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
  "input.voltage.extended",
];

/** Result of type detection for a NUT variable. */
export interface TypeDetectResult {
  /** ioBroker state type */
  type: "number" | "string";
  /** ioBroker state role */
  role: string;
  /** Unit string if applicable */
  unit?: string;
  /** Always true */
  read: true;
  /** Whether the variable is writable via SET VAR */
  write: boolean;
  /** Parsed value (number or string) */
  parsedValue: number | string;
}

/**
 * Detect ioBroker state type, role, and unit from a NUT variable name and raw value.
 *
 * @param varName NUT variable name (e.g. battery.charge)
 * @param rawValue Raw string value from LIST VAR
 * @param isWritable Whether the variable appears in LIST RW
 */
export function detectType(varName: string, rawValue: string, isWritable: boolean): TypeDetectResult {
  const isString = isKnownString(varName);
  const unit = detectUnit(varName);

  if (isString) {
    return {
      type: "string",
      role: detectRole(varName, "string", isWritable),
      unit,
      read: true,
      write: isWritable,
      parsedValue: rawValue,
    };
  }

  const num = parseFloat(rawValue);
  if (!Number.isNaN(num)) {
    return {
      type: "number",
      role: detectRole(varName, "number", isWritable),
      unit,
      read: true,
      write: isWritable,
      parsedValue: num,
    };
  }

  return {
    type: "string",
    role: detectRole(varName, "string", isWritable),
    unit,
    read: true,
    write: isWritable,
    parsedValue: rawValue,
  };
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

function detectUnit(varName: string): string | undefined {
  if (varName.includes("voltage") && !varName.endsWith(".extended")) {
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
  if (varName === "battery.charge") {
    return "value.battery";
  }
  if (varName.includes("voltage")) {
    return isWritable ? "level" : "value.voltage";
  }
  if (varName.includes("temperature")) {
    return "value.temperature";
  }
  if (varName === "ups.status") {
    return "text";
  }
  if (varName.includes("current")) {
    return "value.current";
  }
  if (varName.includes("power")) {
    return isWritable ? "level" : "value.power";
  }
  if (varName.includes("runtime") || varName.includes(".delay.") || varName.includes(".timer.")) {
    return isWritable ? "level" : "value.interval";
  }

  if (isWritable) {
    return type === "number" ? "level" : "text";
  }
  return type === "number" ? "value" : "text";
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
  return undefined;
}
