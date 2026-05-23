"use strict";
var __create = Object.create;
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __getProtoOf = Object.getPrototypeOf;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toESM = (mod, isNodeMode, target) => (target = mod != null ? __create(__getProtoOf(mod)) : {}, __copyProps(
  // If the importer is in node compatibility mode or this is not an ESM
  // file that has been converted to a CommonJS file using a Babel-
  // compatible transform (i.e. "__esModule" has not been set), then set
  // "default" to the CommonJS "module.exports" for node compatibility.
  isNodeMode || !mod || !mod.__esModule ? __defProp(target, "default", { value: mod, enumerable: true }) : target,
  mod
));
var utils = __toESM(require("@iobroker/adapter-core"));
var import_adapter_core = require("@iobroker/adapter-core");
var import_node_path = require("node:path");
var import_coerce = require("./lib/coerce");
var import_message_router = require("./lib/message-router");
var import_nut_client = require("./lib/nut-client");
var import_state_manager = require("./lib/state-manager");
class NutAdapter extends utils.Adapter {
  client = null;
  stateManager = null;
  pollTimer = void 0;
  isPolling = false;
  lastErrorCode = "";
  failedUps = /* @__PURE__ */ new Set();
  discoveredUps = /* @__PURE__ */ new Map();
  authenticated = false;
  enrichedUps = /* @__PURE__ */ new Set();
  testClients = /* @__PURE__ */ new Set();
  unhandledRejectionHandler = null;
  uncaughtExceptionHandler = null;
  constructor(options = {}) {
    super({ ...options, name: "nut" });
    this.on("ready", this.onReady.bind(this));
    this.on("stateChange", this.onStateChange.bind(this));
    this.on("unload", this.onUnload.bind(this));
    this.on("message", this.onMessage.bind(this));
    this.unhandledRejectionHandler = (reason) => {
      var _a;
      this.log.error(`Unhandled rejection: ${(0, import_coerce.errText)(reason)}`);
      (_a = this.terminate) == null ? void 0 : _a.call(this, 11);
    };
    this.uncaughtExceptionHandler = (err) => {
      var _a;
      this.log.error(`Uncaught exception: ${(0, import_coerce.errText)(err)}`);
      (_a = this.terminate) == null ? void 0 : _a.call(this, 11);
    };
    process.on("unhandledRejection", this.unhandledRejectionHandler);
    process.on("uncaughtException", this.uncaughtExceptionHandler);
  }
  async onReady() {
    try {
      await import_adapter_core.I18n.init((0, import_node_path.join)(this.adapterDir, "admin"), this);
      const config = this.config;
      this.log.debug(
        `onReady: starting (host='${config.host}', port=${JSON.stringify(config.port)}, pollInterval=${JSON.stringify(config.pollInterval)}s)`
      );
      await this.setStateAsync("info.connection", { val: false, ack: true });
      const host = (0, import_coerce.coerceHost)(config.host);
      if (!host) {
        this.log.error("NUT server host is required \u2014 check adapter configuration");
        return;
      }
      const port = (0, import_coerce.coercePort)(config.port);
      const commandTimeoutMs = (0, import_coerce.coerceCommandTimeoutMs)(config.commandTimeout);
      this.log.debug(`commandTimeout: raw=${JSON.stringify(config.commandTimeout)} resolved=${commandTimeoutMs}ms`);
      const localAddress = typeof config.networkInterface === "string" && config.networkInterface.trim().length > 0 ? config.networkInterface.trim() : void 0;
      this.client = new import_nut_client.NutClient(host, port, {
        localAddress,
        commandTimeout: commandTimeoutMs,
        logger: {
          debug: (m) => this.log.debug(m),
          warn: (m) => this.log.warn(m),
          info: (m) => this.log.info(m)
        }
      });
      this.stateManager = new import_state_manager.StateManager(this);
      this.client.setOnReconnect(() => {
        void this.rediscover().catch(
          (err) => this.log.error(`Rediscovery after reconnect failed: ${(0, import_coerce.errText)(err)}`)
        );
      });
      try {
        await this.client.connect();
      } catch (err) {
        this.log.error(`Cannot connect to NUT server ${host}:${port} \u2014 ${(0, import_coerce.errText)(err)}`);
        return;
      }
      await this.discover();
      if (config.username && config.password) {
        try {
          await this.client.authenticate(config.username, config.password);
          this.authenticated = true;
          for (const ups of this.discoveredUps.keys()) {
            await this.client.login(ups);
          }
          this.log.debug(`Authenticated and logged in to ${this.discoveredUps.size} UPS(es)`);
        } catch (err) {
          this.log.error(`Authentication failed: ${(0, import_coerce.errText)(err)} \u2014 check NUT server credentials`);
          this.log.info(
            `NUT adapter running without authentication \u2014 fix credentials and use connection test in admin`
          );
          this.client.destroy();
          return;
        }
      }
      if (this.authenticated && config.enableCommands) {
        for (const ups of this.discoveredUps.keys()) {
          try {
            const commands = await this.client.listCmd(ups);
            await this.stateManager.createCommandButtons(ups, commands);
            this.log.debug(`Created ${commands.length} command buttons for ${ups}`);
          } catch (err) {
            this.log.debug(`Failed to list commands for ${ups}: ${(0, import_coerce.errText)(err)}`);
          }
        }
      }
      await this.poll();
      const pollSec = (0, import_coerce.coercePollIntervalSec)(config.pollInterval);
      this.log.debug(`pollInterval: raw=${JSON.stringify(config.pollInterval)} resolved=${pollSec}s`);
      this.pollTimer = this.setInterval(() => {
        void this.poll();
      }, pollSec * 1e3);
      if (config.enableCommands || config.enableSetVar) {
        await this.subscribeStatesAsync("*");
      }
      const authStatus = this.authenticated ? "authenticated" : "no credentials";
      this.log.info(
        `NUT adapter started \u2014 ${this.discoveredUps.size} UPS(es) on ${host}:${port}, polling every ${pollSec}s (${authStatus})`
      );
    } catch (err) {
      this.log.error(`onReady failed: ${(0, import_coerce.errText)(err)}`);
    }
  }
  async discover() {
    if (!this.client || !this.stateManager) {
      return;
    }
    const upsList = await this.client.listUps();
    this.log.debug(`Discovered ${upsList.length} UPS(es): ${upsList.map((u) => u.name).join(", ")}`);
    this.discoveredUps.clear();
    for (const ups of upsList) {
      this.discoveredUps.set(ups.name, ups);
      await this.stateManager.ensureUpsDevice(ups.name, ups.description);
    }
    const knownNames = new Set(this.discoveredUps.keys());
    await this.stateManager.cleanupRemovedUps(knownNames);
    await this.stateManager.cleanupLegacyObjects(knownNames);
  }
  async rediscover() {
    if (!this.client) {
      return;
    }
    const config = this.config;
    if (this.authenticated && config.username && config.password) {
      try {
        await this.client.authenticate(config.username, config.password);
        for (const ups of this.discoveredUps.keys()) {
          await this.client.login(ups);
        }
      } catch (err) {
        this.log.warn(`Re-authentication after reconnect failed: ${(0, import_coerce.errText)(err)}`);
      }
    }
    this.enrichedUps.clear();
    await this.discover();
  }
  classifyError(err) {
    if (err instanceof import_nut_client.NutError) {
      return err.code;
    }
    if (!(err instanceof Error)) {
      return "UNKNOWN";
    }
    const code = err.code;
    if (code === "ENOTFOUND" || code === "ECONNREFUSED" || code === "ECONNRESET" || code === "ENETUNREACH" || code === "EHOSTUNREACH" || code === "EAI_AGAIN") {
      return "NETWORK";
    }
    if (code === "ETIMEDOUT" || err.message.includes("timed out")) {
      return "TIMEOUT";
    }
    return code || "UNKNOWN";
  }
  async poll() {
    var _a;
    if (this.isPolling) {
      this.log.debug("Skipping poll \u2014 previous poll still running");
      return;
    }
    if (!this.client || !this.stateManager) {
      return;
    }
    this.log.debug(`poll: starting (lastErrorCode='${this.lastErrorCode}', upsCount=${this.discoveredUps.size})`);
    this.isPolling = true;
    try {
      for (const upsName of this.discoveredUps.keys()) {
        try {
          const [variables, rwVars] = await Promise.all([
            this.client.listVar(upsName),
            this.client.listRw(upsName).catch((err) => {
              this.log.debug(`LIST RW ${upsName} failed (non-critical): ${(0, import_coerce.errText)(err)}`);
              return [];
            })
          ]);
          const rwNames = new Set(rwVars.map((v) => v.name));
          await this.stateManager.updateVariables(upsName, variables, rwNames);
          const upsDesc = this.discoveredUps.get(upsName);
          await this.stateManager.updateDeviceName(upsName, (_a = upsDesc == null ? void 0 : upsDesc.description) != null ? _a : "", variables);
          const statusVar = variables.find((v) => v.name === "ups.status");
          if (statusVar) {
            await this.stateManager.updateStatusFlags(upsName, statusVar.value);
          }
          if (!this.enrichedUps.has(upsName) && rwVars.length > 0) {
            for (const rw of rwVars) {
              const stateId = (0, import_state_manager.nutVarToStateId)(upsName, rw.name);
              try {
                const enumVals = await this.client.listEnum(upsName, rw.name);
                if (enumVals.length > 0) {
                  const states = {};
                  for (const v of enumVals) {
                    states[v] = v;
                  }
                  await this.stateManager.enrichStateMetadata(stateId, { states });
                }
              } catch (err) {
                this.log.debug(`LIST ENUM ${upsName} ${rw.name}: not supported (${(0, import_coerce.errText)(err)})`);
              }
              try {
                const ranges = await this.client.listRange(upsName, rw.name);
                if (ranges.length > 0) {
                  const min = parseFloat(ranges[0].min);
                  const max = parseFloat(ranges[0].max);
                  const patch = {};
                  if (!Number.isNaN(min)) {
                    patch.min = min;
                  }
                  if (!Number.isNaN(max)) {
                    patch.max = max;
                  }
                  await this.stateManager.enrichStateMetadata(stateId, patch);
                }
              } catch (err) {
                this.log.debug(`LIST RANGE ${upsName} ${rw.name}: not supported (${(0, import_coerce.errText)(err)})`);
              }
            }
            this.enrichedUps.add(upsName);
          }
          await this.setStateAsync(`${upsName}.info.online`, { val: true, ack: true });
          if (this.failedUps.has(upsName)) {
            this.log.info(`UPS '${upsName}' recovered`);
            this.failedUps.delete(upsName);
          }
        } catch (err) {
          await this.setStateAsync(`${upsName}.info.online`, { val: false, ack: true });
          const msg = `Failed to poll UPS '${upsName}': ${(0, import_coerce.errText)(err)}`;
          if (this.failedUps.has(upsName)) {
            this.log.debug(msg);
          } else {
            const isDataStale = err instanceof import_nut_client.NutError && err.code === "DATA-STALE";
            if (isDataStale) {
              this.log.warn(`UPS '${upsName}': driver reports stale data \u2014 keeping existing states`);
            } else {
              this.log.warn(msg);
            }
            this.failedUps.add(upsName);
          }
        }
      }
      await this.setStateAsync("info.connection", { val: true, ack: true });
      if (this.lastErrorCode) {
        this.log.info("Connection restored");
        this.lastErrorCode = "";
      }
    } catch (err) {
      const errMsg = (0, import_coerce.errText)(err);
      const errorCode = this.classifyError(err);
      const isRepeat = errorCode === this.lastErrorCode;
      this.lastErrorCode = errorCode;
      if (isRepeat) {
        this.log.debug(`Poll failed (ongoing): ${errMsg}`);
      } else if (errorCode === "NETWORK") {
        this.log.warn("Cannot reach NUT server \u2014 will keep retrying");
      } else {
        this.log.error(`Poll failed: ${errMsg}`);
      }
      await this.setStateAsync("info.connection", { val: false, ack: true });
    } finally {
      this.isPolling = false;
    }
  }
  async onStateChange(id, state) {
    try {
      if (!state || state.ack) {
        return;
      }
      const config = this.config;
      const localId = id.replace(`${this.namespace}.`, "");
      this.log.debug(`onStateChange: ${localId} val=${JSON.stringify(state.val)}`);
      if (!this.client) {
        this.log.debug(`onStateChange: ignoring ${localId} \u2014 no client connection`);
        return;
      }
      const parts = localId.split(".");
      if (parts.length < 3) {
        this.log.debug(`onStateChange: unexpected id structure '${localId}', ignoring`);
        return;
      }
      const upsName = parts[0];
      if (!this.discoveredUps.has(upsName)) {
        this.log.debug(`onStateChange: unknown UPS '${upsName}', ignoring`);
        return;
      }
      if (parts[1] === "commands") {
        if (!config.enableCommands) {
          this.log.warn(`Command blocked \u2014 enableCommands is disabled: ${localId}`);
          return;
        }
        const cmdName = parts.slice(2).join(".").replace(/-/g, ".");
        this.log.debug(`INSTCMD ${upsName} ${cmdName}`);
        try {
          await this.client.instCmd(upsName, cmdName);
          this.log.info(`Command executed: ${cmdName} on ${upsName}`);
        } catch (err) {
          this.log.error(`Command failed: ${cmdName} on ${upsName} \u2014 ${(0, import_coerce.errText)(err)}`);
        }
        await this.setStateAsync(id, { val: false, ack: true });
        return;
      }
      if (!config.enableSetVar) {
        this.log.warn(`SET VAR blocked \u2014 enableSetVar is disabled: ${localId}`);
        return;
      }
      const varName = `${parts[1]}.${parts.slice(2).join(".").replace(/-/g, ".")}`;
      const value = String(state.val);
      this.log.debug(`SET VAR ${upsName} ${varName} "${value}"`);
      try {
        await this.client.setVar(upsName, varName, value);
        await this.setStateAsync(id, { val: state.val, ack: true });
        this.log.info(`Variable set: ${varName} = "${value}" on ${upsName}`);
      } catch (err) {
        this.log.error(`SET VAR failed: ${varName} on ${upsName} \u2014 ${(0, import_coerce.errText)(err)}`);
      }
    } catch (err) {
      this.log.error(`onStateChange failed: ${(0, import_coerce.errText)(err)}`);
    }
  }
  async onMessage(obj) {
    try {
      await (0, import_message_router.dispatchMessage)(obj, {
        log: {
          debug: (m) => this.log.debug(m),
          warn: (m) => this.log.warn(m)
        },
        sendTo: this.sendTo.bind(this),
        createTestClient: (0, import_message_router.makeTestClientFactory)(import_nut_client.NutClient, {
          debug: (m) => this.log.debug(m),
          warn: (m) => this.log.warn(m),
          info: (m) => this.log.info(m)
        }),
        onTestClientCreated: (client) => {
          this.testClients.add(client);
        },
        onTestClientDone: (client) => {
          this.testClients.delete(client);
        }
      });
    } catch (err) {
      this.log.error(`onMessage failed: ${(0, import_coerce.errText)(err)}`);
    }
  }
  onUnload(callback) {
    var _a, _b;
    try {
      if (this.pollTimer) {
        this.clearInterval(this.pollTimer);
        this.pollTimer = void 0;
      }
      (_a = this.client) == null ? void 0 : _a.cancelAll();
      (_b = this.client) == null ? void 0 : _b.destroy();
      for (const tc of this.testClients) {
        tc.destroy();
      }
      this.testClients.clear();
      if (this.unhandledRejectionHandler) {
        process.off("unhandledRejection", this.unhandledRejectionHandler);
        this.unhandledRejectionHandler = null;
      }
      if (this.uncaughtExceptionHandler) {
        process.off("uncaughtException", this.uncaughtExceptionHandler);
        this.uncaughtExceptionHandler = null;
      }
      void this.setState("info.connection", { val: false, ack: true }).catch(() => {
      });
    } catch (err) {
      this.log.debug(`onUnload error (ignored): ${(0, import_coerce.errText)(err)}`);
    }
    callback();
  }
}
if (require.main !== module) {
  module.exports = (options) => new NutAdapter(options);
} else {
  (() => new NutAdapter())();
}
//# sourceMappingURL=main.js.map
