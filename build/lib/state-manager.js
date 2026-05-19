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
  StateManager: () => StateManager,
  nutVarToReadableName: () => nutVarToReadableName,
  nutVarToStateId: () => nutVarToStateId
});
module.exports = __toCommonJS(state_manager_exports);
var import_i18n_states = require("./i18n-states");
var import_status_parser = require("./status-parser");
var import_type_detector = require("./type-detector");
const STATUS_FLAG_ROLES = {
  lowBattery: "indicator.lowbat",
  overloaded: "indicator.alarm",
  replaceBattery: "indicator.maintenance",
  onBattery: "indicator.alarm",
  forcedShutdown: "indicator.alarm",
  alarm: "indicator.alarm",
  commLost: "indicator.alarm"
};
function nutVarToStateId(upsName, nutVarName) {
  const firstDot = nutVarName.indexOf(".");
  if (firstDot < 0) {
    return `${upsName}.${nutVarName}`;
  }
  const channel = nutVarName.slice(0, firstDot);
  const leaf = nutVarName.slice(firstDot + 1).replace(/\./g, "-");
  return `${upsName}.${channel}.${leaf}`;
}
function nutVarToReadableName(nutVarName) {
  const firstDot = nutVarName.indexOf(".");
  const leaf = firstDot >= 0 ? nutVarName.slice(firstDot + 1) : nutVarName;
  return leaf.replace(/\./g, " ").replace(/^./, (c) => c.toUpperCase());
}
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
    await this.adapter.extendObjectAsync(upsName, {
      type: "device",
      common: {
        name: description,
        statusStates: {
          onlineId: `${this.adapter.namespace}.${upsName}.info.online`
        }
      },
      native: {}
    });
    this.createdIds.add(upsName);
    await this.ensureChannel(upsName, "info");
    await this.ensureState(`${upsName}.info.online`, {
      type: "boolean",
      role: "indicator.reachable",
      read: true,
      write: false,
      name: (0, import_i18n_states.tName)("upsOnline")
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
  async updateDeviceName(upsName, description, variables) {
    var _a, _b, _c, _d;
    if (description && description !== "Description unavailable") {
      return;
    }
    const mfr = (_b = (_a = variables.find((v) => v.name === "device.mfr")) == null ? void 0 : _a.value) == null ? void 0 : _b.trim();
    const model = (_d = (_c = variables.find((v) => v.name === "device.model")) == null ? void 0 : _c.value) == null ? void 0 : _d.trim();
    if (mfr || model) {
      const name = [mfr, model].filter(Boolean).join(" ");
      await this.adapter.extendObjectAsync(upsName, { common: { name } });
    }
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
    var _a;
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
      const stateId = nutVarToStateId(upsName, v.name);
      const states = (0, import_type_detector.detectStates)(v.name);
      const genericName = v.name.replace(/\.\d+\./, ".");
      const i18nName = (_a = import_i18n_states.VARIABLE_I18N[v.name]) != null ? _a : import_i18n_states.VARIABLE_I18N[genericName];
      await this.ensureState(stateId, {
        type: detected.type,
        role: detected.role,
        unit: detected.unit,
        read: detected.read,
        write: detected.write,
        name: i18nName != null ? i18nName : nutVarToReadableName(v.name),
        states
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
    var _a;
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
    await this.ensureState(`${upsName}.status.display`, {
      type: "string",
      role: "text",
      read: true,
      write: false,
      name: (0, import_i18n_states.tName)("statusDisplay")
    });
    await this.adapter.setState(`${upsName}.status.display`, {
      val: (0, import_status_parser.getDisplayString)(rawStatus),
      ack: true
    });
    for (const flagKey of import_status_parser.ALL_FLAG_KEYS) {
      const stateId = `${upsName}.status.${flagKey}`;
      const flagI18nKey = import_i18n_states.FLAG_I18N[flagKey];
      await this.ensureState(stateId, {
        type: "boolean",
        role: (_a = STATUS_FLAG_ROLES[flagKey]) != null ? _a : "indicator",
        read: true,
        write: false,
        name: flagI18nKey ? (0, import_i18n_states.tName)(flagI18nKey) : flagKey
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
      const stateId = `${upsName}.commands.${cmd.name.replace(/\./g, "-")}`;
      const cmdI18nKey = import_i18n_states.COMMAND_I18N[cmd.name];
      await this.ensureState(stateId, {
        type: "boolean",
        role: "button",
        read: false,
        write: true,
        name: cmdI18nKey ? (0, import_i18n_states.tName)(cmdI18nKey) : cmd.name.replace(/\./g, " ").replace(/^./, (c) => c.toUpperCase()),
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
  /**
   * Remove orphaned objects from previous adapter versions and v0.1.0 dot-style objects.
   *
   * @param knownUpsNames Set of currently discovered UPS names
   */
  async cleanupLegacyObjects(knownUpsNames) {
    const adapterObjects = await this.adapter.getAdapterObjectsAsync();
    const orphanRoots = /* @__PURE__ */ new Set();
    const dotStyleIds = [];
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
  async cleanupDeprecatedInfoStates(upsName) {
    const deprecated = [`${upsName}.info.name`, `${upsName}.info.description`];
    for (const id of deprecated) {
      try {
        await this.adapter.delObjectAsync(id);
        this.adapter.log.debug(`Removed deprecated state: ${id}`);
      } catch {
      }
    }
  }
  /**
   * Remove all cached IDs under a prefix.
   *
   * @param prefix ID prefix to clear
   */
  dropCacheUnder(prefix) {
    for (const id of [...this.createdIds]) {
      if (id === prefix || id.startsWith(`${prefix}.`)) {
        this.createdIds.delete(id);
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
    await this.adapter.extendObjectAsync(id, {
      type: "state",
      common,
      native: {}
    });
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
  async enrichStateMetadata(id, patch) {
    const common = {};
    if (patch.states) {
      common.states = patch.states;
    }
    if (patch.min !== void 0) {
      common.min = patch.min;
    }
    if (patch.max !== void 0) {
      common.max = patch.max;
    }
    if (Object.keys(common).length > 0) {
      await this.adapter.extendObjectAsync(id, { common });
    }
  }
}
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  StateManager,
  nutVarToReadableName,
  nutVarToStateId
});
//# sourceMappingURL=state-manager.js.map
