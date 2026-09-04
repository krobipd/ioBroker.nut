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
const NOTIFY_WARN_CAP = 100;
class NutAdapter extends utils.Adapter {
  client = null;
  stateManager = null;
  pollTimer = void 0;
  pollIntervalMs = 0;
  isPolling = false;
  pollAgainRequested = false;
  /** Unknown UPS names seen on the notify trigger — warn once each, then debug (no log spam). */
  warnedNotifyRefs = /* @__PURE__ */ new Set();
  lastErrorCode = "";
  failedUps = /* @__PURE__ */ new Set();
  discoveredUps = /* @__PURE__ */ new Map();
  authenticated = false;
  credentialsSent = false;
  /** Credentials were reported as refused — warn once, then debug until they work again. */
  warnedCredentialsRejected = false;
  /** Commands enabled without credentials — say it once, not on every reconnect. */
  warnedCommandsWithoutCredentials = false;
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
  /**
   * Connection options for every client this adapter builds — the live one and the short-lived
   * verification connection. One source, so the probe really exercises the same path (source bind
   * on a multi-homed host, TLS settings, command deadline).
   */
  clientOptions() {
    const config = this.nutConfig();
    return {
      localAddress: (0, import_coerce.localAddressOf)(config.networkInterface),
      commandTimeout: (0, import_coerce.coerceCommandTimeoutMs)(config.commandTimeout),
      useTls: !!config.useTls,
      tlsRejectUnauthorized: !!config.tlsRejectUnauthorized,
      tlsCaFile: typeof config.tlsCaFile === "string" ? config.tlsCaFile : "",
      // Inject the adapter-managed timers so the client's command/reconnect timeouts are
      // tracked and auto-cleared on unload (no native setTimeout leaks).
      setTimer: (cb, ms) => this.setTimeout(cb, ms),
      clearTimer: (h) => {
        if (h != null) {
          this.clearTimeout(h);
        }
      },
      logger: this.nutLogger
    };
  }
  // Single source for the {debug,warn,info} logger passed to the NUT client, the test-client
  // factory and the message router — avoids rebuilding the same wrapper at three call sites.
  get nutLogger() {
    return {
      debug: (m) => this.log.debug(m),
      warn: (m) => this.log.warn(m),
      info: (m) => this.log.info(m)
    };
  }
  /**
   * Remove `supportedMessages` from this instance's own object — the whole key, not just its
   * `stopInstance` entry.
   *
   * Two defects hang on this one key, and the fix for the first caused the second:
   *
   * 1. `stopInstance: true` (manifest of v0.8.0 and earlier) makes the host kill the process one
   *    second after asking it to stop — `onUnload` never runs and every state written while
   *    shutting down is dead code. Dropping it from the manifest only helps a FRESH install: an
   *    upgrade merges the manifest into the existing instance object and never removes a key, so
   *    the old value survives in the database, and that is what the host reads.
   * 2. Writing `stopInstance: false` (v0.9.0–v0.12.0) fixed the shutdown but silently killed the
   *    message box, so the admin connection test did nothing at all: js-controller decides the
   *    subscription with `isMessageboxSupported()` — once `common.supportedMessages` is an
   *    OBJECT, `common.messagebox` is not even looked at, and a set of entries that are all
   *    `false` means "no messages" (`js-controller-adapter/lib/adapter/utils.js`, verified on the
   *    installed 7.2.2). The adapter then never subscribes and the message sits unread.
   *
   * Both are cured by deleting the key. `extendObject` merges and cannot remove anything, so the
   * key is overwritten with `null` — which does erase it (`node.extend` copies `null`, skips
   * `undefined`) and takes `isMessageboxSupported` back to the `common.messagebox` branch.
   *
   * Only written while the key is still there: every instance-object change restarts the
   * instance, so doing it unconditionally would be a restart loop.
   *
   * @returns true when the correction was written and the restart is coming — the caller has to
   *   stop right there. Carrying on would arm timers and write states in a process the host is
   *   already shutting down.
   */
  async clearStopInstanceFlag() {
    var _a;
    const id = `system.adapter.${this.namespace}`;
    try {
      const obj = await this.getForeignObjectAsync(id);
      if (((_a = obj == null ? void 0 : obj.common) == null ? void 0 : _a.supportedMessages) === void 0 || obj.common.supportedMessages === null) {
        return false;
      }
      this.log.info("Correcting a leftover setting from an earlier version \u2014 this instance restarts once");
      await this.extendForeignObjectAsync(id, { common: { supportedMessages: null } });
      return true;
    } catch (err) {
      this.log.debug(`Could not check the instance object ${id}: ${(0, import_coerce.errText)(err)}`);
      return false;
    }
  }
  /**
   * Nothing is being read right now — take the whole chain down together: every device marker
   * (that is what colours the device in the object tree) and the summary. `info.connection` is
   * written by each caller, because only they know whether the connection itself is the reason.
   *
   * Used by every dead end that is NOT a per-UPS failure: authentication rejected, a fatal TLS
   * problem, and a poll that failed as a whole. Leaving a UPS green next to "0 of 1 reachable"
   * is the contradiction this exists to prevent.
   */
  async markAllUpsUnreachable() {
    var _a;
    for (const upsId of this.discoveredUps.keys()) {
      await this.setStateChangedAsync(`${upsId}.info.reachable`, { val: false, ack: true });
    }
    await ((_a = this.stateManager) == null ? void 0 : _a.writeUpsSummary(this.discoveredUps.size, 0));
  }
  async onReady() {
    try {
      if (await this.clearStopInstanceFlag()) {
        return;
      }
      await import_adapter_core.I18n.init((0, import_node_path.join)(this.adapterDir, "admin"), this);
      const config = this.nutConfig();
      this.log.debug(
        `onReady: starting (host='${config.host}', port=${JSON.stringify(config.port)}, pollInterval=${JSON.stringify(config.pollInterval)}s)`
      );
      await this.setStateChangedAsync("info.connection", { val: false, ack: true });
      this.stateManager = this.makeStateManager();
      await this.stateManager.refreshInstanceObjects();
      await this.stateManager.markAllUnreachable();
      await this.subscribeStatesAsync("notify");
      const host = (0, import_coerce.coerceHost)(config.host);
      if (!host) {
        this.log.error("NUT server host is required \u2014 check adapter configuration");
        return;
      }
      const port = (0, import_coerce.coercePort)(config.port);
      const commandTimeoutMs = (0, import_coerce.coerceCommandTimeoutMs)(config.commandTimeout);
      this.log.debug(`commandTimeout: raw=${JSON.stringify(config.commandTimeout)} resolved=${commandTimeoutMs}ms`);
      this.client = this.makeClient(host, port, this.clientOptions());
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
   * single retry loop drives both): discover UPSes, send the credentials + verify them, refresh
   * command buttons, poll, and arm the poll timer + subscription once. Rejected credentials warn
   * but never stop the polling — reading needs no login. Making "initial == reconnect" one path
   * keeps the two from drifting.
   */
  async onConnected() {
    var _a, _b;
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
      await this.verifyCredentials(host, port);
      await this.setupCommandButtons();
      await this.poll();
      this.armPollTimer(config.pollInterval, pollSec);
      if (!this.subscribed && (config.enableCommands || config.enableSetVar)) {
        await this.subscribeStatesAsync("*");
        this.subscribed = true;
      }
      const transport = ((_b = this.client) == null ? void 0 : _b.isTls) ? "TLS" : "unencrypted";
      if (this.everConnected) {
        this.log.info(`Reconnected to NUT server ${host}:${port} (${transport}) \u2014 ${this.discoveredUps.size} UPS(es)`);
      } else {
        this.everConnected = true;
        const authStatus = this.credentialsSent ? this.authenticated ? `logged in as ${config.username}` : `credentials for ${config.username} rejected \u2014 reading only` : "no credentials";
        this.log.info(
          `NUT adapter started \u2014 ${this.discoveredUps.size} UPS(es) on ${host}:${port}, polling every ${pollSec}s (${authStatus}, ${transport})`
        );
      }
    } catch (err) {
      this.log.error(`Post-connect setup failed: ${(0, import_coerce.errText)(err)}`);
      this.armPollTimer(config.pollInterval, pollSec);
    }
  }
  /**
   * Send the credentials on the live connection and verify them on a SEPARATE, short-lived one.
   *
   * `USERNAME`/`PASSWORD` are only stored by upsd (`server/netuser.c`) — they prove nothing. The
   * command that really checks them is `LOGIN` (`user_checkaction`, `user.c`), and that is what
   * the verification connection sends, so a wrong password or a missing `upsmon secondary`
   * /`upsmon primary` line in `upsd.users` is reported instead of surfacing much later on the
   * first write.
   *
   * ⚠️ Why the login does NOT stay on the live connection (measured in the NUT 2.8.5 sources):
   * upsd counts every login (`ups->numlogins`, `server/netuser.c`) and only decrements it when the
   * connection closes (`declogins` in `server/upsd.c`, called from `client_disconnect` — `LOGOUT`
   * itself just ends the session). A PRIMARY `upsmon` reads that counter during a power failure
   * and waits until nothing but its own login is left before shutting the machine down, up to
   * `HOSTSYNC` seconds (`clients/upsmon.c`). A permanently logged-in monitoring client would delay
   * that shutdown on battery. The official read-only tools (`upsc`, `upscmd`, `upsrw`) never send
   * `LOGIN` for the same reason; only `upsmon` does, because there the login IS the signal.
   *
   * A rejection never stops the adapter: reading needs no login at all, so the poll keeps running
   * and only the log, the start line and the connection test say that the credentials were refused.
   *
   * @param host NUT server host (for logging)
   * @param port NUT server port (for logging)
   */
  async verifyCredentials(host, port) {
    var _a;
    this.authenticated = false;
    this.credentialsSent = false;
    const config = this.nutConfig();
    if (!config.username || !config.password || !this.client) {
      return;
    }
    try {
      await this.client.authenticate(config.username, config.password);
      this.credentialsSent = true;
    } catch (err) {
      this.log.warn(`Could not send the credentials to NUT server ${host}:${port}: ${(0, import_coerce.errText)(err)}`);
      return;
    }
    const first = this.discoveredUps.values().next().value;
    if (!first) {
      this.log.warn(
        `Credentials are configured but NUT server ${host}:${port} lists no UPS \u2014 nothing to log in to, credentials not verified`
      );
      return;
    }
    if (this.unloaded) {
      return;
    }
    const probe = this.makeClient(host, port, this.clientOptions());
    this.testClients.add(probe);
    try {
      await probe.connect();
      await probe.authenticate(config.username, config.password);
      await probe.login(first.name);
      this.authenticated = true;
      if (this.warnedCredentialsRejected) {
        this.warnedCredentialsRejected = false;
        this.log.info(`NUT server ${host}:${port} accepted the credentials for ${config.username} again`);
      }
      this.log.debug(`Credentials for ${config.username} verified on ${host}:${port} (LOGIN ${first.name})`);
    } catch (err) {
      const message = `NUT server ${host}:${port} rejected the credentials for ${config.username}: ${(_a = (0, import_nut_client.authFailureText)(err)) != null ? _a : (0, import_coerce.errText)(err)}`;
      if (this.warnedCredentialsRejected) {
        this.log.debug(message);
      } else {
        this.warnedCredentialsRejected = true;
        this.log.warn(message);
        this.log.warn(
          "Reading UPS values continues \u2014 it needs no login. Switching a UPS or writing a variable will be refused until the credentials are corrected."
        );
      }
    } finally {
      probe.destroy();
      this.testClients.delete(probe);
    }
  }
  /**
   * Create instant-command button states for every discovered UPS. Runs whenever the credentials
   * were sent and commands are enabled — NOT only after a successful LOGIN: upsd checks a user's
   * `instcmds` right per command, and a user with command rights but without an `upsmon` line
   * cannot LOGIN yet may still switch the UPS (`docs/man/upsd.users.txt`). Each UPS is
   * best-effort; a genuinely unauthorised command is refused by the server and logged.
   */
  async setupCommandButtons() {
    if (!this.nutConfig().enableCommands || !this.client || !this.stateManager) {
      return;
    }
    if (!this.credentialsSent) {
      if (!this.warnedCommandsWithoutCredentials) {
        this.warnedCommandsWithoutCredentials = true;
        this.log.warn(
          "Instant commands are enabled but no credentials are configured \u2014 the NUT server checks command rights per user, so no command buttons are created"
        );
      }
      return;
    }
    for (const [upsId, ups] of this.discoveredUps) {
      try {
        const commands = await this.client.listCmd(ups.name);
        await this.stateManager.createCommandButtons(upsId, commands);
        this.log.debug(`Created ${commands.length} command buttons for ${ups.name}`);
      } catch (err) {
        this.log.debug(`Failed to list commands for ${ups.name}: ${(0, import_coerce.errText)(err)}`);
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
    this.pollIntervalMs = pollSec * 1e3;
    this.scheduleNextPoll();
  }
  /**
   * Schedule the next poll one interval after the previous one FINISHES (a setTimeout chain rather
   * than a fixed setInterval), so a slow poll can never overlap the next tick. pollTimer stays
   * defined between ticks, keeping the armPollTimer idempotency guard and the error-handler
   * recovery re-entry intact; a poll running during onUnload sees unloaded and does not re-arm.
   */
  scheduleNextPoll() {
    if (this.unloaded) {
      return;
    }
    this.pollTimer = this.setTimeout(() => {
      void this.poll().finally(() => this.scheduleNextPoll());
    }, this.pollIntervalMs);
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
      `TLS connection to NUT server ${host}:${port} failed: ${(0, import_coerce.errText)(err)} \u2014 verify the server offers STARTTLS and check the certificate settings (Require valid certificate, CA file)`
    );
    (_b = this.client) == null ? void 0 : _b.destroy();
    void this.setStateChangedAsync("info.connection", { val: false, ack: true }).catch(() => {
    });
    void this.markAllUpsUnreachable().catch(() => {
    });
  }
  /**
   * Make a sanitized UPS name unique among the currently discovered UPSes. Two different NUT names
   * can collapse to the same sanitized object ID (e.g. "u.p" and "u p" → "u_p"); disambiguate
   * deterministically (…-2, …-3) and warn so the collision is visible in the admin.
   *
   * @param baseId Sanitized candidate object ID
   * @param rawName Original NUT name, for the warning
   */
  uniqueUpsId(baseId, rawName) {
    if (!this.discoveredUps.has(baseId)) {
      return baseId;
    }
    let n = 2;
    while (this.discoveredUps.has(`${baseId}-${n}`)) {
      n++;
    }
    const unique = `${baseId}-${n}`;
    this.log.warn(`UPS name '${rawName}' collides with another after sanitization \u2192 using object ID '${unique}'`);
    return unique;
  }
  /**
   * Whether the NUT server's UPS list differs from what was discovered last — by NUT name,
   * order-independent.
   *
   * @param upsList Fresh LIST UPS result
   */
  upsListChanged(upsList) {
    const fresh = upsList.map((u) => u.name).sort();
    const known = [...this.discoveredUps.values()].map((u) => u.name).sort();
    return fresh.length !== known.length || fresh.some((name, i) => name !== known[i]);
  }
  /**
   * Discover the UPS devices on the server and (re)build the object tree for them.
   *
   * @param prefetched LIST UPS result already fetched by the caller (the poll), otherwise fetched here
   */
  async discover(prefetched) {
    if (!this.client || !this.stateManager) {
      return;
    }
    const upsList = prefetched != null ? prefetched : await this.client.listUps();
    this.log.debug(`Discovered ${upsList.length} UPS(es): ${upsList.map((u) => u.name).join(", ")}`);
    this.discoveredUps.clear();
    for (const ups of upsList) {
      const upsId = this.uniqueUpsId((0, import_state_manager.sanitizeUpsName)(ups.name), ups.name);
      this.discoveredUps.set(upsId, ups);
      await this.stateManager.ensureUpsDevice(upsId, ups.description);
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
    var _a, _b, _c;
    if (this.isPolling) {
      this.pollAgainRequested = true;
      this.log.debug("Skipping poll \u2014 previous poll still running");
      return;
    }
    if (!this.client || !this.stateManager) {
      return;
    }
    this.log.debug(`poll: starting (lastErrorCode='${this.lastErrorCode}', upsCount=${this.discoveredUps.size})`);
    this.isPolling = true;
    try {
      const upsList = await this.client.listUps();
      if (this.upsListChanged(upsList)) {
        this.log.info(`UPS list on the NUT server changed: ${upsList.map((u) => u.name).join(", ") || "none"}`);
        await this.discover(upsList);
        await this.setupCommandButtons();
      }
      let reachable = 0;
      for (const [upsId, ups] of this.discoveredUps) {
        const nutName = ups.name;
        try {
          const [variables, rwVars] = await Promise.all([
            this.client.listVar(nutName),
            this.nutConfig().enableSetVar ? this.client.listRw(nutName).catch((err) => {
              this.log.debug(`LIST RW ${nutName} failed (non-critical): ${(0, import_coerce.errText)(err)}`);
              return [];
            }) : Promise.resolve([])
          ]);
          const rwNames = new Set(rwVars.map((v) => v.name));
          await this.stateManager.updateVariables(upsId, variables, rwNames);
          await this.stateManager.updateDeviceName(upsId, ups.description, variables);
          const statusVar = variables.find((v) => v.name === "ups.status");
          if (statusVar) {
            const chargerStatus = (_a = variables.find((v) => v.name === "battery.charger.status")) == null ? void 0 : _a.value;
            await this.stateManager.updateStatusFlags(upsId, statusVar.value, chargerStatus);
          }
          await this.enrichWritableVars(upsId, nutName, rwVars);
          await this.setStateChangedAsync(`${upsId}.info.reachable`, { val: true, ack: true });
          reachable++;
          if (this.failedUps.has(upsId)) {
            this.log.info(`UPS '${nutName}' recovered`);
            this.failedUps.delete(upsId);
          }
        } catch (err) {
          await this.setStateChangedAsync(`${upsId}.info.reachable`, { val: false, ack: true });
          const msg = `Failed to poll UPS '${nutName}': ${(0, import_coerce.errText)(err)}`;
          if (this.failedUps.has(upsId)) {
            this.log.debug(msg);
          } else {
            const isDataStale = err instanceof import_nut_client.NutError && err.code === "DATA-STALE";
            if (isDataStale) {
              this.log.warn(`UPS '${nutName}': driver reports stale data \u2014 keeping existing states`);
            } else {
              this.log.warn(msg);
            }
            this.failedUps.add(upsId);
          }
        }
      }
      await this.setStateChangedAsync("info.connection", { val: (_c = (_b = this.client) == null ? void 0 : _b.isConnected) != null ? _c : false, ack: true });
      await this.stateManager.writeUpsSummary(this.discoveredUps.size, reachable);
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
      await this.markAllUpsUnreachable();
    } finally {
      this.isPolling = false;
      if (this.pollAgainRequested && !this.unloaded) {
        this.pollAgainRequested = false;
        void this.poll();
      }
    }
  }
  /**
   * Enrich writable variables with ENUM (common.states) and RANGE (min/max) metadata, once per UPS
   * per connection (guarded by enrichedUps). Each query is best-effort — a driver that does not
   * support LIST ENUM/RANGE just logs at debug.
   *
   * @param upsId Sanitized UPS object-ID segment (for state IDs)
   * @param nutName Real NUT name (for LIST ENUM/RANGE protocol calls)
   * @param rwVars Writable variables from LIST RW
   */
  async enrichWritableVars(upsId, nutName, rwVars) {
    if (!this.client || !this.stateManager || this.enrichedUps.has(upsId) || rwVars.length === 0) {
      return;
    }
    for (const rw of rwVars) {
      const stateId = (0, import_state_manager.nutVarToStateId)(upsId, rw.name);
      const isBoolean = (0, import_type_detector.detectType)(rw.name, rw.value, true).type === "boolean";
      if (!isBoolean) {
        try {
          const enumVals = await this.client.listEnum(nutName, rw.name);
          if (enumVals.length > 0) {
            const states = {};
            for (const v of enumVals) {
              states[v] = v;
            }
            await this.stateManager.enrichStateMetadata(stateId, { states });
          }
        } catch (err) {
          this.log.debug(`LIST ENUM ${nutName} ${rw.name}: not supported (${(0, import_coerce.errText)(err)})`);
        }
      }
      try {
        const ranges = await this.client.listRange(nutName, rw.name);
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
        this.log.debug(`LIST RANGE ${nutName} ${rw.name}: not supported (${(0, import_coerce.errText)(err)})`);
      }
    }
    this.enrichedUps.add(upsId);
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
      if (localId === "notify") {
        await this.handleNotifyTrigger(state.val);
        return;
      }
      if (!this.client) {
        this.log.debug(`onStateChange: ignoring ${localId} \u2014 no client connection`);
        return;
      }
      const parts = localId.split(".");
      if (parts.length < 3) {
        this.log.debug(`onStateChange: unexpected id structure '${localId}', ignoring`);
        return;
      }
      const upsId = parts[0];
      const ups = this.discoveredUps.get(upsId);
      if (!ups) {
        this.log.debug(`onStateChange: unknown UPS '${upsId}', ignoring`);
        return;
      }
      const nutName = ups.name;
      if (parts[1] === "info" || parts[1] === "status") {
        this.log.debug(`onStateChange: ${localId} is adapter-owned, ignoring write`);
        return;
      }
      if (parts[1] === "commands") {
        if (!config.enableCommands) {
          this.log.warn(`Command blocked \u2014 enableCommands is disabled: ${localId}`);
          return;
        }
        const cmdName = (_b = (_a = this.stateManager) == null ? void 0 : _a.nutNameForState(localId)) != null ? _b : parts.slice(2).join(".").replace(/-/g, ".");
        this.log.debug(`INSTCMD ${nutName} ${cmdName}`);
        try {
          await this.client.instCmd(nutName, cmdName);
          this.log.info(`Command executed: ${cmdName} on ${nutName}`);
        } catch (err) {
          this.log.error(`Command failed: ${cmdName} on ${nutName} \u2014 ${(0, import_coerce.errText)(err)}`);
        }
        await this.setState(id, { val: false, ack: true });
        return;
      }
      if (!config.enableSetVar) {
        this.log.warn(`SET VAR blocked \u2014 enableSetVar is disabled: ${localId}`);
        return;
      }
      if (typeof state.val !== "boolean" && typeof state.val !== "number" && typeof state.val !== "string") {
        this.log.warn(
          `SET VAR ignored \u2014 ${localId} received ${JSON.stringify(state.val)}, not a boolean, number or string`
        );
        return;
      }
      const varName = (_d = (_c = this.stateManager) == null ? void 0 : _c.nutNameForState(localId)) != null ? _d : `${parts[1]}.${parts.slice(2).join(".").replace(/-/g, ".")}`;
      const value = typeof state.val === "boolean" ? state.val ? "yes" : "no" : String(state.val);
      this.log.debug(`SET VAR ${nutName} ${varName} "${value}"`);
      try {
        await this.client.setVar(nutName, varName, value);
        await this.setState(id, { val: state.val, ack: true });
        this.log.info(`Variable set: ${varName} = "${value}" on ${nutName}`);
      } catch (err) {
        this.log.error(`SET VAR failed: ${varName} on ${nutName} \u2014 ${(0, import_coerce.errText)(err)}`);
      }
    } catch (err) {
      this.log.error(`onStateChange failed: ${(0, import_coerce.errText)(err)}`);
    }
  }
  /**
   * A write to the `notify` trigger state — the doorbell upsmon (or a hand on the admin) rings
   * instead of waiting for the next scheduled poll. Value format: `$NOTIFYTYPE $UPSNAME` as
   * upsmon delivers them via NOTIFYCMD; both parts are optional (an empty write is a plain
   * manual refresh).
   *
   * Order is deliberate: record the event and confirm the trigger FIRST, poll second. On a
   * SHUTDOWN event the NUT host may die mid-poll — the event itself must already be safe.
   *
   * @param rawVal Raw state value as written (REST API, script, admin — any shape can arrive)
   */
  async handleNotifyTrigger(rawVal) {
    if (this.unloaded) {
      return;
    }
    const { type, upsRef, text } = (0, import_coerce.parseNotifyTrigger)(rawVal);
    let matchedId;
    if (upsRef) {
      for (const [upsId, ups] of this.discoveredUps) {
        if (ups.name === upsRef) {
          matchedId = upsId;
          break;
        }
      }
      if (!matchedId && this.discoveredUps.has((0, import_state_manager.sanitizeUpsName)(upsRef))) {
        matchedId = (0, import_state_manager.sanitizeUpsName)(upsRef);
      }
      if (!matchedId) {
        const msg = `notify: unknown UPS '${upsRef}' \u2014 refreshing all UPSes, event recorded on the trigger state only`;
        if (this.warnedNotifyRefs.has(upsRef)) {
          this.log.debug(msg);
        } else {
          if (this.warnedNotifyRefs.size >= NOTIFY_WARN_CAP) {
            this.warnedNotifyRefs.clear();
          }
          this.warnedNotifyRefs.add(upsRef);
          this.log.warn(msg);
        }
      }
    }
    if (type) {
      this.log.info(`upsmon event '${type}'${matchedId ? ` for UPS '${matchedId}'` : ""} \u2014 refreshing`);
      if (matchedId) {
        await this.setState(`${matchedId}.info.notify`, { val: type, ack: true });
      }
    } else {
      this.log.debug("notify: manual refresh triggered");
    }
    await this.setState("notify", { val: text, ack: true });
    await this.poll();
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
    var _a;
    try {
      this.unloaded = true;
      if (this.pollTimer) {
        this.clearTimeout(this.pollTimer);
        this.pollTimer = void 0;
      }
      (_a = this.client) == null ? void 0 : _a.shutdown();
      for (const tc of this.testClients) {
        tc.destroy();
      }
      this.testClients.clear();
      const writes = [this.setState("info.connection", { val: false, ack: true })];
      for (const upsId of this.discoveredUps.keys()) {
        writes.push(this.setState(`${upsId}.info.reachable`, { val: false, ack: true }));
      }
      writes.push(this.setState("info.upsReachable", { val: 0, ack: true }));
      writes.push(this.setState("info.allUpsReachable", { val: false, ack: true }));
      void Promise.all(writes).catch((err) => {
        this.log.debug(`onUnload: final states rejected: ${(0, import_coerce.errText)(err)}`);
      }).finally(callback);
      return;
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
