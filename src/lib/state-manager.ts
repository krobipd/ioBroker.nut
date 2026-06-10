import type * as utils from "@iobroker/adapter-core";
import { tName, type I18nKey } from "./i18n";
import { ALL_FLAG_KEYS, FLAG_META, getDisplayString, parseStatus } from "./status-parser";
import { detectStates, detectType } from "./type-detector";
import type { NutCommand, NutVariable } from "./types";

type LocalizedName = ioBroker.StringOrTranslated;

const CHANNEL_I18N: Record<string, I18nKey> = {
  battery: "channelBattery",
  device: "channelDevice",
  driver: "channelDriver",
  input: "channelInput",
  output: "channelOutput",
  ups: "channelUps",
  outlet: "channelOutlet",
  ambient: "channelAmbient",
  status: "channelStatus",
  commands: "channelCommands",
  info: "channelUpsInfo",
};

const COMMAND_I18N: Record<string, I18nKey> = {
  "beeper.disable": "cmdBeeperDisable",
  "beeper.enable": "cmdBeeperEnable",
  "beeper.mute": "cmdBeeperMute",
  "beeper.toggle": "cmdBeeperToggle",
  "load.off": "cmdLoadOff",
  "load.on": "cmdLoadOn",
  "load.off.delay": "cmdLoadOffDelay",
  "load.on.delay": "cmdLoadOnDelay",
  "shutdown.default": "cmdShutdownDefault",
  "shutdown.return": "cmdShutdownReturn",
  "shutdown.stayoff": "cmdShutdownStayoff",
  "shutdown.stop": "cmdShutdownStop",
  "shutdown.reboot": "cmdShutdownReboot",
  "shutdown.reboot.graceful": "cmdShutdownRebootGraceful",
  "test.battery.start": "cmdTestBatteryStart",
  "test.battery.start.quick": "cmdTestBatteryStartQuick",
  "test.battery.start.low": "cmdTestBatteryStartLow",
  "test.battery.start.deep": "cmdTestBatteryStartDeep",
  "test.battery.stop": "cmdTestBatteryStop",
  "test.panel.start": "cmdTestPanelStart",
  "test.panel.stop": "cmdTestPanelStop",
  "test.failure.start": "cmdTestFailureStart",
  "test.failure.stop": "cmdTestFailureStop",
  "test.system.start": "cmdTestSystemStart",
  "calibrate.start": "cmdCalibrateStart",
  "calibrate.stop": "cmdCalibrateStop",
  "bypass.start": "cmdBypassStart",
  "bypass.stop": "cmdBypassStop",
  "reset.input.minmax": "cmdResetInputMinmax",
  "reset.watchdog": "cmdResetWatchdog",
};

const TRANSLATED_VARIABLES = new Set<I18nKey>([
  "battery.charge",
  "battery.charge.low",
  "battery.runtime",
  "battery.type",
  "battery.voltage",
  "battery.temperature",
  "battery.capacity",
  "battery.charger.status",
  "device.mfr",
  "device.model",
  "device.serial",
  "device.type",
  "driver.name",
  "driver.version",
  "driver.version.data",
  "driver.version.internal",
  "driver.parameter.pollfreq",
  "driver.parameter.pollinterval",
  "driver.parameter.port",
  "driver.parameter.synchronous",
  "driver.flag.ignorelb",
  "driver.version.usb",
  "input.voltage",
  "input.frequency",
  "input.transfer.high",
  "input.transfer.low",
  "input.voltage.extended",
  "output.voltage",
  "output.frequency",
  "output.voltage.nominal",
  "output.frequency.nominal",
  "output.current",
  "ups.status",
  "ups.load",
  "ups.power",
  "ups.realpower",
  "ups.power.nominal",
  "ups.temperature",
  "ups.delay.shutdown",
  "ups.delay.start",
  "ups.timer.shutdown",
  "ups.timer.start",
  "ups.firmware",
  "ups.beeper.status",
  "ups.mfr",
  "ups.model",
  "ups.serial",
  "ups.vendorid",
  "ups.productid",
  "outlet.desc",
  "outlet.id",
  "outlet.switchable",
  "outlet.status",
  "ambient.temperature",
  "ambient.humidity",
] as I18nKey[]);

function varTranslation(nutVarName: string): LocalizedName | undefined {
  if (TRANSLATED_VARIABLES.has(nutVarName as I18nKey)) {
    return tName(nutVarName as I18nKey);
  }
  const generic = nutVarName.replace(/\.\d+\./, ".");
  if (generic !== nutVarName && TRANSLATED_VARIABLES.has(generic as I18nKey)) {
    return tName(generic as I18nKey);
  }
  return undefined;
}

/**
 * Convert NUT variable name to ioBroker state ID (dots after channel → dashes).
 *
 * @param upsName UPS identifier
 * @param nutVarName NUT variable name
 */
export function nutVarToStateId(upsName: string, nutVarName: string): string {
  const firstDot = nutVarName.indexOf(".");
  if (firstDot < 0) {
    return `${upsName}.${nutVarName}`;
  }
  const channel = nutVarName.slice(0, firstDot);
  const leaf = nutVarName.slice(firstDot + 1).replace(/\./g, "-");
  return `${upsName}.${channel}.${leaf}`;
}

/**
 * Format NUT variable name as human-readable label.
 *
 * @param nutVarName NUT variable name
 */
export function nutVarToReadableName(nutVarName: string): string {
  const firstDot = nutVarName.indexOf(".");
  const leaf = firstDot >= 0 ? nutVarName.slice(firstDot + 1) : nutVarName;
  return leaf.replace(/\./g, " ").replace(/^./, c => c.toUpperCase());
}

/** Manages creation, update and cleanup of ioBroker objects and states for NUT UPS devices. */
export class StateManager {
  private readonly adapter: utils.AdapterInstance;
  private readonly createdIds = new Set<string>();

  /**
   * @param adapter The ioBroker adapter instance
   */
  constructor(adapter: utils.AdapterInstance) {
    this.adapter = adapter;
  }

  /**
   * Create device + standard channels for a discovered UPS.
   *
   * @param upsName NUT UPS identifier (e.g. "ups0")
   * @param description UPS description from LIST UPS
   */
  async ensureUpsDevice(upsName: string, description: string): Promise<void> {
    this.adapter.log.debug(`ensureUpsDevice: ${upsName} desc='${description}'`);
    await this.adapter.extendObjectAsync(
      upsName,
      {
        type: "device",
        common: {
          name: description,
          statusStates: {
            onlineId: `${this.adapter.namespace}.${upsName}.info.reachable`,
          },
        },
        native: {},
      },
      { preserve: { common: ["name"] } },
    );
    this.createdIds.add(upsName);

    await this.ensureChannel(upsName, "info");

    await this.ensureState(`${upsName}.info.reachable`, {
      type: "boolean",
      role: "indicator.reachable",
      read: true,
      write: false,
      name: tName("upsReachable"),
    });

    await this.cleanupDeprecatedInfoStates(upsName);
  }

  /**
   * Update device common.name from LIST VAR data when LIST UPS description is unusable.
   *
   * @param upsName UPS identifier
   * @param description UPS description from LIST UPS
   * @param variables Variables from LIST VAR
   */
  async updateDeviceName(
    upsName: string,
    description: string,
    variables: Array<{ name: string; value: string }>,
  ): Promise<void> {
    if (description && description !== "Description unavailable") {
      return;
    }
    const mfr = variables.find(v => v.name === "device.mfr")?.value?.trim();
    const model = variables.find(v => v.name === "device.model")?.value?.trim();
    if (mfr || model) {
      const name = [mfr, model].filter(Boolean).join(" ");
      const cacheKey = `${upsName}.__deviceNameFallback`;
      if (!this.createdIds.has(cacheKey)) {
        this.adapter.log.debug(`updateDeviceName ${upsName}: using fallback '${name}' (mfr+model)`);
        this.createdIds.add(cacheKey);
      }
      await this.adapter.extendObjectAsync(upsName, { common: { name } }, { preserve: { common: ["name"] } });
    }
  }

  /**
   * Ensure a channel exists for a NUT domain (e.g. "battery", "ups").
   *
   * @param upsName UPS identifier
   * @param channelName Channel name (NUT domain)
   */
  async ensureChannel(upsName: string, channelName: string): Promise<void> {
    const id = `${upsName}.${channelName}`;
    const i18nKey = CHANNEL_I18N[channelName];
    const name: LocalizedName = i18nKey ? tName(i18nKey) : channelName;

    await this.ensureObject(id, {
      type: "channel",
      common: { name },
      native: {},
    });
  }

  /**
   * Update variables from LIST VAR, creating states as needed.
   * Variables are processed sorted by dot-depth (shallow first) to ensure
   * parent states exist before children.
   *
   * @param upsName UPS identifier
   * @param variables Variables from LIST VAR
   * @param rwNames Set of writable variable names from LIST RW
   */
  async updateVariables(upsName: string, variables: NutVariable[], rwNames: Set<string>): Promise<void> {
    this.adapter.log.debug(`updateVariables ${upsName}: ${variables.length} vars, ${rwNames.size} writable`);
    const sorted = [...variables].sort((a, b) => {
      const depthA = a.name.split(".").length;
      const depthB = b.name.split(".").length;
      return depthA - depthB;
    });

    for (const v of sorted) {
      const channel = v.name.split(".")[0];
      await this.ensureChannel(upsName, channel);

      const isWritable = rwNames.has(v.name);
      const detected = detectType(v.name, v.value, isWritable);

      const stateId = nutVarToStateId(upsName, v.name);
      const states = detectStates(v.name);
      await this.ensureState(stateId, {
        type: detected.type,
        role: detected.role,
        unit: detected.unit,
        read: detected.read,
        write: detected.write,
        name: varTranslation(v.name) ?? nutVarToReadableName(v.name),
        states,
      });

      await this.adapter.setStateChangedAsync(stateId, { val: detected.parsedValue, ack: true });
    }
  }

  /**
   * Parse ups.status and update status channel with individual boolean flags + severity.
   *
   * @param upsName UPS identifier
   * @param rawStatus Raw ups.status value
   * @param chargerStatus Optional battery.charger.status (modern source for charging/discharging)
   */
  async updateStatusFlags(upsName: string, rawStatus: string, chargerStatus?: string): Promise<void> {
    await this.ensureChannel(upsName, "status");

    const result = parseStatus(rawStatus, chargerStatus);
    const activeFlags = ALL_FLAG_KEYS.filter(k => result.flags[k]).join(", ") || "none";
    this.adapter.log.debug(
      `updateStatusFlags ${upsName}: raw='${rawStatus}' severity=${result.severity} active=[${activeFlags}]`,
    );

    await this.ensureState(`${upsName}.status.raw`, {
      type: "string",
      role: "text",
      read: true,
      write: false,
      name: tName("statusRaw"),
    });
    await this.adapter.setStateChangedAsync(`${upsName}.status.raw`, { val: result.raw, ack: true });

    await this.ensureState(`${upsName}.status.severity`, {
      type: "number",
      role: "value",
      read: true,
      write: false,
      name: tName("statusSeverity"),
    });
    await this.adapter.setStateChangedAsync(`${upsName}.status.severity`, { val: result.severity, ack: true });

    await this.ensureState(`${upsName}.status.display`, {
      type: "string",
      role: "text",
      read: true,
      write: false,
      name: tName("statusDisplay"),
    });
    await this.adapter.setStateChangedAsync(`${upsName}.status.display`, {
      val: getDisplayString(rawStatus),
      ack: true,
    });

    for (const flagKey of ALL_FLAG_KEYS) {
      const stateId = `${upsName}.status.${flagKey}`;
      const meta = FLAG_META[flagKey];
      await this.ensureState(stateId, {
        type: "boolean",
        role: meta?.role ?? "indicator",
        read: true,
        write: false,
        name: meta ? tName(meta.i18nKey) : flagKey,
      });
      await this.adapter.setStateChangedAsync(stateId, { val: result.flags[flagKey], ack: true });
    }
  }

  /**
   * Create button states for instant commands.
   *
   * @param upsName UPS identifier
   * @param commands Commands from LIST CMD
   */
  async createCommandButtons(upsName: string, commands: NutCommand[]): Promise<void> {
    await this.ensureChannel(upsName, "commands");

    for (const cmd of commands) {
      const stateId = `${upsName}.commands.${cmd.name.replace(/\./g, "-")}`;
      const cmdI18nKey = COMMAND_I18N[cmd.name];
      await this.ensureState(stateId, {
        type: "boolean",
        role: "button",
        read: false,
        write: true,
        name: cmdI18nKey ? tName(cmdI18nKey) : cmd.name.replace(/\./g, " ").replace(/^./, c => c.toUpperCase()),
        def: false,
      });
    }
  }

  /**
   * Remove device objects for UPS devices no longer reported by the NUT server.
   *
   * @param currentUpsNames Set of currently discovered UPS names
   */
  async cleanupRemovedUps(currentUpsNames: Set<string>): Promise<void> {
    const adapterObjects = await this.adapter.getAdapterObjectsAsync();
    const deviceIds = new Set<string>();

    for (const [id, obj] of Object.entries(adapterObjects)) {
      if (obj.type === "device") {
        const localId = id.replace(`${this.adapter.namespace}.`, "");
        if (!currentUpsNames.has(localId)) {
          deviceIds.add(localId);
        }
      }
    }

    for (const deviceId of deviceIds) {
      this.adapter.log.info(`Removing stale UPS device: ${deviceId}`);
      await this.adapter.delObjectAsync(deviceId, { recursive: true });
      for (const cached of this.createdIds) {
        if (cached === deviceId || cached.startsWith(`${deviceId}.`)) {
          this.createdIds.delete(cached);
        }
      }
    }
  }

  /**
   * Remove orphaned objects from previous adapter versions and v0.1.0 dot-style objects.
   *
   * @param knownUpsNames Set of currently discovered UPS names
   */
  async cleanupLegacyObjects(knownUpsNames: Set<string>): Promise<void> {
    const adapterObjects = await this.adapter.getAdapterObjectsAsync();
    const orphanRoots = new Set<string>();
    const dotStyleIds: string[] = [];

    for (const fullId of Object.keys(adapterObjects)) {
      const localId = fullId.replace(`${this.adapter.namespace}.`, "");
      const parts = localId.split(".");
      const topLevel = parts[0];

      if (topLevel === "info") {
        continue;
      }

      if (!knownUpsNames.has(topLevel)) {
        orphanRoots.add(topLevel);
        continue;
      }

      if (parts.length > 3) {
        dotStyleIds.push(localId);
      }
    }

    for (const root of orphanRoots) {
      this.adapter.log.info(`Removing orphaned root object from previous adapter version: ${root}`);
      await this.adapter.delObjectAsync(root, { recursive: true });
      this.dropCacheUnder(root);
    }

    const sorted = dotStyleIds.sort((a, b) => b.split(".").length - a.split(".").length);
    for (const id of sorted) {
      this.adapter.log.debug(`Removing v0.1.0 dot-style object: ${id}`);
      await this.adapter.delObjectAsync(id);
      this.createdIds.delete(id);
    }
  }

  private async cleanupDeprecatedInfoStates(upsName: string): Promise<void> {
    const deprecated = [
      `${upsName}.info.name`,
      `${upsName}.info.description`,
      // Renamed to info.reachable in 0.4.0 (the old `online` leaf collided with the
      // status.online / OL flag). Without this delete the old state lingers frozen at its
      // last value — ioBroker does not auto-remove states an adapter stops writing.
      `${upsName}.info.online`,
      // Dropped non-standard status flags — not real NUT status_set tokens (COMM/NOCOMM),
      // or renamed (highEfficiency → ecoMode). NB: `testing` is NOT here — TEST is a real
      // token (apc_modbus, powercom, …) and is a current flag again.
      `${upsName}.status.commEstablished`,
      `${upsName}.status.commLost`,
      `${upsName}.status.highEfficiency`,
    ];
    for (const id of deprecated) {
      try {
        await this.adapter.delObjectAsync(id);
        this.adapter.log.debug(`Removed deprecated state: ${id}`);
      } catch {
        // Object doesn't exist — nothing to clean up
      }
    }
  }

  /**
   * Remove all cached IDs under a prefix.
   *
   * @param prefix ID prefix to clear
   */
  private dropCacheUnder(prefix: string): void {
    for (const id of [...this.createdIds]) {
      if (id === prefix || id.startsWith(`${prefix}.`)) {
        this.createdIds.delete(id);
      }
    }
  }

  private async ensureObject(
    id: string,
    obj: {
      type: "device" | "channel" | "folder";
      common: Partial<ioBroker.ObjectCommon>;
      native: Record<string, unknown>;
    },
  ): Promise<void> {
    if (this.createdIds.has(id)) {
      return;
    }
    await this.adapter.setObjectNotExistsAsync(id, {
      type: obj.type,
      common: obj.common as ioBroker.ObjectCommon,
      native: obj.native,
    });
    this.createdIds.add(id);
  }

  private async ensureState(
    id: string,
    common: {
      type: ioBroker.CommonType;
      role: string;
      read: boolean;
      write: boolean;
      name: LocalizedName;
      unit?: string;
      def?: boolean;
      states?: Record<string, string>;
      min?: number;
      max?: number;
    },
  ): Promise<void> {
    if (this.createdIds.has(id)) {
      return;
    }
    await this.adapter.extendObjectAsync(
      id,
      {
        type: "state",
        common,
        native: {},
      },
      { preserve: { common: ["name"] } },
    );
    this.createdIds.add(id);
  }

  /**
   * Enrich an existing state with ENUM/RANGE metadata from the NUT server.
   * Uses extendObjectAsync to deep-merge — overwrites only the provided keys.
   *
   * @param id State object ID
   * @param patch Metadata to apply (states for ENUM, min/max for RANGE)
   * @param patch.states ENUM value map
   * @param patch.min RANGE minimum
   * @param patch.max RANGE maximum
   */
  async enrichStateMetadata(
    id: string,
    patch: { states?: Record<string, string>; min?: number; max?: number },
  ): Promise<void> {
    this.adapter.log.debug(`enrichStateMetadata ${id}: ${JSON.stringify(patch)}`);
    const common: Record<string, unknown> = {};
    if (patch.states) {
      common.states = patch.states;
    }
    if (patch.min !== undefined) {
      common.min = patch.min;
    }
    if (patch.max !== undefined) {
      common.max = patch.max;
    }
    if (Object.keys(common).length > 0) {
      await this.adapter.extendObjectAsync(id, { common }, { preserve: { common: ["name"] } });
    }
  }
}
