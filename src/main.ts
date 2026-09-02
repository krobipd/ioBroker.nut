import * as utils from "@iobroker/adapter-core";
import { I18n } from "@iobroker/adapter-core";
import { join } from "node:path";
import {
  coerceCommandTimeoutMs,
  coerceHost,
  coercePollIntervalSec,
  coercePort,
  errText,
  localAddressOf,
  parseDecimal,
  parseNotifyTrigger,
} from "./lib/coerce";
import { dispatchMessage, makeTestClientFactory } from "./lib/message-router";
import { authFailureText, NutClient, NutError } from "./lib/nut-client";
import { nutVarToStateId, sanitizeUpsName, StateManager } from "./lib/state-manager";
import { detectType } from "./lib/type-detector";
import type { AdapterConfig, NutLogger, NutVariable, UpsInfo } from "./lib/types";

/** Upper bound for the notify warn-dedup set (external input must not grow it without limit). */
const NOTIFY_WARN_CAP = 100;

/**
 * NUT adapter — lifecycle, polling, command/SET-VAR dispatch.
 * Exported so the orchestration unit tests can drive its handlers directly.
 */
export class NutAdapter extends utils.Adapter {
  private client: NutClient | null = null;
  private stateManager: StateManager | null = null;
  private pollTimer: ioBroker.Timeout | undefined = undefined;
  private pollIntervalMs = 0;
  private isPolling = false;
  private pollAgainRequested = false;
  /** Unknown UPS names seen on the notify trigger — warn once each, then debug (no log spam). */
  private warnedNotifyRefs = new Set<string>();
  private lastErrorCode = "";
  private failedUps = new Set<string>();
  private discoveredUps = new Map<string, UpsInfo>();
  private authenticated = false;
  private enrichedUps = new Set<string>();
  private testClients = new Set<NutClient>();
  private subscribed = false;
  private unloaded = false;
  private everConnected = false;

  /** @param options Adapter options forwarded to the ioBroker base class. */
  constructor(options: Partial<utils.AdapterOptions> = {}) {
    super({ ...options, name: "nut2" });
    this.on("ready", this.onReady.bind(this));
    this.on("stateChange", this.onStateChange.bind(this));
    this.on("unload", this.onUnload.bind(this));
    this.on("message", this.onMessage.bind(this));
  }

  /** The native config, typed — single cast point for all config reads. */
  private nutConfig(): AdapterConfig {
    return this.config as unknown as AdapterConfig;
  }

  // Factory seams — production builds the real collaborators; the orchestration
  // unit tests (src/main.test.ts) override these fields with fakes so onReady,
  // onConnected and poll can run without sockets or a js-controller.
  private makeClient: (...args: ConstructorParameters<typeof NutClient>) => NutClient = (...args) =>
    new NutClient(...args);
  private makeStateManager: () => StateManager = () => new StateManager(this);

  // Single source for the {debug,warn,info} logger passed to the NUT client, the test-client
  // factory and the message router — avoids rebuilding the same wrapper at three call sites.
  private get nutLogger(): NutLogger {
    return {
      debug: (m: string) => this.log.debug(m),
      warn: (m: string) => this.log.warn(m),
      info: (m: string) => this.log.info(m),
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
  private async clearStopInstanceFlag(): Promise<boolean> {
    const id = `system.adapter.${this.namespace}`;
    try {
      const obj = await this.getForeignObjectAsync(id);
      if (obj?.common?.supportedMessages === undefined || obj.common.supportedMessages === null) {
        return false;
      }
      this.log.info("Correcting a leftover setting from an earlier version — this instance restarts once");
      await this.extendForeignObjectAsync(id, { common: { supportedMessages: null } });
      return true;
    } catch (err: unknown) {
      // Objects DB unreachable — not worth failing the start over; the next start retries.
      this.log.debug(`Could not check the instance object ${id}: ${errText(err)}`);
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
  private async markAllUpsUnreachable(): Promise<void> {
    for (const upsId of this.discoveredUps.keys()) {
      await this.setStateChangedAsync(`${upsId}.info.reachable`, { val: false, ack: true });
    }
    await this.stateManager?.writeUpsSummary(this.discoveredUps.size, 0);
  }

  private async onReady(): Promise<void> {
    try {
      // First: without this the whole shutdown path stays dead on an updated install.
      // A correction means the host is restarting us — no point setting anything up.
      if (await this.clearStopInstanceFlag()) {
        return;
      }
      await I18n.init(join(this.adapterDir, "admin"), this);
      const config = this.nutConfig();
      this.log.debug(
        `onReady: starting (host='${config.host}', port=${JSON.stringify(config.port)}, pollInterval=${JSON.stringify(config.pollInterval)}s)`,
      );

      await this.setStateChangedAsync("info.connection", { val: false, ack: true });

      // Built before the host check so the online indicators are cleared even on a misconfigured
      // instance: nothing will poll, so a stale "reachable" would stand forever.
      this.stateManager = this.makeStateManager();
      await this.stateManager.markAllUnreachable();

      // The upsmon doorbell listens from the very start, independent of any successful connect:
      // with the NUT server down (or the host missing) a write must still be received, recorded
      // and confirmed — a SHUTDOWN event arriving while the connection is broken is the one that
      // matters most.
      await this.subscribeStatesAsync("notify");

      const host = coerceHost(config.host);
      if (!host) {
        this.log.error("NUT server host is required — check adapter configuration");
        return;
      }

      const port = coercePort(config.port);
      const commandTimeoutMs = coerceCommandTimeoutMs(config.commandTimeout);
      this.log.debug(`commandTimeout: raw=${JSON.stringify(config.commandTimeout)} resolved=${commandTimeoutMs}ms`);

      const localAddress = localAddressOf(config.networkInterface);

      this.client = this.makeClient(host, port, {
        localAddress,
        commandTimeout: commandTimeoutMs,
        useTls: !!config.useTls,
        tlsRejectUnauthorized: !!config.tlsRejectUnauthorized,
        tlsCaFile: typeof config.tlsCaFile === "string" ? config.tlsCaFile : "",
        // Inject the adapter-managed timers so the client's command/reconnect timeouts are
        // tracked and auto-cleared on unload (no native setTimeout leaks).
        setTimer: (cb, ms) => this.setTimeout(cb, ms),
        clearTimer: h => {
          if (h != null) {
            this.clearTimeout(h as ioBroker.Timeout);
          }
        },
        logger: this.nutLogger,
      });

      // Unified retry loop lives in the client (start): it retries the initial connect,
      // reconnects on drops, and runs the idempotent post-connect setup on every (re)connect.
      this.client.setOnConnect(() => {
        void this.onConnected().catch((err: unknown) => this.log.error(`onConnected failed: ${errText(err)}`));
      });
      this.client.setOnFatal((err: unknown) => this.onConnectFatal(err));
      this.client.start();
    } catch (err: unknown) {
      this.log.error(`onReady failed: ${errText(err)}`);
    }
  }

  /**
   * Idempotent post-connect setup, run on the initial connect AND every reconnect (the client's
   * single retry loop drives both): discover UPSes, (re-)authenticate, refresh command buttons,
   * poll, and arm the poll timer + subscription once. Auth failure goes yellow and stops the
   * loop via destroy(). Making "initial == reconnect" one path keeps the two from drifting.
   */
  private async onConnected(): Promise<void> {
    if (this.unloaded || !this.client || !this.stateManager) {
      return;
    }
    const config = this.nutConfig();
    const host = coerceHost(config.host) ?? "";
    const port = coercePort(config.port);
    const pollSec = coercePollIntervalSec(config.pollInterval);

    try {
      this.enrichedUps.clear(); // fresh connection → re-enrich enum/range metadata
      await this.discover();

      if (!(await this.authenticateIfConfigured(host, port))) {
        return; // auth failed → client destroyed, adapter left idle/yellow
      }
      await this.setupCommandButtons();

      await this.poll();
      this.armPollTimer(config.pollInterval, pollSec);

      if (!this.subscribed && (config.enableCommands || config.enableSetVar)) {
        await this.subscribeStatesAsync("*");
        this.subscribed = true;
      }

      const transport = this.client?.isTls ? "TLS" : "unencrypted";
      if (this.everConnected) {
        this.log.info(`Reconnected to NUT server ${host}:${port} (${transport}) — ${this.discoveredUps.size} UPS(es)`);
      } else {
        this.everConnected = true;
        const authStatus = this.authenticated ? `logged in as ${config.username}` : "no credentials";
        this.log.info(
          `NUT adapter started — ${this.discoveredUps.size} UPS(es) on ${host}:${port}, polling every ${pollSec}s (${authStatus}, ${transport})`,
        );
      }
    } catch (err) {
      this.log.error(`Post-connect setup failed: ${errText(err)}`);
      // Still arm the poll timer if setup failed on a live socket (e.g. a DB write during discovery
      // threw): otherwise the adapter stays connected but never polls, with no socket close to
      // trigger a reconnect. Auth failure returns earlier (client destroyed) and never reaches here,
      // so it correctly stays idle.
      this.armPollTimer(config.pollInterval, pollSec);
    }
  }

  /**
   * Log in when credentials are configured. USERNAME/PASSWORD alone prove nothing: upsd only
   * stores them and checks them on LOGIN, SET, INSTCMD and FSD (server/netuser.c, user.c). So
   * the adapter LOGINs on the first UPS of the connection — ONE LOGIN per connection is what
   * upsd allows (a second answers ALREADY-LOGGED-IN), and it verifies the credentials for the
   * whole connection; every other UPS is read and written over the same, now verified, link.
   * The NUT user therefore needs an `upsmon secondary` (or `upsmon primary`) line in upsd.users;
   * a user with only `actions`/`instcmds` cannot LOGIN and is reported as rejected.
   *
   * @param host NUT server host (for logging)
   * @param port NUT server port (for logging)
   * @returns true to continue setup; false when authentication failed and the client was destroyed
   */
  private async authenticateIfConfigured(host: string, port: number): Promise<boolean> {
    this.authenticated = false;
    const config = this.nutConfig();
    if (!config.username || !config.password || !this.client) {
      return true;
    }
    const first = this.discoveredUps.values().next().value;
    if (!first) {
      this.log.warn(
        `Credentials are configured but NUT server ${host}:${port} lists no UPS — nothing to log in to, credentials not verified`,
      );
      return true;
    }
    try {
      await this.client.authenticate(config.username, config.password);
      await this.client.login(first.name);
      this.authenticated = true;
      this.log.debug(`Logged in to NUT server ${host}:${port} as ${config.username} (LOGIN ${first.name})`);
      return true;
    } catch (err) {
      this.log.error(
        `Login to NUT server ${host}:${port} as ${config.username} failed: ${authFailureText(err) ?? errText(err)}`,
      );
      this.log.info(
        `Login required — adapter is idle (yellow) until the credentials are corrected; use the connection test in admin to verify them`,
      );
      this.client.destroy(); // stop the retry loop; stay alive + yellow
      await this.setStateChangedAsync("info.connection", { val: false, ack: true });
      await this.markAllUpsUnreachable();
      return false;
    }
  }

  /**
   * Create instant-command button states for every discovered UPS. Only runs when we authenticated
   * and commands are enabled; each UPS is best-effort.
   */
  private async setupCommandButtons(): Promise<void> {
    if (!this.authenticated || !this.nutConfig().enableCommands || !this.client || !this.stateManager) {
      return;
    }
    for (const [upsId, ups] of this.discoveredUps) {
      try {
        const commands = await this.client.listCmd(ups.name);
        await this.stateManager.createCommandButtons(upsId, commands);
        this.log.debug(`Created ${commands.length} command buttons for ${ups.name}`);
      } catch (err) {
        this.log.debug(`Failed to list commands for ${ups.name}: ${errText(err)}`);
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
  private armPollTimer(rawInterval: unknown, pollSec: number): void {
    if (this.unloaded || this.pollTimer !== undefined) {
      return;
    }
    this.log.debug(`pollInterval: raw=${JSON.stringify(rawInterval)} resolved=${pollSec}s`);
    this.pollIntervalMs = pollSec * 1000;
    this.scheduleNextPoll();
  }

  /**
   * Schedule the next poll one interval after the previous one FINISHES (a setTimeout chain rather
   * than a fixed setInterval), so a slow poll can never overlap the next tick. pollTimer stays
   * defined between ticks, keeping the armPollTimer idempotency guard and the error-handler
   * recovery re-entry intact; a poll running during onUnload sees unloaded and does not re-arm.
   */
  private scheduleNextPoll(): void {
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
  private onConnectFatal(err: unknown): void {
    const config = this.nutConfig();
    const host = coerceHost(config.host) ?? "";
    const port = coercePort(config.port);
    this.log.error(
      `TLS connection to NUT server ${host}:${port} failed: ${errText(err)} — verify the server offers STARTTLS and check the certificate settings (Require valid certificate, CA file)`,
    );
    this.client?.destroy();
    void this.setStateChangedAsync("info.connection", { val: false, ack: true }).catch(() => {});
    void this.markAllUpsUnreachable().catch(() => {
      /* states DB unreachable — the next start stamps them again */
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
  private uniqueUpsId(baseId: string, rawName: string): string {
    if (!this.discoveredUps.has(baseId)) {
      return baseId;
    }
    let n = 2;
    while (this.discoveredUps.has(`${baseId}-${n}`)) {
      n++;
    }
    const unique = `${baseId}-${n}`;
    this.log.warn(`UPS name '${rawName}' collides with another after sanitization → using object ID '${unique}'`);
    return unique;
  }

  /**
   * Whether the NUT server's UPS list differs from what was discovered last — by NUT name,
   * order-independent.
   *
   * @param upsList Fresh LIST UPS result
   */
  private upsListChanged(upsList: UpsInfo[]): boolean {
    const fresh = upsList.map(u => u.name).sort();
    const known = [...this.discoveredUps.values()].map(u => u.name).sort();
    return fresh.length !== known.length || fresh.some((name, i) => name !== known[i]);
  }

  /**
   * Discover the UPS devices on the server and (re)build the object tree for them.
   *
   * @param prefetched LIST UPS result already fetched by the caller (the poll), otherwise fetched here
   */
  private async discover(prefetched?: UpsInfo[]): Promise<void> {
    if (!this.client || !this.stateManager) {
      return;
    }
    const upsList = prefetched ?? (await this.client.listUps());
    this.log.debug(`Discovered ${upsList.length} UPS(es): ${upsList.map(u => u.name).join(", ")}`);

    this.discoveredUps.clear();
    for (const ups of upsList) {
      // The NUT name can contain characters ioBroker forbids in object IDs (spaces, dots, etc.);
      // sanitize it for the object tree and key discoveredUps on that ID. The real NUT name stays
      // in the map value and is used for every protocol call (LIST VAR/INSTCMD/SET VAR).
      const upsId = this.uniqueUpsId(sanitizeUpsName(ups.name), ups.name);
      this.discoveredUps.set(upsId, ups);
      await this.stateManager.ensureUpsDevice(upsId, ups.description);
    }

    const knownNames = new Set(this.discoveredUps.keys());
    await this.stateManager.cleanupRemovedUps(knownNames);
    await this.stateManager.cleanupLegacyObjects(knownNames);

    // Prune the in-memory per-UPS markers alongside the object cleanup — a UPS that
    // disappears and later re-appears must start fresh (a stale failedUps entry would
    // demote its first real error to debug; a stale enrichedUps entry would skip the
    // enum/range enrichment).
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

  private classifyError(err: unknown): string {
    if (err instanceof NutError) {
      return err.code;
    }
    if (!(err instanceof Error)) {
      return "UNKNOWN";
    }
    const code = (err as NodeJS.ErrnoException).code;
    if (
      code === "ENOTFOUND" ||
      code === "ECONNREFUSED" ||
      code === "ECONNRESET" ||
      code === "ENETUNREACH" ||
      code === "EHOSTUNREACH" ||
      code === "EAI_AGAIN"
    ) {
      return "NETWORK";
    }
    if (code === "ETIMEDOUT" || err.message.includes("timed out")) {
      return "TIMEOUT";
    }
    return code || "UNKNOWN";
  }

  private async poll(): Promise<void> {
    if (this.isPolling) {
      // Remember the request instead of dropping it: a notify trigger firing while a poll is
      // in flight may have arrived AFTER that poll already read ups.status — without a
      // follow-up the fresh event data would wait a full interval. Many triggers in a row
      // (upsmon fires one NOTIFYCMD per event) still collapse into ONE follow-up poll.
      this.pollAgainRequested = true;
      this.log.debug("Skipping poll — previous poll still running");
      return;
    }
    if (!this.client || !this.stateManager) {
      return;
    }

    this.log.debug(`poll: starting (lastErrorCode='${this.lastErrorCode}', upsCount=${this.discoveredUps.size})`);

    this.isPolling = true;
    try {
      // LIST UPS is one cheap command per poll. A UPS added to or removed from the NUT server
      // at runtime used to wait for the next reconnect (or an adapter restart) — discovery
      // only ran once per connection.
      const upsList = await this.client.listUps();
      if (this.upsListChanged(upsList)) {
        this.log.info(`UPS list on the NUT server changed: ${upsList.map(u => u.name).join(", ") || "none"}`);
        await this.discover(upsList);
        await this.setupCommandButtons();
      }

      let reachable = 0;
      for (const [upsId, ups] of this.discoveredUps) {
        // upsId is the sanitized object-ID segment; nutName is the real NUT name for the protocol.
        const nutName = ups.name;
        try {
          // Only query LIST RW when SET VAR is enabled — otherwise the variables would be marked
          // writable (write: true) in the admin object tree while a write is silently blocked, and
          // querying is pointless. With SET VAR off every variable stays read-only.
          const [variables, rwVars] = await Promise.all([
            this.client.listVar(nutName),
            this.nutConfig().enableSetVar
              ? this.client.listRw(nutName).catch((err: unknown) => {
                  this.log.debug(`LIST RW ${nutName} failed (non-critical): ${errText(err)}`);
                  return [] as NutVariable[];
                })
              : Promise.resolve<NutVariable[]>([]),
          ]);

          const rwNames = new Set(rwVars.map(v => v.name));
          await this.stateManager.updateVariables(upsId, variables, rwNames);

          await this.stateManager.updateDeviceName(upsId, ups.description, variables);

          const statusVar = variables.find(v => v.name === "ups.status");
          if (statusVar) {
            // Pass battery.charger.status so charging/discharging fill in even on UPSes that
            // report it instead of the CHRG/DISCHRG status flags (e.g. Eaton Ellipse ECO).
            const chargerStatus = variables.find(v => v.name === "battery.charger.status")?.value;
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

          const msg = `Failed to poll UPS '${nutName}': ${errText(err)}`;
          if (this.failedUps.has(upsId)) {
            this.log.debug(msg);
          } else {
            const isDataStale = err instanceof NutError && err.code === "DATA-STALE";
            if (isDataStale) {
              this.log.warn(`UPS '${nutName}': driver reports stale data — keeping existing states`);
            } else {
              this.log.warn(msg);
            }
            this.failedUps.add(upsId);
          }
        }
      }

      // Reflect the real TCP/NUT-server connection, not "the poll loop ran": per-UPS errors are
      // caught inside the loop, so an unconditional `true` here would show green even while the
      // connection is down (poll keeps firing during the reconnect backoff). Gate on the client.
      await this.setStateChangedAsync("info.connection", { val: this.client?.isConnected ?? false, ack: true });

      // One line an automation can watch instead of every device: how many UPSes there are and
      // how many answered THIS poll. A UPS that failed above is counted as not reachable.
      await this.stateManager.writeUpsSummary(this.discoveredUps.size, reachable);

      if (this.lastErrorCode) {
        this.log.info("Connection restored");
        this.lastErrorCode = "";
      }
    } catch (err) {
      const errMsg = errText(err);
      const errorCode = this.classifyError(err);
      const isRepeat = errorCode === this.lastErrorCode;
      this.lastErrorCode = errorCode;

      if (isRepeat) {
        this.log.debug(`Poll failed (ongoing): ${errMsg}`);
      } else if (errorCode === "NETWORK") {
        this.log.warn("Cannot reach NUT server — will keep retrying");
      } else {
        this.log.error(`Poll failed: ${errMsg}`);
      }

      await this.setStateChangedAsync("info.connection", { val: false, ack: true });
      // The poll failed as a WHOLE (not a single UPS — those are caught inside the loop), so this
      // run learned nothing about any of them. Every device marker goes down together with the
      // summary: leaving a UPS green next to "0 of 1 reachable" is the same contradiction on one
      // screen that the summary is meant to resolve.
      await this.markAllUpsUnreachable();
    } finally {
      this.isPolling = false;
      if (this.pollAgainRequested && !this.unloaded) {
        this.pollAgainRequested = false;
        // Fire-and-forget: poll() never rejects (everything above is caught), and the timer
        // chain stays untouched — this is just one extra run for the queued request.
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
  private async enrichWritableVars(upsId: string, nutName: string, rwVars: NutVariable[]): Promise<void> {
    if (!this.client || !this.stateManager || this.enrichedUps.has(upsId) || rwVars.length === 0) {
      return;
    }
    for (const rw of rwVars) {
      const stateId = nutVarToStateId(upsId, rw.name);
      // A writable yes/no var is a boolean state (detectType → boolean only via parseYesNo). Its
      // LIST ENUM yes/no must not become common.states — a string-keyed {yes,no} map is meaningless
      // on a boolean — so skip the enum round-trip entirely for booleans. RANGE stays (harmless: a
      // boolean has none). Multi-value string/number enums are unaffected.
      const isBoolean = detectType(rw.name, rw.value, true).type === "boolean";
      if (!isBoolean) {
        try {
          const enumVals = await this.client.listEnum(nutName, rw.name);
          if (enumVals.length > 0) {
            const states: Record<string, string> = {};
            for (const v of enumVals) {
              states[v] = v;
            }
            await this.stateManager.enrichStateMetadata(stateId, { states });
          }
        } catch (err: unknown) {
          this.log.debug(`LIST ENUM ${nutName} ${rw.name}: not supported (${errText(err)})`);
        }
      }
      try {
        const ranges = await this.client.listRange(nutName, rw.name);
        if (ranges.length > 0) {
          const min = parseDecimal(ranges[0].min);
          const max = parseDecimal(ranges[0].max);
          const patch: Partial<Record<"min" | "max", number>> = {};
          if (!Number.isNaN(min)) {
            patch.min = min;
          }
          if (!Number.isNaN(max)) {
            patch.max = max;
          }
          await this.stateManager.enrichStateMetadata(stateId, patch);
        }
      } catch (err: unknown) {
        this.log.debug(`LIST RANGE ${nutName} ${rw.name}: not supported (${errText(err)})`);
      }
    }
    this.enrichedUps.add(upsId);
  }

  private async onStateChange(id: string, state: ioBroker.State | null | undefined): Promise<void> {
    try {
      if (!state || state.ack) {
        return;
      }
      const config = this.nutConfig();
      const localId = id.replace(`${this.namespace}.`, "");
      this.log.debug(`onStateChange: ${localId} val=${JSON.stringify(state.val)}`);

      // The notify trigger comes BEFORE the client guard: recording an upsmon event must work
      // even while the NUT server is unreachable (the poll below then just runs into nothing).
      if (localId === "notify") {
        await this.handleNotifyTrigger(state.val);
        return;
      }

      if (!this.client) {
        this.log.debug(`onStateChange: ignoring ${localId} — no client connection`);
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
      // parts[0] is the sanitized object ID; the protocol needs the real NUT name.
      const nutName = ups.name;

      // `info` (reachable, notify) and `status` (the parsed flags) are adapter-owned channels,
      // never NUT variables — a write there (a script, the REST API) must not turn into a
      // SET VAR that upsd rejects with VAR-NOT-SUPPORTED and an error line in the log.
      if (parts[1] === "info" || parts[1] === "status") {
        this.log.debug(`onStateChange: ${localId} is adapter-owned, ignoring write`);
        return;
      }

      if (parts[1] === "commands") {
        if (!config.enableCommands) {
          this.log.warn(`Command blocked — enableCommands is disabled: ${localId}`);
          return;
        }
        const cmdName = this.stateManager?.nutNameForState(localId) ?? parts.slice(2).join(".").replace(/-/g, ".");
        this.log.debug(`INSTCMD ${nutName} ${cmdName}`);
        try {
          await this.client.instCmd(nutName, cmdName);
          this.log.info(`Command executed: ${cmdName} on ${nutName}`);
        } catch (err) {
          this.log.error(`Command failed: ${cmdName} on ${nutName} — ${errText(err)}`);
        }
        await this.setState(id, { val: false, ack: true });
        return;
      }

      if (!config.enableSetVar) {
        this.log.warn(`SET VAR blocked — enableSetVar is disabled: ${localId}`);
        return;
      }
      // Boundary: a state can carry null or an object (REST API, scripts). "null" or
      // "[object Object]" is no value NUT should ever see on the wire.
      if (typeof state.val !== "boolean" && typeof state.val !== "number" && typeof state.val !== "string") {
        this.log.warn(
          `SET VAR ignored — ${localId} received ${JSON.stringify(state.val)}, not a boolean, number or string`,
        );
        return;
      }

      const varName =
        this.stateManager?.nutNameForState(localId) ?? `${parts[1]}.${parts.slice(2).join(".").replace(/-/g, ".")}`;
      // A writable yes/no variable (ups.start.auto/.battery/.reboot, battery.protection) is stored
      // as a boolean state (detectType → boolean only via parseYesNo, so boolean ⟺ the NUT var
      // accepts yes/no). Translate it back to the token NUT expects — String(true) = "true" would
      // be rejected with INVALID-VALUE/SET-FAILED. Numbers/enum strings write verbatim.
      const value = typeof state.val === "boolean" ? (state.val ? "yes" : "no") : String(state.val);
      this.log.debug(`SET VAR ${nutName} ${varName} "${value}"`);
      try {
        await this.client.setVar(nutName, varName, value);
        await this.setState(id, { val: state.val, ack: true });
        this.log.info(`Variable set: ${varName} = "${value}" on ${nutName}`);
      } catch (err) {
        this.log.error(`SET VAR failed: ${varName} on ${nutName} — ${errText(err)}`);
      }
    } catch (err: unknown) {
      this.log.error(`onStateChange failed: ${errText(err)}`);
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
  private async handleNotifyTrigger(rawVal: ioBroker.StateValue): Promise<void> {
    if (this.unloaded) {
      return;
    }
    const { type, upsRef, text } = parseNotifyTrigger(rawVal);

    let matchedId: string | undefined;
    if (upsRef) {
      // First by the real NUT name (survives sanitization AND `…-2` collision suffixes),
      // then by the sanitized object ID — covers both spellings a user may configure.
      for (const [upsId, ups] of this.discoveredUps) {
        if (ups.name === upsRef) {
          matchedId = upsId;
          break;
        }
      }
      if (!matchedId && this.discoveredUps.has(sanitizeUpsName(upsRef))) {
        matchedId = sanitizeUpsName(upsRef);
      }
      if (!matchedId) {
        const msg = `notify: unknown UPS '${upsRef}' — refreshing all UPSes, event recorded on the trigger state only`;
        if (this.warnedNotifyRefs.has(upsRef)) {
          this.log.debug(msg);
        } else {
          // The dedup set is fed by an external write — cap it so a flood of distinct unknown
          // names cannot grow it without bound. At the cap we drop the dedup memory and start
          // over: the worst case is one more warn per name, never unbounded memory.
          if (this.warnedNotifyRefs.size >= NOTIFY_WARN_CAP) {
            this.warnedNotifyRefs.clear();
          }
          this.warnedNotifyRefs.add(upsRef);
          this.log.warn(msg);
        }
      }
    }

    if (type) {
      this.log.info(`upsmon event '${type}'${matchedId ? ` for UPS '${matchedId}'` : ""} — refreshing`);
      if (matchedId) {
        await this.setState(`${matchedId}.info.notify`, { val: type, ack: true });
      }
    } else {
      this.log.debug("notify: manual refresh triggered");
    }

    // Confirm the trigger (ack echo) before the poll for the same reason the event went first.
    // The normalised text goes back, not the raw write: the state is a string, and whatever a
    // script pushed (an object, an overlong blob) must not be stored as such.
    await this.setState("notify", { val: text, ack: true });
    await this.poll();
  }

  private async onMessage(obj: ioBroker.Message): Promise<void> {
    try {
      await dispatchMessage(obj, {
        log: this.nutLogger,
        sendTo: this.sendTo.bind(this),
        createTestClient: makeTestClientFactory(NutClient, this.nutLogger),
        onTestClientCreated: client => {
          this.testClients.add(client);
        },
        onTestClientDone: client => {
          this.testClients.delete(client);
        },
      });
    } catch (err: unknown) {
      this.log.error(`onMessage failed: ${errText(err)}`);
    }
  }

  private onUnload(callback: () => void): void {
    try {
      this.unloaded = true;
      if (this.pollTimer) {
        this.clearTimeout(this.pollTimer);
        this.pollTimer = undefined;
      }
      // The client owns its reconnect timer (managed via this.setTimeout) — destroy()/shutdown()
      // below clears it.
      // Best-effort graceful LOGOUT when logged in; a hard close otherwise.
      if (this.authenticated) {
        this.client?.shutdown();
      } else {
        this.client?.destroy();
      }
      for (const tc of this.testClients) {
        tc.destroy();
      }
      this.testClients.clear();

      // A stopped adapter reads nothing, so it must not keep claiming a UPS is reachable — that
      // state backs the device object's online indicator (statusStates.onlineId), and
      // info.connection alone would leave every device green. The summary goes down with them;
      // info.upsTotal stays, how many UPSes exist did not change.
      //
      // The callback goes LAST, after the writes: reporting "done" straight away loses them —
      // the host tears the process down as soon as it is told. No own timeout guard either:
      // `this.setTimeout` refuses during shutdown and a bare `setTimeout` is a checker finding;
      // the host's own deadline is the only one needed.
      const writes: Promise<unknown>[] = [this.setState("info.connection", { val: false, ack: true })];
      for (const upsId of this.discoveredUps.keys()) {
        writes.push(this.setState(`${upsId}.info.reachable`, { val: false, ack: true }));
      }
      writes.push(this.setState("info.upsReachable", { val: 0, ack: true }));
      writes.push(this.setState("info.allUpsReachable", { val: false, ack: true }));
      void Promise.all(writes)
        .catch((err: unknown) => {
          // States DB already going down — nothing left to report to.
          this.log.debug(`onUnload: final states rejected: ${errText(err)}`);
        })
        .finally(callback);
      return;
    } catch (err) {
      this.log.debug(`onUnload error (ignored): ${errText(err)}`);
    }
    callback();
  }
}

if (require.main !== module) {
  module.exports = (options: Partial<utils.AdapterOptions> | undefined) => new NutAdapter(options);
} else {
  (() => new NutAdapter())();
}
