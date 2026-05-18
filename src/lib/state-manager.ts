import type * as utils from "@iobroker/adapter-core";
import { CHANNEL_I18N, tName } from "./i18n-states";
import { ALL_FLAG_KEYS, parseStatus } from "./status-parser";
import { detectType } from "./type-detector";
import type { NutCommand, NutVariable } from "./types";

type LocalizedName = ioBroker.StringOrTranslated;

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
    await this.ensureObject(upsName, {
      type: "device",
      common: { name: description },
      native: {},
    });

    await this.ensureState(`${upsName}.info.name`, {
      type: "string",
      role: "text",
      read: true,
      write: false,
      name: tName("upsName"),
    });
    await this.adapter.setState(`${upsName}.info.name`, { val: upsName, ack: true });

    await this.ensureState(`${upsName}.info.description`, {
      type: "string",
      role: "text",
      read: true,
      write: false,
      name: tName("upsDescription"),
    });
    await this.adapter.setState(`${upsName}.info.description`, { val: description, ack: true });
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

      const stateId = `${upsName}.${v.name}`;
      await this.ensureState(stateId, {
        type: detected.type,
        role: detected.role,
        unit: detected.unit,
        read: detected.read,
        write: detected.write,
        name: v.name,
      });

      await this.adapter.setState(stateId, { val: detected.parsedValue, ack: true });
    }
  }

  /**
   * Parse ups.status and update status channel with individual boolean flags + severity.
   *
   * @param upsName UPS identifier
   * @param rawStatus Raw ups.status value
   */
  async updateStatusFlags(upsName: string, rawStatus: string): Promise<void> {
    await this.ensureChannel(upsName, "status");

    const result = parseStatus(rawStatus);

    await this.ensureState(`${upsName}.status.raw`, {
      type: "string",
      role: "text",
      read: true,
      write: false,
      name: tName("statusRaw"),
    });
    await this.adapter.setState(`${upsName}.status.raw`, { val: result.raw, ack: true });

    await this.ensureState(`${upsName}.status.severity`, {
      type: "number",
      role: "value",
      read: true,
      write: false,
      name: tName("statusSeverity"),
    });
    await this.adapter.setState(`${upsName}.status.severity`, { val: result.severity, ack: true });

    for (const flagKey of ALL_FLAG_KEYS) {
      const stateId = `${upsName}.status.${flagKey}`;
      await this.ensureState(stateId, {
        type: "boolean",
        role: "indicator",
        read: true,
        write: false,
        name: flagKey,
      });
      await this.adapter.setState(stateId, { val: result.flags[flagKey], ack: true });
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
      const stateId = `${upsName}.commands.${cmd.name}`;
      await this.ensureState(stateId, {
        type: "boolean",
        role: "button",
        read: false,
        write: true,
        name: cmd.name,
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
    },
  ): Promise<void> {
    if (this.createdIds.has(id)) {
      return;
    }
    await this.adapter.setObjectNotExistsAsync(id, {
      type: "state",
      common,
      native: {},
    });
    this.createdIds.add(id);
  }
}
