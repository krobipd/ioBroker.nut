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
  getDisplayEntries: () => getDisplayEntries,
  parseStatus: () => parseStatus
});
module.exports = __toCommonJS(status_parser_exports);
const STATUS_CATALOG = [
  { token: "OL", flag: "online", i18nKey: "flagOnline", role: "indicator" },
  { token: "OB", flag: "onBattery", i18nKey: "flagOnBattery", role: "indicator.alarm" },
  { token: "LB", flag: "lowBattery", i18nKey: "flagLowBattery", role: "indicator.lowbat" },
  { token: "HB", flag: "highBattery", i18nKey: "flagHighBattery", role: "indicator" },
  {
    token: "RB",
    flag: "replaceBattery",
    i18nKey: "flagReplaceBattery",
    role: "indicator.maintenance"
  },
  { token: "CHRG", flag: "charging", i18nKey: "flagCharging", role: "indicator" },
  { token: "DISCHRG", flag: "discharging", i18nKey: "flagDischarging", role: "indicator" },
  { token: "BYPASS", flag: "bypass", i18nKey: "flagBypass", role: "indicator" },
  { token: "CAL", flag: "calibrating", i18nKey: "flagCalibrating", role: "indicator" },
  { token: "OFF", flag: "off", i18nKey: "flagOff", role: "indicator" },
  { token: "OVER", flag: "overloaded", i18nKey: "flagOverloaded", role: "indicator.alarm" },
  { token: "TRIM", flag: "trimming", i18nKey: "flagTrimming", role: "indicator" },
  { token: "BOOST", flag: "boosting", i18nKey: "flagBoosting", role: "indicator" },
  {
    token: "FSD",
    flag: "forcedShutdown",
    i18nKey: "flagForcedShutdown",
    role: "indicator.alarm"
  },
  { token: "ALARM", flag: "alarm", i18nKey: "flagAlarm", role: "indicator.alarm" },
  { token: "WAIT", flag: "waiting", i18nKey: "flagWaiting", role: "indicator" },
  { token: "ECO", flag: "ecoMode", i18nKey: "flagEcoMode", role: "indicator" },
  { token: "TEST", flag: "testing", i18nKey: "flagTesting", role: "indicator" },
  { token: "OVERHEAT", flag: "overheat", i18nKey: "flagOverheat", role: "indicator.alarm" }
];
const STATUS_ALIASES = {
  HE: "ECO"
};
const STATUS_FLAGS = {};
const FLAG_META = {};
for (const d of STATUS_CATALOG) {
  STATUS_FLAGS[d.token] = d.flag;
  FLAG_META[d.flag] = {
    i18nKey: d.i18nKey,
    descKey: `desc${d.i18nKey.charAt(0).toUpperCase()}${d.i18nKey.slice(1)}`,
    role: d.role
  };
}
for (const [alias, token] of Object.entries(STATUS_ALIASES)) {
  STATUS_FLAGS[alias] = STATUS_FLAGS[token];
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
const DISPLAY_I18N = {};
for (const d of STATUS_CATALOG) {
  DISPLAY_I18N[d.token] = d.i18nKey;
}
for (const [alias, token] of Object.entries(STATUS_ALIASES)) {
  DISPLAY_I18N[alias] = DISPLAY_I18N[token];
}
function getDisplayEntries(rawStatus) {
  return rawStatus.trim().split(/\s+/).filter((t) => t.length > 0).map((token) => DISPLAY_I18N[token] ? { i18nKey: DISPLAY_I18N[token], token } : { token });
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
  getDisplayEntries,
  parseStatus
});
//# sourceMappingURL=status-parser.js.map
