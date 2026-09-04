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
var message_router_exports = {};
__export(message_router_exports, {
  dispatchMessage: () => dispatchMessage,
  makeTestClientFactory: () => makeTestClientFactory
});
module.exports = __toCommonJS(message_router_exports);
var import_nut_client = require("./nut-client");
var import_coerce = require("./coerce");
var import_i18n = require("./i18n");
function makeTestClientFactory(NutClientClass, logger) {
  return (host, port, options) => new NutClientClass(host, port, { ...options, logger });
}
async function dispatchMessage(obj, deps) {
  var _a, _b, _c;
  deps.log.debug(`onMessage: command='${obj == null ? void 0 : obj.command}' from='${obj == null ? void 0 : obj.from}' has-callback=${!!(obj == null ? void 0 : obj.callback)}`);
  if (!obj.callback) {
    return;
  }
  try {
    switch (obj.command) {
      case "checkConnection": {
        const raw = obj.message;
        const config = typeof raw === "object" && raw !== null && !Array.isArray(raw) ? raw : {};
        const host = (0, import_coerce.coerceHost)(config.host);
        if (!host) {
          deps.log.debug("checkConnection: missing host in message");
          deps.sendTo(obj.from, obj.command, { error: (0, import_i18n.tText)("testHostRequired") }, obj.callback);
          return;
        }
        const port = (0, import_coerce.coercePort)(config.port);
        const username = typeof config.username === "string" ? config.username : "";
        const password = typeof config.password === "string" ? config.password : "";
        const localAddress = (0, import_coerce.localAddressOf)(config.networkInterface);
        const options = {
          localAddress,
          commandTimeout: (0, import_coerce.coerceCommandTimeoutMs)(config.commandTimeout),
          useTls: !!config.useTls,
          tlsRejectUnauthorized: !!config.tlsRejectUnauthorized,
          tlsCaFile: typeof config.tlsCaFile === "string" ? config.tlsCaFile : ""
        };
        const testClient = deps.createTestClient(host, port, options);
        (_a = deps.onTestClientCreated) == null ? void 0 : _a.call(deps, testClient);
        try {
          await testClient.connect();
          const upsList = await testClient.listUps();
          const names = upsList.map((u) => u.name).join(", ");
          deps.log.debug(`checkConnection: found ${upsList.length} UPS(es): ${names}`);
          const transport = testClient.isTls ? (0, import_i18n.tText)("testTls") : (0, import_i18n.tText)("testPlain");
          if (username && password) {
            const first = upsList[0];
            if (!first) {
              deps.sendTo(obj.from, obj.command, { result: (0, import_i18n.tTextArgs)("testConnectedNoUps", transport) }, obj.callback);
            } else {
              try {
                await testClient.authenticate(username, password);
                await testClient.login(first.name);
                await testClient.logout();
                deps.sendTo(
                  obj.from,
                  obj.command,
                  { result: (0, import_i18n.tTextArgs)("testConnectedLoggedIn", transport, username, upsList.length, names) },
                  obj.callback
                );
              } catch (err) {
                if (!(0, import_nut_client.authFailureText)(err)) {
                  throw err;
                }
                deps.log.debug(`checkConnection: credentials for ${username} refused`);
                deps.sendTo(
                  obj.from,
                  obj.command,
                  { result: (0, import_i18n.tTextArgs)("testConnectedAuthRejected", transport, username, upsList.length, names) },
                  obj.callback
                );
              }
            }
          } else {
            deps.sendTo(
              obj.from,
              obj.command,
              { result: (0, import_i18n.tTextArgs)("testConnectedNoCreds", transport, upsList.length, names) },
              obj.callback
            );
          }
        } finally {
          testClient.destroy();
          (_b = deps.onTestClientDone) == null ? void 0 : _b.call(deps, testClient);
        }
        break;
      }
      default:
        deps.log.debug(`onMessage: unknown command '${obj.command}'`);
        deps.sendTo(obj.from, obj.command, { error: "Unknown command" }, obj.callback);
    }
  } catch (err) {
    deps.log.debug(`onMessage: '${obj.command}' failed: ${(0, import_coerce.errText)(err)}`);
    deps.sendTo(
      obj.from,
      obj.command,
      { error: (0, import_i18n.tTextArgs)("testFailed", (_c = (0, import_nut_client.authFailureText)(err)) != null ? _c : (0, import_coerce.errText)(err)) },
      obj.callback
    );
  }
}
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  dispatchMessage,
  makeTestClientFactory
});
//# sourceMappingURL=message-router.js.map
