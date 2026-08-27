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
  nutVarToStateId: () => nutVarToStateId,
  sanitizeUpsName: () => sanitizeUpsName
});
module.exports = __toCommonJS(state_manager_exports);
var import_i18n = require("./i18n");
var import_status_parser = require("./status-parser");
var import_type_detector = require("./type-detector");
const CHANNEL_I18N = {
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
  info: "channelUpsInfo"
};
const COMMAND_I18N = {
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
  "reset.watchdog": "cmdResetWatchdog"
};
const TRANSLATED_VARIABLES = /* @__PURE__ */ new Set([
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
  "ambient.humidity"
]);
function varTranslation(nutVarName) {
  if (TRANSLATED_VARIABLES.has(nutVarName)) {
    return (0, import_i18n.tName)(nutVarName);
  }
  const generic = nutVarName.replace(/\.(\d+|L\d(-(L\d|N))?|N)\./, ".");
  if (generic !== nutVarName && TRANSLATED_VARIABLES.has(generic)) {
    return (0, import_i18n.tName)(generic);
  }
  return void 0;
}
function sanitizeUpsName(name) {
  return name.replace(/[^A-Za-z0-9_-]/g, "_");
}
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
  /** NUT variables already warned about as garbage in a numeric field (warn once). */
  warnedGarbageVars = /* @__PURE__ */ new Set();
  /** Last device name derived from mfr+model per UPS — lets a transient/wrong fallback self-correct. */
  fallbackNames = /* @__PURE__ */ new Map();
  /**
   * stateId → original NUT variable/command name. The dot→dash id mapping is lossy for names
   * containing a literal dash (three-phase input.L1-L2.*), so onStateChange reads the real name
   * back from here instead of reversing the id.
   */
  nutNames = /* @__PURE__ */ new Map();
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
    this.adapter.log.debug(`ensureUpsDevice: ${upsName} desc='${description}'`);
    await this.adapter.extendObject(
      upsName,
      {
        type: "device",
        common: {
          name: description,
          statusStates: {
            onlineId: `${this.adapter.namespace}.${upsName}.info.reachable`
          }
        },
        native: {}
      },
      { preserve: { common: ["name"] } }
    );
    this.createdIds.add(upsName);
    await this.ensureChannel(upsName, "info");
    await this.ensureState(`${upsName}.info.reachable`, {
      type: "boolean",
      role: "indicator.reachable",
      read: true,
      write: false,
      name: (0, import_i18n.tName)("upsReachable"),
      def: false
    });
    await this.cleanupDeprecatedInfoStates(upsName);
  }
  /**
   * Update device common.name from LIST VAR data when LIST UPS description is unusable.
   *
   * The fallback must NOT use `preserve: common.name` — the device object always has a
   * name (set by ensureUpsDevice from the unusable description), so a preserved write
   * would never apply (js-controller 7.x `removePreservedProperties` drops the new name
   * whenever the old object has one; this silently killed the feature in v0.2.5-v0.4.1).
   * User-modified names stay safe through the guard instead: the fallback only fires
   * while the CURRENT name is still the auto-set placeholder or a value WE derived
   * earlier — so a transient/wrong mfr+model that arrived first self-corrects, while a
   * user-chosen name is left untouched. No broker round-trip while the derived name is stable.
   *
   * @param upsName UPS identifier
   * @param description UPS description from LIST UPS
   * @param variables Variables from LIST VAR
   */
  async updateDeviceName(upsName, description, variables) {
    var _a, _b, _c, _d, _e;
    if (description && description !== "Description unavailable") {
      return;
    }
    const mfr = (_b = (_a = variables.find((v) => v.name === "device.mfr")) == null ? void 0 : _a.value) == null ? void 0 : _b.trim();
    const model = (_d = (_c = variables.find((v) => v.name === "device.model")) == null ? void 0 : _c.value) == null ? void 0 : _d.trim();
    if (!mfr && !model) {
      return;
    }
    const name = [mfr, model].filter(Boolean).join(" ");
    if (this.fallbackNames.get(upsName) === name) {
      return;
    }
    const obj = await this.adapter.getObjectAsync(upsName);
    const currentName = (_e = obj == null ? void 0 : obj.common) == null ? void 0 : _e.name;
    const replaceable = currentName === description || currentName === "Description unavailable" || currentName === "" || currentName === this.fallbackNames.get(upsName);
    if (!replaceable) {
      return;
    }
    this.adapter.log.debug(`updateDeviceName ${upsName}: using fallback '${name}' (mfr+model)`);
    await this.adapter.extendObject(upsName, { common: { name } });
    this.fallbackNames.set(upsName, name);
  }
  /**
   * Ensure a channel exists for a NUT domain (e.g. "battery", "ups").
   *
   * @param upsName UPS identifier
   * @param channelName Channel name (NUT domain)
   */
  async ensureChannel(upsName, channelName) {
    const id = `${upsName}.${channelName}`;
    const i18nKey = CHANNEL_I18N[channelName];
    const name = i18nKey ? (0, import_i18n.tName)(i18nKey) : channelName;
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
    this.adapter.log.debug(`updateVariables ${upsName}: ${variables.length} vars, ${rwNames.size} writable`);
    const sorted = [...variables].sort((a, b) => {
      const depthA = a.name.split(".").length;
      const depthB = b.name.split(".").length;
      return depthA - depthB;
    });
    for (const v of sorted) {
      const firstDot = v.name.indexOf(".");
      if (firstDot >= 0) {
        await this.ensureChannel(upsName, v.name.slice(0, firstDot));
      }
      const isWritable = rwNames.has(v.name);
      const detected = (0, import_type_detector.detectType)(v.name, v.value, isWritable);
      if (detected.expectedNumeric) {
        if (!this.warnedGarbageVars.has(v.name)) {
          this.warnedGarbageVars.add(v.name);
          this.adapter.log.warn(
            `Discarding non-numeric value ${JSON.stringify(v.value)} for numeric variable '${v.name}' on ${upsName}`
          );
        }
        continue;
      }
      const stateId = nutVarToStateId(upsName, v.name);
      this.nutNames.set(stateId, v.name);
      const states = (0, import_type_detector.detectStates)(v.name);
      await this.ensureState(stateId, {
        type: detected.type,
        role: detected.role,
        unit: detected.unit,
        read: detected.read,
        write: detected.write,
        name: (_a = varTranslation(v.name)) != null ? _a : nutVarToReadableName(v.name),
        states
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
  async updateStatusFlags(upsName, rawStatus, chargerStatus) {
    var _a;
    await this.ensureChannel(upsName, "status");
    const result = (0, import_status_parser.parseStatus)(rawStatus, chargerStatus);
    const activeFlags = import_status_parser.ALL_FLAG_KEYS.filter((k) => result.flags[k]).join(", ") || "none";
    this.adapter.log.debug(
      `updateStatusFlags ${upsName}: raw='${rawStatus}' severity=${result.severity} active=[${activeFlags}]`
    );
    await this.ensureAndSet(
      `${upsName}.status.raw`,
      { type: "string", role: "text", read: true, write: false, name: (0, import_i18n.tName)("statusRaw") },
      result.raw
    );
    await this.ensureAndSet(
      `${upsName}.status.severity`,
      {
        type: "number",
        role: "value.severity",
        read: true,
        write: false,
        name: (0, import_i18n.tName)("statusSeverity"),
        states: { 0: "OK", 1: "Info", 2: "Warning", 3: "Critical", 4: "Emergency" }
      },
      result.severity
    );
    await this.ensureAndSet(
      `${upsName}.status.display`,
      { type: "string", role: "text", read: true, write: false, name: (0, import_i18n.tName)("statusDisplay") },
      (0, import_status_parser.getDisplayString)(rawStatus)
    );
    for (const flagKey of import_status_parser.ALL_FLAG_KEYS) {
      const meta = import_status_parser.FLAG_META[flagKey];
      await this.ensureAndSet(
        `${upsName}.status.${flagKey}`,
        {
          type: "boolean",
          role: (_a = meta == null ? void 0 : meta.role) != null ? _a : "indicator",
          read: true,
          write: false,
          name: meta ? (0, import_i18n.tName)(meta.i18nKey) : flagKey
        },
        result.flags[flagKey]
      );
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
      this.nutNames.set(stateId, cmd.name);
      const cmdI18nKey = COMMAND_I18N[cmd.name];
      await this.ensureState(stateId, {
        type: "boolean",
        role: "button",
        read: false,
        write: true,
        name: cmdI18nKey ? (0, import_i18n.tName)(cmdI18nKey) : cmd.name.replace(/\./g, " ").replace(/^./, (c) => c.toUpperCase()),
        def: false
      });
    }
  }
  /**
   * The original NUT variable/command name for a created state id. onStateChange uses it instead
   * of reversing the dot→dash id mapping, which is lossy for names carrying a literal dash
   * (e.g. three-phase input.L1-L2.voltage). Undefined for states not backed by a NUT var/command.
   *
   * @param stateId Local state id (e.g. "ups0.input.L1-L2-voltage")
   */
  nutNameForState(stateId) {
    return this.nutNames.get(stateId);
  }
  /**
   * Reset `info.reachable` to false for every UPS device already in the object tree.
   *
   * ioBroker keeps the last value of a state forever, and the device object points its
   * `statusStates.onlineId` at this one — so a UPS keeps showing "online" across an adapter
   * restart until the first successful poll overwrites it. That window is unbounded whenever
   * the NUT server cannot be reached: the poll timer is only armed after a connect, so with
   * the server down nothing ever writes the state and the stale `true` stands indefinitely.
   * Called at startup, before the first connect attempt: not-yet-read is honestly "not
   * reachable", which is what the state's own default (`def: false`) already declares.
   */
  async markAllUnreachable() {
    const adapterObjects = await this.adapter.getAdapterObjectsAsync();
    const localIds = new Set(Object.keys(adapterObjects).map((id) => id.replace(`${this.adapter.namespace}.`, "")));
    for (const [id, obj] of Object.entries(adapterObjects)) {
      if (obj.type !== "device") {
        continue;
      }
      const reachableId = `${id.replace(`${this.adapter.namespace}.`, "")}.info.reachable`;
      if (!localIds.has(reachableId)) {
        continue;
      }
      await this.adapter.setStateChangedAsync(reachableId, { val: false, ack: true });
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
      this.dropCacheUnder(deviceId);
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
    const cacheKey = `${upsName}.__deprecatedCleanup`;
    if (this.createdIds.has(cacheKey)) {
      return;
    }
    this.createdIds.add(cacheKey);
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
      `${upsName}.status.highEfficiency`
    ];
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
    for (const id of [...this.nutNames.keys()]) {
      if (id === prefix || id.startsWith(`${prefix}.`)) {
        this.nutNames.delete(id);
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
    await this.adapter.extendObject(
      id,
      {
        type: "state",
        common,
        native: {}
      },
      { preserve: { common: ["name"] } }
    );
    this.createdIds.add(id);
  }
  /**
   * Ensure a state exists (once) and write its current value — the create-then-set pair used for
   * every status/flag datapoint.
   *
   * @param id State id
   * @param common Object definition forwarded to ensureState
   * @param val Value to write (acknowledged)
   */
  async ensureAndSet(id, common, val) {
    await this.ensureState(id, common);
    await this.adapter.setStateChangedAsync(id, { val, ack: true });
  }
  /**
   * Enrich an existing state with ENUM/RANGE metadata from the NUT server.
   * Uses extendObject to deep-merge — overwrites only the provided keys.
   *
   * @param id State object ID
   * @param patch Metadata to apply (states for ENUM, min/max for RANGE)
   * @param patch.states ENUM value map
   * @param patch.min RANGE minimum
   * @param patch.max RANGE maximum
   */
  async enrichStateMetadata(id, patch) {
    this.adapter.log.debug(`enrichStateMetadata ${id}: ${JSON.stringify(patch)}`);
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
      await this.adapter.extendObject(id, { common }, { preserve: { common: ["name"] } });
    }
  }
}
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  StateManager,
  nutVarToReadableName,
  nutVarToStateId,
  sanitizeUpsName
});
//# sourceMappingURL=state-manager.js.map
