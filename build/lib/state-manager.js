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
var state_manager_exports = {};
__export(state_manager_exports, {
  StateManager: () => StateManager
});
module.exports = __toCommonJS(state_manager_exports);
var import_i18n_states = require("./i18n-states");
var import_status_parser = require("./status-parser");
var import_type_detector = require("./type-detector");
class StateManager {
  adapter;
  createdIds = /* @__PURE__ */ new Set();
  /**
   * @param adapter The ioBroker adapter instance
   */
  constructor(adapter) {
    this.adapter = adapter;
  }
  /**
   * Create device + standard channels for a discovered UPS.
   *
   * @param upsName NUT UPS identifier (e.g. "ups0")
   * @param description UPS description from LIST UPS
   */
  async ensureUpsDevice(upsName, description) {
    await this.ensureObject(upsName, {
      type: "device",
      common: { name: description },
      native: {}
    });
    await this.ensureState(`${upsName}.info.name`, {
      type: "string",
      role: "text",
      read: true,
      write: false,
      name: (0, import_i18n_states.tName)("upsName")
    });
    await this.adapter.setState(`${upsName}.info.name`, { val: upsName, ack: true });
    await this.ensureState(`${upsName}.info.description`, {
      type: "string",
      role: "text",
      read: true,
      write: false,
      name: (0, import_i18n_states.tName)("upsDescription")
    });
    await this.adapter.setState(`${upsName}.info.description`, { val: description, ack: true });
  }
  /**
   * Ensure a channel exists for a NUT domain (e.g. "battery", "ups").
   *
   * @param upsName UPS identifier
   * @param channelName Channel name (NUT domain)
   */
  async ensureChannel(upsName, channelName) {
    const id = `${upsName}.${channelName}`;
    const i18nKey = import_i18n_states.CHANNEL_I18N[channelName];
    const name = i18nKey ? (0, import_i18n_states.tName)(i18nKey) : channelName;
    await this.ensureObject(id, {
      type: "channel",
      common: { name },
      native: {}
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
  async updateVariables(upsName, variables, rwNames) {
    const sorted = [...variables].sort((a, b) => {
      const depthA = a.name.split(".").length;
      const depthB = b.name.split(".").length;
      return depthA - depthB;
    });
    for (const v of sorted) {
      const channel = v.name.split(".")[0];
      await this.ensureChannel(upsName, channel);
      const isWritable = rwNames.has(v.name);
      const detected = (0, import_type_detector.detectType)(v.name, v.value, isWritable);
      const stateId = `${upsName}.${v.name}`;
      await this.ensureState(stateId, {
        type: detected.type,
        role: detected.role,
        unit: detected.unit,
        read: detected.read,
        write: detected.write,
        name: v.name
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
  async updateStatusFlags(upsName, rawStatus) {
    await this.ensureChannel(upsName, "status");
    const result = (0, import_status_parser.parseStatus)(rawStatus);
    await this.ensureState(`${upsName}.status.raw`, {
      type: "string",
      role: "text",
      read: true,
      write: false,
      name: (0, import_i18n_states.tName)("statusRaw")
    });
    await this.adapter.setState(`${upsName}.status.raw`, { val: result.raw, ack: true });
    await this.ensureState(`${upsName}.status.severity`, {
      type: "number",
      role: "value",
      read: true,
      write: false,
      name: (0, import_i18n_states.tName)("statusSeverity")
    });
    await this.adapter.setState(`${upsName}.status.severity`, { val: result.severity, ack: true });
    for (const flagKey of import_status_parser.ALL_FLAG_KEYS) {
      const stateId = `${upsName}.status.${flagKey}`;
      await this.ensureState(stateId, {
        type: "boolean",
        role: "indicator",
        read: true,
        write: false,
        name: flagKey
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
  async createCommandButtons(upsName, commands) {
    await this.ensureChannel(upsName, "commands");
    for (const cmd of commands) {
      const stateId = `${upsName}.commands.${cmd.name}`;
      await this.ensureState(stateId, {
        type: "boolean",
        role: "button",
        read: false,
        write: true,
        name: cmd.name,
        def: false
      });
    }
  }
  /**
   * Remove device objects for UPS devices no longer reported by the NUT server.
   *
   * @param currentUpsNames Set of currently discovered UPS names
   */
  async cleanupRemovedUps(currentUpsNames) {
    const adapterObjects = await this.adapter.getAdapterObjectsAsync();
    const deviceIds = /* @__PURE__ */ new Set();
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
  async ensureObject(id, obj) {
    if (this.createdIds.has(id)) {
      return;
    }
    await this.adapter.setObjectNotExistsAsync(id, {
      type: obj.type,
      common: obj.common,
      native: obj.native
    });
    this.createdIds.add(id);
  }
  async ensureState(id, common) {
    if (this.createdIds.has(id)) {
      return;
    }
    await this.adapter.setObjectNotExistsAsync(id, {
      type: "state",
      common,
      native: {}
    });
    this.createdIds.add(id);
  }
}
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  StateManager
});
//# sourceMappingURL=state-manager.js.map
