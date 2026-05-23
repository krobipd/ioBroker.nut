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
  "productid"
]);
const KNOWN_STRING_PREFIXES = [
  "driver.flag.",
  "driver.parameter.port",
  "driver.parameter.synchronous",
  "driver.version.",
  "input.voltage.extended"
];
function detectType(varName, rawValue, isWritable) {
  const isString = isKnownString(varName);
  const unit = detectUnit(varName);
  if (isString) {
    return {
      type: "string",
      role: detectRole(varName, "string", isWritable),
      unit,
      read: true,
      write: isWritable,
      parsedValue: rawValue
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
      parsedValue: num
    };
  }
  return {
    type: "string",
    role: detectRole(varName, "string", isWritable),
    unit,
    read: true,
    write: isWritable,
    parsedValue: rawValue
  };
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
    return "\xB0C";
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
  return void 0;
}
function detectRole(varName, type, isWritable) {
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
function detectStates(varName) {
  if (KNOWN_ENUM_STATES[varName]) {
    return KNOWN_ENUM_STATES[varName];
  }
  if (/^outlet(\.\d+)?\.(switch|status)$/.test(varName)) {
    return OUTLET_ON_OFF;
  }
  return void 0;
}
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  detectStates,
  detectType
});
//# sourceMappingURL=type-detector.js.map
