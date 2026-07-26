"use strict";
var __create = Object.create;
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __getProtoOf = Object.getPrototypeOf;
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
var __toESM = (mod, isNodeMode, target) => (target = mod != null ? __create(__getProtoOf(mod)) : {}, __copyProps(
  // If the importer is in node compatibility mode or this is not an ESM
  // file that has been converted to a CommonJS file using a Babel-
  // compatible transform (i.e. "__esModule" has not been set), then set
  // "default" to the CommonJS "module.exports" for node compatibility.
  isNodeMode || !mod || !mod.__esModule ? __defProp(target, "default", { value: mod, enumerable: true }) : target,
  mod
));
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);
var main_exports = {};
__export(main_exports, {
  NutAdapter: () => NutAdapter
});
module.exports = __toCommonJS(main_exports);
var utils = __toESM(require("@iobroker/adapter-core"));
var import_adapter_core = require("@iobroker/adapter-core");
var import_node_path = require("node:path");
var import_coerce = require("./lib/coerce");
var import_message_router = require("./lib/message-router");
var import_nut_client = require("./lib/nut-client");
var import_state_manager = require("./lib/state-manager");
var import_type_detector = require("./lib/type-detector");
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
  subscribed = false;
  unloaded = false;
  everConnected = false;
  /** @param options Adapter options forwarded to the ioBroker base class. */
  constructor(options = {}) {
    super({ ...options, name: "nut2" });
    this.on("ready", this.onReady.bind(this));
    this.on("stateChange", this.onStateChange.bind(this));
    this.on("unload", this.onUnload.bind(this));
    this.on("message", this.onMessage.bind(this));
  }
  /** The native config, typed — single cast point for all config reads. */
  nutConfig() {
    return this.config;
  }
  // Factory seams — production builds the real collaborators; the orchestration
  // unit tests (src/main.test.ts) override these fields with fakes so onReady,
  // onConnected and poll can run without sockets or a js-controller.
  makeClient = (...args) => new import_nut_client.NutClient(...args);
  makeStateManager = () => new import_state_manager.StateManager(this);
  // Single source for the {debug,warn,info} logger passed to the NUT client, the test-client
  // factory and the message router — avoids rebuilding the same wrapper at three call sites.
  get nutLogger() {
    return {
      debug: (m) => this.log.debug(m),
      warn: (m) => this.log.warn(m),
      info: (m) => this.log.info(m)
    };
  }
  async onReady() {
    try {
      await import_adapter_core.I18n.init((0, import_node_path.join)(this.adapterDir, "admin"), this);
      const config = this.nutConfig();
      this.log.debug(
        `onReady: starting (host='${config.host}', port=${JSON.stringify(config.port)}, pollInterval=${JSON.stringify(config.pollInterval)}s)`
      );
      await this.setStateChangedAsync("info.connection", { val: false, ack: true });
      const host = (0, import_coerce.coerceHost)(config.host);
      if (!host) {
        this.log.error("NUT server host is required \u2014 check adapter configuration");
        return;
      }
      const port = (0, import_coerce.coercePort)(config.port);
      const commandTimeoutMs = (0, import_coerce.coerceCommandTimeoutMs)(config.commandTimeout);
      this.log.debug(`commandTimeout: raw=${JSON.stringify(config.commandTimeout)} resolved=${commandTimeoutMs}ms`);
      const localAddress = (0, import_coerce.localAddressOf)(config.networkInterface);
      this.client = this.makeClient(host, port, {
        localAddress,
        commandTimeout: commandTimeoutMs,
        useTls: !!config.useTls,
        tlsRejectUnauthorized: !!config.tlsRejectUnauthorized,
        // Inject the adapter-managed timers so the client's command/reconnect timeouts are
        // tracked and auto-cleared on unload (no native setTimeout leaks).
        setTimer: (cb, ms) => this.setTimeout(cb, ms),
        clearTimer: (h) => {
          if (h != null) {
            this.clearTimeout(h);
          }
        },
        logger: this.nutLogger
      });
      this.stateManager = this.makeStateManager();
      this.client.setOnConnect(() => {
        void this.onConnected().catch((err) => this.log.error(`onConnected failed: ${(0, import_coerce.errText)(err)}`));
      });
      this.client.setOnFatal((err) => this.onConnectFatal(err));
      this.client.start();
    } catch (err) {
      this.log.error(`onReady failed: ${(0, import_coerce.errText)(err)}`);
    }
  }
  /**
   * Idempotent post-connect setup, run on the initial connect AND every reconnect (the client's
   * single retry loop drives both): discover UPSes, (re-)authenticate, refresh command buttons,
   * poll, and arm the poll timer + subscription once. Auth failure goes yellow and stops the
   * loop via destroy(). Making "initial == reconnect" one path keeps the two from drifting.
   */
  async onConnected() {
    var _a;
    if (this.unloaded || !this.client || !this.stateManager) {
      return;
    }
    const config = this.nutConfig();
    const host = (_a = (0, import_coerce.coerceHost)(config.host)) != null ? _a : "";
    const port = (0, import_coerce.coercePort)(config.port);
    const pollSec = (0, import_coerce.coercePollIntervalSec)(config.pollInterval);
    try {
      this.enrichedUps.clear();
      await this.discover();
      if (!await this.authenticateIfConfigured(host, port)) {
        return;
      }
      await this.setupCommandButtons();
      await this.poll();
      this.armPollTimer(config.pollInterval, pollSec);
      if (!this.subscribed && (config.enableCommands || config.enableSetVar)) {
        await this.subscribeStatesAsync("*");
        this.subscribed = true;
      }
      if (this.everConnected) {
        this.log.info(`Reconnected to NUT server ${host}:${port} \u2014 ${this.discoveredUps.size} UPS(es)`);
      } else {
        this.everConnected = true;
        const authStatus = this.authenticated ? "authenticated" : "no credentials";
        this.log.info(
          `NUT adapter started \u2014 ${this.discoveredUps.size} UPS(es) on ${host}:${port}, polling every ${pollSec}s (${authStatus})`
        );
      }
    } catch (err) {
      this.log.error(`Post-connect setup failed: ${(0, import_coerce.errText)(err)}`);
      this.armPollTimer(config.pollInterval, pollSec);
    }
  }
  /**
   * Authenticate when credentials are configured. USERNAME/PASSWORD is all that GET/LIST + SET VAR
   * + INSTCMD need; we deliberately do NOT send LOGIN per UPS (NUT permits only one LOGIN per
   * connection, so a multi-UPS server fails the second with ALREADY-LOGGED-IN, and LOGIN only
   * matters for upsmon shutdown coordination, which this adapter does not do).
   *
   * @param host NUT server host (for logging)
   * @param port NUT server port (for logging)
   * @returns true to continue setup; false when authentication failed and the client was destroyed
   */
  async authenticateIfConfigured(host, port) {
    this.authenticated = false;
    const config = this.nutConfig();
    if (!config.username || !config.password || !this.client) {
      return true;
    }
    try {
      await this.client.authenticate(config.username, config.password);
      this.authenticated = true;
      this.log.debug(`Authenticated to NUT server ${host}:${port}`);
      return true;
    } catch (err) {
      this.log.error(`Authentication failed: ${(0, import_coerce.errText)(err)} \u2014 check NUT server credentials`);
      this.log.info(
        `Authentication required \u2014 adapter is idle (yellow) until the credentials are corrected; use the connection test in admin to verify them`
      );
      this.client.destroy();
      await this.setStateChangedAsync("info.connection", { val: false, ack: true });
      return false;
    }
  }
  /**
   * Create instant-command button states for every discovered UPS. Only runs when we authenticated
   * and commands are enabled; each UPS is best-effort.
   */
  async setupCommandButtons() {
    if (!this.authenticated || !this.nutConfig().enableCommands || !this.client || !this.stateManager) {
      return;
    }
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
  /**
   * Arm the periodic poll timer once. Called on the normal setup path and again from the
   * post-connect error handler, so a non-connection failure on a live socket still recovers.
   *
   * @param rawInterval Raw configured poll interval, logged for diagnostics
   * @param pollSec Resolved poll interval in seconds
   */
  armPollTimer(rawInterval, pollSec) {
    if (this.unloaded || this.pollTimer !== void 0) {
      return;
    }
    this.log.debug(`pollInterval: raw=${JSON.stringify(rawInterval)} resolved=${pollSec}s`);
    this.pollTimer = this.setInterval(() => {
      void this.poll();
    }, pollSec * 1e3);
  }
  /**
   * The persistent connection failed fatally (TLS misconfiguration). The client already stopped
   * retrying; stay alive + yellow so the admin connection-test button remains usable.
   *
   * @param err The fatal connect/STARTTLS error
   */
  onConnectFatal(err) {
    var _a, _b;
    const config = this.nutConfig();
    const host = (_a = (0, import_coerce.coerceHost)(config.host)) != null ? _a : "";
    const port = (0, import_coerce.coercePort)(config.port);
    this.log.error(
      `TLS connection to NUT server ${host}:${port} failed: ${(0, import_coerce.errText)(err)} \u2014 verify the server offers STARTTLS and check the certificate setting`
    );
    (_b = this.client) == null ? void 0 : _b.destroy();
    void this.setStateChangedAsync("info.connection", { val: false, ack: true }).catch(() => {
    });
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
    for (const name of this.failedUps) {
      if (!knownNames.has(name)) {
        this.failedUps.delete(name);
      }
    }
    for (const name of this.enrichedUps) {
      if (!knownNames.has(name)) {
        this.enrichedUps.delete(name);
      }
    }
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
    var _a, _b, _c, _d;
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
            this.nutConfig().enableSetVar ? this.client.listRw(upsName).catch((err) => {
              this.log.debug(`LIST RW ${upsName} failed (non-critical): ${(0, import_coerce.errText)(err)}`);
              return [];
            }) : Promise.resolve([])
          ]);
          const rwNames = new Set(rwVars.map((v) => v.name));
          await this.stateManager.updateVariables(upsName, variables, rwNames);
          const upsDesc = this.discoveredUps.get(upsName);
          await this.stateManager.updateDeviceName(upsName, (_a = upsDesc == null ? void 0 : upsDesc.description) != null ? _a : "", variables);
          const statusVar = variables.find((v) => v.name === "ups.status");
          if (statusVar) {
            const chargerStatus = (_b = variables.find((v) => v.name === "battery.charger.status")) == null ? void 0 : _b.value;
            await this.stateManager.updateStatusFlags(upsName, statusVar.value, chargerStatus);
          }
          await this.enrichWritableVars(upsName, rwVars);
          await this.setStateChangedAsync(`${upsName}.info.reachable`, { val: true, ack: true });
          if (this.failedUps.has(upsName)) {
            this.log.info(`UPS '${upsName}' recovered`);
            this.failedUps.delete(upsName);
          }
        } catch (err) {
          await this.setStateChangedAsync(`${upsName}.info.reachable`, { val: false, ack: true });
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
      await this.setStateChangedAsync("info.connection", { val: (_d = (_c = this.client) == null ? void 0 : _c.isConnected) != null ? _d : false, ack: true });
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
      await this.setStateChangedAsync("info.connection", { val: false, ack: true });
    } finally {
      this.isPolling = false;
    }
  }
  /**
   * Enrich writable variables with ENUM (common.states) and RANGE (min/max) metadata, once per UPS
   * per connection (guarded by enrichedUps). Each query is best-effort — a driver that does not
   * support LIST ENUM/RANGE just logs at debug.
   *
   * @param upsName UPS identifier
   * @param rwVars Writable variables from LIST RW
   */
  async enrichWritableVars(upsName, rwVars) {
    if (!this.client || !this.stateManager || this.enrichedUps.has(upsName) || rwVars.length === 0) {
      return;
    }
    for (const rw of rwVars) {
      const stateId = (0, import_state_manager.nutVarToStateId)(upsName, rw.name);
      const isBoolean = (0, import_type_detector.detectType)(rw.name, rw.value, true).type === "boolean";
      if (!isBoolean) {
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
      }
      try {
        const ranges = await this.client.listRange(upsName, rw.name);
        if (ranges.length > 0) {
          const min = (0, import_coerce.parseDecimal)(ranges[0].min);
          const max = (0, import_coerce.parseDecimal)(ranges[0].max);
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
  async onStateChange(id, state) {
    var _a, _b, _c, _d;
    try {
      if (!state || state.ack) {
        return;
      }
      const config = this.nutConfig();
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
        const cmdName = (_b = (_a = this.stateManager) == null ? void 0 : _a.nutNameForState(localId)) != null ? _b : parts.slice(2).join(".").replace(/-/g, ".");
        this.log.debug(`INSTCMD ${upsName} ${cmdName}`);
        try {
          await this.client.instCmd(upsName, cmdName);
          this.log.info(`Command executed: ${cmdName} on ${upsName}`);
        } catch (err) {
          this.log.error(`Command failed: ${cmdName} on ${upsName} \u2014 ${(0, import_coerce.errText)(err)}`);
        }
        await this.setState(id, { val: false, ack: true });
        return;
      }
      if (!config.enableSetVar) {
        this.log.warn(`SET VAR blocked \u2014 enableSetVar is disabled: ${localId}`);
        return;
      }
      const varName = (_d = (_c = this.stateManager) == null ? void 0 : _c.nutNameForState(localId)) != null ? _d : `${parts[1]}.${parts.slice(2).join(".").replace(/-/g, ".")}`;
      const value = typeof state.val === "boolean" ? state.val ? "yes" : "no" : String(state.val);
      this.log.debug(`SET VAR ${upsName} ${varName} "${value}"`);
      try {
        await this.client.setVar(upsName, varName, value);
        await this.setState(id, { val: state.val, ack: true });
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
        log: this.nutLogger,
        sendTo: this.sendTo.bind(this),
        createTestClient: (0, import_message_router.makeTestClientFactory)(import_nut_client.NutClient, this.nutLogger),
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
      this.unloaded = true;
      if (this.pollTimer) {
        this.clearInterval(this.pollTimer);
        this.pollTimer = void 0;
      }
      if (this.authenticated) {
        (_a = this.client) == null ? void 0 : _a.shutdown();
      } else {
        (_b = this.client) == null ? void 0 : _b.destroy();
      }
      for (const tc of this.testClients) {
        tc.destroy();
      }
      this.testClients.clear();
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
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  NutAdapter
});
//# sourceMappingURL=main.js.map
