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
var coerce_exports = {};
__export(coerce_exports, {
  coerceCommandTimeoutMs: () => coerceCommandTimeoutMs,
  coerceHost: () => coerceHost,
  coercePollIntervalSec: () => coercePollIntervalSec,
  coercePort: () => coercePort,
  computeReconnectDelay: () => computeReconnectDelay,
  errText: () => errText,
  localAddressOf: () => localAddressOf,
  parseDecimal: () => parseDecimal,
  parseNotifyTrigger: () => parseNotifyTrigger
});
module.exports = __toCommonJS(coerce_exports);
var import_types = require("./types");
const DECIMAL_NUMBER_RE = /^-?\d+(\.\d+)?$/;
function parseDecimal(raw) {
  if (typeof raw === "number") {
    return Number.isFinite(raw) ? raw : NaN;
  }
  if (typeof raw === "string" && DECIMAL_NUMBER_RE.test(raw.trim())) {
    return Number(raw.trim());
  }
  return NaN;
}
function errText(err) {
  var _a;
  if (err instanceof Error) {
    return err.message;
  }
  if (err === null) {
    return "null";
  }
  if (err === void 0) {
    return "undefined";
  }
  if (typeof err === "string") {
    return err;
  }
  if (typeof err === "number" || typeof err === "boolean" || typeof err === "bigint") {
    return String(err);
  }
  if (typeof err === "symbol") {
    return String(err);
  }
  try {
    return (_a = JSON.stringify(err)) != null ? _a : Object.prototype.toString.call(err);
  } catch {
    return Object.prototype.toString.call(err);
  }
}
function coerceHost(raw) {
  if (typeof raw !== "string") {
    return null;
  }
  const trimmed = raw.trim();
  return trimmed.length > 0 ? trimmed : null;
}
function localAddressOf(raw) {
  if (typeof raw !== "string") {
    return void 0;
  }
  const trimmed = raw.trim();
  return trimmed.length > 0 && trimmed !== "0.0.0.0" ? trimmed : void 0;
}
function coercePort(raw) {
  const n = parseDecimal(raw);
  if (!Number.isFinite(n)) {
    return import_types.NUT_DEFAULT_PORT;
  }
  return Math.max(1, Math.min(65535, Math.floor(n)));
}
function coercePollIntervalSec(raw) {
  const n = parseDecimal(raw);
  if (!Number.isFinite(n)) {
    return 15;
  }
  return Math.max(2, Math.min(300, Math.floor(n)));
}
function coerceCommandTimeoutMs(raw) {
  const n = parseDecimal(raw);
  if (!Number.isFinite(n)) {
    return import_types.NUT_DEFAULT_COMMAND_TIMEOUT;
  }
  return Math.max(1, Math.min(30, Math.floor(n))) * 1e3;
}
function computeReconnectDelay(attempt, baseMs, maxMs) {
  const a = Math.max(1, Math.floor(attempt));
  return Math.min(baseMs * 2 ** (a - 1), maxMs);
}
const NOTIFY_MAX_LENGTH = 200;
function parseNotifyTrigger(raw) {
  let text;
  if (typeof raw === "string") {
    text = raw;
  } else if (typeof raw === "number" || typeof raw === "boolean" || typeof raw === "bigint") {
    text = String(raw);
  } else {
    text = "";
  }
  text = text.trim().slice(0, NOTIFY_MAX_LENGTH);
  const firstWs = text.search(/\s/);
  if (firstWs < 0) {
    return { type: text, upsRef: "", text };
  }
  const type = text.slice(0, firstWs);
  let upsRef = text.slice(firstWs).trim();
  const at = upsRef.indexOf("@");
  if (at >= 0) {
    upsRef = upsRef.slice(0, at).trim();
  }
  return { type, upsRef, text };
}
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  coerceCommandTimeoutMs,
  coerceHost,
  coercePollIntervalSec,
  coercePort,
  computeReconnectDelay,
  errText,
  localAddressOf,
  parseDecimal,
  parseNotifyTrigger
});
//# sourceMappingURL=coerce.js.map
