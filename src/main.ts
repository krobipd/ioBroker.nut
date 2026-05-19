import * as utils from "@iobroker/adapter-core";
import { coerceCommandTimeoutMs, coerceHost, coercePollIntervalSec, coercePort, errText } from "./lib/coerce";
import { dispatchMessage, makeTestClientFactory } from "./lib/message-router";
import { NutClient, NutError } from "./lib/nut-client";
import { nutVarToStateId, StateManager } from "./lib/state-manager";
import type { AdapterConfig, UpsInfo } from "./lib/types";

class NutAdapter extends utils.Adapter {
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
  private unhandledRejectionHandler: ((reason: unknown) => void) | null = null;
  private uncaughtExceptionHandler: ((err: Error) => void) | null = null;

  constructor(options: Partial<utils.AdapterOptions> = {}) {
    super({ ...options, name: "nut" });
    this.on("ready", () => {
      this.onReady().catch((err: unknown) => this.log.error(`onReady failed: ${errText(err)}`));
    });
    this.on("stateChange", (id, state) => {
      this.onStateChange(id, state).catch((err: unknown) => this.log.error(`onStateChange failed: ${errText(err)}`));
    });
    this.on("unload", this.onUnload.bind(this));
    this.on("message", obj => {
      this.onMessage(obj).catch((err: unknown) => this.log.error(`onMessage failed: ${errText(err)}`));
    });

    this.unhandledRejectionHandler = (reason: unknown) => {
      this.log.error(`Unhandled rejection: ${errText(reason)}`);
      this.terminate?.(11);
    };
    this.uncaughtExceptionHandler = (err: Error) => {
      this.log.error(`Uncaught exception: ${errText(err)}`);
      this.terminate?.(11);
    };
    process.on("unhandledRejection", this.unhandledRejectionHandler);
    process.on("uncaughtException", this.uncaughtExceptionHandler);
  }

  private async onReady(): Promise<void> {
    const config = this.config as unknown as AdapterConfig;
    this.log.debug(
      `onReady: starting (host='${config.host}', port=${JSON.stringify(config.port)}, pollInterval=${JSON.stringify(config.pollInterval)}s)`,
    );

    await this.setStateAsync("info.connection", { val: false, ack: true });

    const host = coerceHost(config.host);
    if (!host) {
      this.log.error("NUT server host is required — check adapter configuration");
      return;
    }

    const port = coercePort(config.port);
    const commandTimeoutMs = coerceCommandTimeoutMs(config.commandTimeout);
    this.log.debug(`commandTimeout: raw=${JSON.stringify(config.commandTimeout)} resolved=${commandTimeoutMs}ms`);

    const localAddress =
      typeof config.networkInterface === "string" && config.networkInterface.trim().length > 0
        ? config.networkInterface.trim()
        : undefined;

    this.client = new NutClient(host, port, {
      localAddress,
      commandTimeout: commandTimeoutMs,
      logger: {
        debug: (m: string) => this.log.debug(m),
        warn: (m: string) => this.log.warn(m),
        info: (m: string) => this.log.info(m),
      },
    });
    this.stateManager = new StateManager(this);

    this.client.setOnReconnect(() => {
      void this.rediscover().catch((err: unknown) =>
        this.log.error(`Rediscovery after reconnect failed: ${errText(err)}`),
      );
    });

    try {
      await this.client.connect();
    } catch (err) {
      this.log.error(`Cannot connect to NUT server ${host}:${port} — ${errText(err)}`);
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
        this.log.error(`Authentication failed: ${errText(err)} — check NUT server credentials`);
        this.log.info(`NUT adapter running without authentication — fix credentials and use connection test in admin`);
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
          this.log.debug(`Failed to list commands for ${ups}: ${errText(err)}`);
        }
      }
    }

    await this.poll();

    const pollSec = coercePollIntervalSec(config.pollInterval);
    this.log.debug(`pollInterval: raw=${JSON.stringify(config.pollInterval)} resolved=${pollSec}s`);
    this.pollTimer = this.setInterval(() => {
      void this.poll();
    }, pollSec * 1000);

    if (config.enableCommands || config.enableSetVar) {
      await this.subscribeStatesAsync("*");
    }

    const authStatus = this.authenticated ? "authenticated" : "no credentials";
    this.log.info(
      `NUT adapter started — ${this.discoveredUps.size} UPS(es) on ${host}:${port}, polling every ${pollSec}s (${authStatus})`,
    );
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
  }

  private async rediscover(): Promise<void> {
    if (!this.client) {
      return;
    }
    const config = this.config as unknown as AdapterConfig;
    if (this.authenticated && config.username && config.password) {
      try {
        await this.client.authenticate(config.username, config.password);
        for (const ups of this.discoveredUps.keys()) {
          await this.client.login(ups);
        }
      } catch (err) {
        this.log.warn(`Re-authentication after reconnect failed: ${errText(err)}`);
      }
    }
    this.enrichedUps.clear();
    await this.discover();
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
          const [variables, rwVars] = await Promise.all([
            this.client.listVar(upsName),
            this.client.listRw(upsName).catch((err: unknown) => {
              this.log.debug(`LIST RW ${upsName} failed (non-critical): ${errText(err)}`);
              return [];
            }),
          ]);

          const rwNames = new Set(rwVars.map(v => v.name));
          await this.stateManager.updateVariables(upsName, variables, rwNames);

          const upsDesc = this.discoveredUps.get(upsName);
          await this.stateManager.updateDeviceName(upsName, upsDesc?.description ?? "", variables);

          const statusVar = variables.find(v => v.name === "ups.status");
          if (statusVar) {
            await this.stateManager.updateStatusFlags(upsName, statusVar.value);
          }

          if (!this.enrichedUps.has(upsName) && rwVars.length > 0) {
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
                  const min = parseFloat(ranges[0].min);
                  const max = parseFloat(ranges[0].max);
                  const patch: { min?: number; max?: number } = {};
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

          await this.setStateAsync(`${upsName}.info.online`, { val: true, ack: true });

          if (this.failedUps.has(upsName)) {
            this.log.info(`UPS '${upsName}' recovered`);
            this.failedUps.delete(upsName);
          }
        } catch (err) {
          await this.setStateAsync(`${upsName}.info.online`, { val: false, ack: true });

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

      await this.setStateAsync("info.connection", { val: true, ack: true });

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

      await this.setStateAsync("info.connection", { val: false, ack: true });
    } finally {
      this.isPolling = false;
    }
  }

  private async onStateChange(id: string, state: ioBroker.State | null | undefined): Promise<void> {
    if (!state || state.ack) {
      return;
    }
    const config = this.config as unknown as AdapterConfig;
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
      const cmdName = parts.slice(2).join(".").replace(/-/g, ".");
      this.log.debug(`INSTCMD ${upsName} ${cmdName}`);
      try {
        await this.client.instCmd(upsName, cmdName);
        this.log.info(`Command executed: ${cmdName} on ${upsName}`);
      } catch (err) {
        this.log.error(`Command failed: ${cmdName} on ${upsName} — ${errText(err)}`);
      }
      await this.setStateAsync(id, { val: false, ack: true });
      return;
    }

    if (!config.enableSetVar) {
      this.log.warn(`SET VAR blocked — enableSetVar is disabled: ${localId}`);
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
      this.log.error(`SET VAR failed: ${varName} on ${upsName} — ${errText(err)}`);
    }
  }

  private async onMessage(obj: ioBroker.Message): Promise<void> {
    await dispatchMessage(obj, {
      log: {
        debug: (m: string) => this.log.debug(m),
        warn: (m: string) => this.log.warn(m),
      },
      sendTo: this.sendTo.bind(this),
      createTestClient: makeTestClientFactory(NutClient, {
        debug: (m: string) => this.log.debug(m),
        warn: (m: string) => this.log.warn(m),
        info: (m: string) => this.log.info(m),
      }),
      onTestClientCreated: client => {
        this.testClients.add(client);
      },
      onTestClientDone: client => {
        this.testClients.delete(client);
      },
    });
  }

  private onUnload(callback: () => void): void {
    try {
      if (this.pollTimer) {
        this.clearInterval(this.pollTimer);
        this.pollTimer = undefined;
      }
      this.client?.cancelAll();
      this.client?.destroy();
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
