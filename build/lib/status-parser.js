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
var status_parser_exports = {};
__export(status_parser_exports, {
  ALL_FLAG_KEYS: () => ALL_FLAG_KEYS,
  FLAG_META: () => FLAG_META,
  STATUS_FLAGS: () => STATUS_FLAGS,
  getDisplayString: () => getDisplayString,
  parseStatus: () => parseStatus
});
module.exports = __toCommonJS(status_parser_exports);
const STATUS_CATALOG = [
  { token: "OL", flag: "online", label: "Online", i18nKey: "flagOnline", role: "indicator" },
  { token: "OB", flag: "onBattery", label: "On Battery", i18nKey: "flagOnBattery", role: "indicator.alarm" },
  { token: "LB", flag: "lowBattery", label: "Low Battery", i18nKey: "flagLowBattery", role: "indicator.lowbat" },
  { token: "HB", flag: "highBattery", label: "High Battery", i18nKey: "flagHighBattery", role: "indicator" },
  {
    token: "RB",
    flag: "replaceBattery",
    label: "Replace Battery",
    i18nKey: "flagReplaceBattery",
    role: "indicator.maintenance"
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
    role: "indicator.alarm"
  },
  { token: "ALARM", flag: "alarm", label: "Alarm", i18nKey: "flagAlarm", role: "indicator.alarm" },
  { token: "WAIT", flag: "waiting", label: "Waiting", i18nKey: "flagWaiting", role: "indicator" },
  { token: "ECO", flag: "ecoMode", label: "ECO Mode", i18nKey: "flagEcoMode", role: "indicator" },
  { token: "TEST", flag: "testing", label: "Testing", i18nKey: "flagTesting", role: "indicator" },
  { token: "OVERHEAT", flag: "overheat", label: "Overheated", i18nKey: "flagOverheat", role: "indicator.alarm" }
];
const STATUS_ALIASES = {
  HE: "ECO"
};
const STATUS_FLAGS = {};
const DISPLAY_LABELS = {};
const FLAG_META = {};
for (const d of STATUS_CATALOG) {
  STATUS_FLAGS[d.token] = d.flag;
  DISPLAY_LABELS[d.token] = d.label;
  FLAG_META[d.flag] = { i18nKey: d.i18nKey, role: d.role };
}
for (const [alias, token] of Object.entries(STATUS_ALIASES)) {
  STATUS_FLAGS[alias] = STATUS_FLAGS[token];
  DISPLAY_LABELS[alias] = DISPLAY_LABELS[token];
}
const ALL_FLAG_KEYS = STATUS_CATALOG.map((d) => d.flag);
function parseStatus(rawStatus, chargerStatus) {
  const tokens = rawStatus.trim().split(/\s+/).filter((t) => t.length > 0);
  const flags = {};
  for (const key of ALL_FLAG_KEYS) {
    flags[key] = false;
  }
  const activeTokens = /* @__PURE__ */ new Set();
  for (const token of tokens) {
    const flag = STATUS_FLAGS[token];
    if (flag) {
      flags[flag] = true;
      activeTokens.add(token);
    }
  }
  if (chargerStatus) {
    const cs = chargerStatus.trim().toLowerCase();
    if (cs === "charging") {
      flags.charging = true;
    } else if (cs === "discharging") {
      flags.discharging = true;
    }
  }
  const severity = computeSeverity(activeTokens);
  return { raw: rawStatus, flags, severity };
}
function getDisplayString(rawStatus) {
  return rawStatus.trim().split(/\s+/).filter((t) => t.length > 0).map((t) => {
    var _a;
    return (_a = DISPLAY_LABELS[t]) != null ? _a : t;
  }).join(", ");
}
function computeSeverity(tokens) {
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
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  ALL_FLAG_KEYS,
  FLAG_META,
  STATUS_FLAGS,
  getDisplayString,
  parseStatus
});
//# sourceMappingURL=status-parser.js.map
