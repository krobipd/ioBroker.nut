"use strict";
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __export = (target, all) => {
  for (var name in all) __defProp(target, name, { get: all[name], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if ((from && typeof from === "object") || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, {
          get: () => from[key],
          enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable,
        });
  }
  return to;
};
var __toCommonJS = mod => __copyProps(__defProp({}, "__esModule", { value: true }), mod);
var types_exports = {};
__export(types_exports, {
  NUT_DEFAULT_COMMAND_TIMEOUT: () => NUT_DEFAULT_COMMAND_TIMEOUT,
  NUT_DEFAULT_PORT: () => NUT_DEFAULT_PORT,
  NUT_ERRORS: () => NUT_ERRORS,
});
module.exports = __toCommonJS(types_exports);
const NUT_DEFAULT_PORT = 3493;
const NUT_DEFAULT_COMMAND_TIMEOUT = 5e3;
const NUT_ERRORS = [
  "ACCESS-DENIED",
  "UNKNOWN-UPS",
  "VAR-NOT-SUPPORTED",
  "CMD-NOT-SUPPORTED",
  "INVALID-ARGUMENT",
  "INSTCMD-FAILED",
  "SET-FAILED",
  "READONLY",
  "TOO-LONG",
  "FEATURE-NOT-SUPPORTED",
  "FEATURE-NOT-CONFIGURED",
  "ALREADY-SSL-MODE",
  "DRIVER-NOT-CONNECTED",
  "DATA-STALE",
  "ALREADY-LOGGED-IN",
  "INVALID-PASSWORD",
  "ALREADY-SET-PASSWORD",
  "INVALID-USERNAME",
  "ALREADY-SET-USERNAME",
  "USERNAME-REQUIRED",
  "PASSWORD-REQUIRED",
  "UNKNOWN-COMMAND",
  "INVALID-VALUE",
];
// Annotate the CommonJS export names for ESM import in node:
0 &&
  (module.exports = {
    NUT_DEFAULT_COMMAND_TIMEOUT,
    NUT_DEFAULT_PORT,
    NUT_ERRORS,
  });
//# sourceMappingURL=types.js.map
