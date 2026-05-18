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
  STATUS_FLAGS: () => STATUS_FLAGS,
  getDisplayString: () => getDisplayString,
  parseStatus: () => parseStatus
});
module.exports = __toCommonJS(status_parser_exports);
const STATUS_FLAGS = {
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
  HE: "highEfficiency"
};
const ALL_FLAG_KEYS = Object.values(STATUS_FLAGS);
function parseStatus(rawStatus) {
  const tokens = rawStatus.trim().split(/\s+/).filter((t) => t.length > 0);
  const flags = {};
  for (const key of ALL_FLAG_KEYS) {
    flags[key] = false;
  }
  const activeTokens = /* @__PURE__ */ new Set();
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
const DISPLAY_LABELS = {
  OL: "Online",
  OB: "On Battery",
  LB: "Low Battery",
  HB: "High Battery",
  RB: "Replace Battery",
  CHRG: "Charging",
  DISCHRG: "Discharging",
  BYPASS: "Bypass",
  CAL: "Calibrating",
  OFF: "Offline",
  OVER: "Overloaded",
  TRIM: "Trimming",
  BOOST: "Boosting",
  FSD: "Forced Shutdown",
  ALARM: "Alarm",
  COMM: "Communication OK",
  NOCOMM: "Communication Lost",
  TEST: "Testing",
  HE: "High Efficiency"
};
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
  STATUS_FLAGS,
  getDisplayString,
  parseStatus
});
//# sourceMappingURL=status-parser.js.map
