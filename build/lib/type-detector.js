"use strict";
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);
var type_detector_exports = {};
__export(type_detector_exports, {
  detectStates: () => detectStates,
  detectType: () => detectType
});
module.exports = __toCommonJS(type_detector_exports);
var import_coerce = require("./coerce");
const KNOWN_STRING_SUFFIXES = /* @__PURE__ */ new Set([
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
  "groupid"
]);
const KNOWN_STRING_PREFIXES = [
  "driver.flag.",
  "driver.parameter.port",
  "driver.parameter.synchronous",
  "driver.version."
];
function detectType(varName, rawValue, isWritable) {
  if (isKnownString(varName)) {
    return {
      type: "string",
      role: detectRole(varName, "string", isWritable),
      unit: void 0,
      read: true,
      write: isWritable,
      parsedValue: rawValue
    };
  }
  const bool = parseYesNo(rawValue);
  if (bool !== void 0) {
    return {
      type: "boolean",
      role: isWritable ? "switch" : "indicator",
      unit: void 0,
      read: true,
      write: isWritable,
      parsedValue: bool
    };
  }
  const num = (0, import_coerce.parseDecimal)(rawValue);
  if (Number.isFinite(num)) {
    return {
      type: "number",
      role: detectRole(varName, "number", isWritable),
      unit: detectUnit(varName),
      read: true,
      write: isWritable,
      parsedValue: num
    };
  }
  return {
    type: "string",
    role: detectRole(varName, "string", isWritable),
    unit: void 0,
    read: true,
    write: isWritable,
    parsedValue: rawValue,
    expectedNumeric: detectUnit(varName) !== void 0
  };
}
function parseYesNo(rawValue) {
  const v = rawValue.trim().toLowerCase();
  if (v === "yes") {
    return true;
  }
  if (v === "no") {
    return false;
  }
  return void 0;
}
function isKnownString(varName) {
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
function detectUnit(varName) {
  if (/\.frequency\..+\.range$/.test(varName)) {
    return "%";
  }
  if (varName === "battery.energysave.delay") {
    return "min";
  }
  if (varName.includes("voltage")) {
    return "V";
  }
  if (/^input\.transfer\.(.*\.)?(low|high|min|max)$/.test(varName) || varName === "input.transfer.hysteresis") {
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
  if (varName.endsWith(".load") || varName.endsWith(".load.high") || varName.endsWith(".efficiency") || varName.endsWith(".percent")) {
    return "%";
  }
  if (varName.includes("temperature")) {
    return "\xB0C";
  }
  if (varName.includes("runtime") || varName.includes(".delay.") || varName.endsWith(".delay") || varName.includes(".timer.") || varName.endsWith(".uptime") || varName.endsWith(".test.interval") || varName.endsWith(".latency")) {
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
    return "\xB0";
  }
  return void 0;
}
function detectRole(varName, type, isWritable) {
  if (varName === "ups.status") {
    return "text";
  }
  if (type === "string") {
    return "text";
  }
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
  if (varName.includes("power") && !varName.includes("powerfactor")) {
    return isWritable ? "level" : "value.power";
  }
  if (varName.includes("runtime") || varName.includes(".delay.") || varName.includes(".timer.")) {
    return isWritable ? "level" : "value.interval";
  }
  return isWritable ? "level" : "value";
}
const KNOWN_ENUM_STATES = {
  "battery.charger.status": {
    charging: "charging",
    discharging: "discharging",
    floating: "floating",
    resting: "resting"
  },
  "ups.beeper.status": {
    enabled: "enabled",
    disabled: "disabled",
    muted: "muted"
  }
};
const OUTLET_ON_OFF = { on: "on", off: "off" };
const THRESHOLD_STATUS = {
  good: "good",
  "warning-low": "warning-low",
  "warning-high": "warning-high",
  "critical-low": "critical-low",
  "critical-high": "critical-high"
};
const FREQUENCY_STATUS = { ...THRESHOLD_STATUS, "out-of-range": "out-of-range" };
const ENABLED_DISABLED = { enabled: "enabled", disabled: "disabled" };
const CONTACTS_STATUS = {
  open: "open",
  closed: "closed",
  active: "active",
  inactive: "inactive"
};
function detectStates(varName) {
  if (KNOWN_ENUM_STATES[varName]) {
    return KNOWN_ENUM_STATES[varName];
  }
  if (/^outlet(\.\d+)?\.(switch|status)$/.test(varName) || /^outlet\.group(\.\d+)?\.status$/.test(varName)) {
    return OUTLET_ON_OFF;
  }
  if (/\.frequency\.status$/.test(varName)) {
    return FREQUENCY_STATUS;
  }
  if (/\.(voltage|current|temperature|humidity)\.status$/.test(varName)) {
    return THRESHOLD_STATUS;
  }
  if (varName === "ups.watchdog.status" || varName === "ups.shutdown" || varName === "input.bypass.switchable" || /^input\.transfer\.bypass\.(forced|overload|outlimits)$/.test(varName) || /^ambient(\.\d+)?\.(temperature|humidity)\.alarm$/.test(varName)) {
    return ENABLED_DISABLED;
  }
  if (/^ambient(\.\d+)?\.contacts\.\d+\.status$/.test(varName)) {
    return CONTACTS_STATUS;
  }
  return void 0;
}
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  detectStates,
  detectType
});
//# sourceMappingURL=type-detector.js.map
