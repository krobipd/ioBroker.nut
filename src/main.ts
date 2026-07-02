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
} from "./lib/coerce";
import { dispatchMessage, makeTestClientFactory } from "./lib/message-router";
import { NutClient, NutError } from "./lib/nut-client";
import { nutVarToStateId, StateManager } from "./lib/state-manager";
import type { AdapterConfig, NutLogger, NutVariable, UpsInfo } from "./lib/types";

/**
 * NUT adapter — lifecycle, polling, command/SET-VAR dispatch.
 * Exported so the orchestration unit tests can drive its handlers directly.
 */
export class NutAdapter extends utils.Adapter {
  private client: NutClient | null = null;
  private stateManager: StateManager | null = null;
  private pollTimer: ioBroker.Interval | undefined = undefined;
  private isPolling = false;
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
    super({ ...options, name: "nut" });
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

  private async onReady(): Promise<void> {
    try {
      await I18n.init(join(this.adapterDir, "admin"), this);
      const config = this.nutConfig();
      this.log.debug(
        `onReady: starting (host='${config.host}', port=${JSON.stringify(config.port)}, pollInterval=${JSON.stringify(config.pollInterval)}s)`,
      );

      await this.setStateChangedAsync("info.connection", { val: false, ack: true });

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
      this.stateManager = this.makeStateManager();

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

      if (this.everConnected) {
        this.log.info(`Reconnected to NUT server ${host}:${port} — ${this.discoveredUps.size} UPS(es)`);
      } else {
        this.everConnected = true;
        const authStatus = this.authenticated ? "authenticated" : "no credentials";
        this.log.info(
          `NUT adapter started — ${this.discoveredUps.size} UPS(es) on ${host}:${port}, polling every ${pollSec}s (${authStatus})`,
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
   * Authenticate when credentials are configured. USERNAME/PASSWORD is all that GET/LIST + SET VAR
   * + INSTCMD need; we deliberately do NOT send LOGIN per UPS (NUT permits only one LOGIN per
   * connection, so a multi-UPS server fails the second with ALREADY-LOGGED-IN, and LOGIN only
   * matters for upsmon shutdown coordination, which this adapter does not do).
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
    try {
      await this.client.authenticate(config.username, config.password);
      this.authenticated = true;
      this.log.debug(`Authenticated to NUT server ${host}:${port}`);
      return true;
    } catch (err) {
      this.log.error(`Authentication failed: ${errText(err)} — check NUT server credentials`);
      this.log.info(
        `Authentication required — adapter is idle (yellow) until the credentials are corrected; use the connection test in admin to verify them`,
      );
      this.client.destroy(); // stop the retry loop; stay alive + yellow
      await this.setStateChangedAsync("info.connection", { val: false, ack: true });
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
    for (const ups of this.discoveredUps.keys()) {
      try {
        const commands = await this.client.listCmd(ups);
        await this.stateManager.createCommandButtons(ups, commands);
        this.log.debug(`Created ${commands.length} command buttons for ${ups}`);
      } catch (err) {
        this.log.debug(`Failed to list commands for ${ups}: ${errText(err)}`);
      }
    }
  }

  /**
   * Arm the periodic poll timer once. Called on the normal setup path and again from the
   * post-connect error handler, so a non-connection failure on a live socket still recovers.
   */
  private armPollTimer(rawInterval: unknown, pollSec: number): void {
    if (this.unloaded || this.pollTimer !== undefined) {
      return;
    }
    this.log.debug(`pollInterval: raw=${JSON.stringify(rawInterval)} resolved=${pollSec}s`);
    this.pollTimer = this.setInterval(() => {
      void this.poll();
    }, pollSec * 1000);
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
      `TLS connection to NUT server ${host}:${port} failed: ${errText(err)} — verify the server offers STARTTLS and check the certificate setting`,
    );
    this.client?.destroy();
    void this.setStateChangedAsync("info.connection", { val: false, ack: true }).catch(() => {});
  }

  private async discover(): Promise<void> {
    if (!this.client || !this.stateManager) {
      return;
    }
    const upsList = await this.client.listUps();
    this.log.debug(`Discovered ${upsList.length} UPS(es): ${upsList.map(u => u.name).join(", ")}`);

    this.discoveredUps.clear();
    for (const ups of upsList) {
      this.discoveredUps.set(ups.name, ups);
      await this.stateManager.ensureUpsDevice(ups.name, ups.description);
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
      this.log.debug("Skipping poll — previous poll still running");
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
          // Only query LIST RW when SET VAR is enabled — otherwise the variables would be marked
          // writable (write: true) in the admin object tree while a write is silently blocked, and
          // querying is pointless. With SET VAR off every variable stays read-only.
          const [variables, rwVars] = await Promise.all([
            this.client.listVar(upsName),
            this.nutConfig().enableSetVar
              ? this.client.listRw(upsName).catch((err: unknown) => {
                  this.log.debug(`LIST RW ${upsName} failed (non-critical): ${errText(err)}`);
                  return [] as NutVariable[];
                })
              : Promise.resolve<NutVariable[]>([]),
          ]);

          const rwNames = new Set(rwVars.map(v => v.name));
          await this.stateManager.updateVariables(upsName, variables, rwNames);

          const upsDesc = this.discoveredUps.get(upsName);
          await this.stateManager.updateDeviceName(upsName, upsDesc?.description ?? "", variables);

          const statusVar = variables.find(v => v.name === "ups.status");
          if (statusVar) {
            // Pass battery.charger.status so charging/discharging fill in even on UPSes that
            // report it instead of the CHRG/DISCHRG status flags (e.g. Eaton Ellipse ECO).
            const chargerStatus = variables.find(v => v.name === "battery.charger.status")?.value;
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

          const msg = `Failed to poll UPS '${upsName}': ${errText(err)}`;
          if (this.failedUps.has(upsName)) {
            this.log.debug(msg);
          } else {
            const isDataStale = err instanceof NutError && err.code === "DATA-STALE";
            if (isDataStale) {
              this.log.warn(`UPS '${upsName}': driver reports stale data — keeping existing states`);
            } else {
              this.log.warn(msg);
            }
            this.failedUps.add(upsName);
          }
        }
      }

      // Reflect the real TCP/NUT-server connection, not "the poll loop ran": per-UPS errors are
      // caught inside the loop, so an unconditional `true` here would show green even while the
      // connection is down (poll keeps firing during the reconnect backoff). Gate on the client.
      await this.setStateChangedAsync("info.connection", { val: this.client?.isConnected ?? false, ack: true });

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
  private async enrichWritableVars(upsName: string, rwVars: NutVariable[]): Promise<void> {
    if (!this.client || !this.stateManager || this.enrichedUps.has(upsName) || rwVars.length === 0) {
      return;
    }
    for (const rw of rwVars) {
      const stateId = nutVarToStateId(upsName, rw.name);
      try {
        const enumVals = await this.client.listEnum(upsName, rw.name);
        if (enumVals.length > 0) {
          const states: Record<string, string> = {};
          for (const v of enumVals) {
            states[v] = v;
          }
          await this.stateManager.enrichStateMetadata(stateId, { states });
        }
      } catch (err: unknown) {
        this.log.debug(`LIST ENUM ${upsName} ${rw.name}: not supported (${errText(err)})`);
      }
      try {
        const ranges = await this.client.listRange(upsName, rw.name);
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
        this.log.debug(`LIST RANGE ${upsName} ${rw.name}: not supported (${errText(err)})`);
      }
    }
    this.enrichedUps.add(upsName);
  }

  private async onStateChange(id: string, state: ioBroker.State | null | undefined): Promise<void> {
    try {
      if (!state || state.ack) {
        return;
      }
      const config = this.nutConfig();
      const localId = id.replace(`${this.namespace}.`, "");
      this.log.debug(`onStateChange: ${localId} val=${JSON.stringify(state.val)}`);

      if (!this.client) {
        this.log.debug(`onStateChange: ignoring ${localId} — no client connection`);
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
          this.log.warn(`Command blocked — enableCommands is disabled: ${localId}`);
          return;
        }
        const cmdName = this.stateManager?.nutNameForState(localId) ?? parts.slice(2).join(".").replace(/-/g, ".");
        this.log.debug(`INSTCMD ${upsName} ${cmdName}`);
        try {
          await this.client.instCmd(upsName, cmdName);
          this.log.info(`Command executed: ${cmdName} on ${upsName}`);
        } catch (err) {
          this.log.error(`Command failed: ${cmdName} on ${upsName} — ${errText(err)}`);
        }
        await this.setState(id, { val: false, ack: true });
        return;
      }

      if (!config.enableSetVar) {
        this.log.warn(`SET VAR blocked — enableSetVar is disabled: ${localId}`);
        return;
      }

      const varName =
        this.stateManager?.nutNameForState(localId) ?? `${parts[1]}.${parts.slice(2).join(".").replace(/-/g, ".")}`;
      const value = String(state.val);
      this.log.debug(`SET VAR ${upsName} ${varName} "${value}"`);
      try {
        await this.client.setVar(upsName, varName, value);
        await this.setState(id, { val: state.val, ack: true });
        this.log.info(`Variable set: ${varName} = "${value}" on ${upsName}`);
      } catch (err) {
        this.log.error(`SET VAR failed: ${varName} on ${upsName} — ${errText(err)}`);
      }
    } catch (err: unknown) {
      this.log.error(`onStateChange failed: ${errText(err)}`);
    }
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
        this.clearInterval(this.pollTimer);
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
      void this.setState("info.connection", { val: false, ack: true }).catch(() => {});
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
