import type * as utils from "@iobroker/adapter-core";
import { tDesc, tName, tRaw, tText, type I18nKey } from "./i18n";
import { ALL_FLAG_KEYS, FLAG_META, getDisplayEntries, parseStatus } from "./status-parser";
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
  // Collapse a per-instance or phase segment (ambient.2., input.L1., input.L1-L2., input.N.) to
  // the base name so three-phase and multi-sensor variables reuse the translated base label.
  const generic = nutVarName.replace(/\.(\d+|L\d(-(L\d|N))?|N)\./, ".");
  if (generic !== nutVarName && TRANSLATED_VARIABLES.has(generic as I18nKey)) {
    return tName(generic as I18nKey);
  }
  return undefined;
}

/**
 * Sanitize a NUT UPS name into an object-ID-safe segment: only A-Za-z0-9_- survive, everything
 * else (spaces, dots, ioBroker FORBIDDEN_CHARS) becomes an underscore. The result is the object ID;
 * the real NUT name is kept separately for the protocol (INSTCMD/SET VAR/LIST VAR).
 *
 * @param name Raw UPS name as reported by LIST UPS
 */
export function sanitizeUpsName(name: string): string {
  return name.replace(/[^A-Za-z0-9_-]/g, "_");
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

/**
 * Labels for the values of an enum datapoint (`common.states`). ioBroker has no translation
 * object there — a states map is plain strings — so these follow the system language at write
 * time, like every other user-facing label the adapter produces.
 */
const VALUE_I18N: Record<string, I18nKey> = {
  charging: "valCharging",
  discharging: "valDischarging",
  floating: "valFloating",
  resting: "valResting",
  enabled: "valEnabled",
  disabled: "valDisabled",
  muted: "valMuted",
  on: "valOn",
  off: "valOff",
  good: "valGood",
  "warning-low": "valWarningLow",
  "warning-high": "valWarningHigh",
  "critical-low": "valCriticalLow",
  "critical-high": "valCriticalHigh",
  "out-of-range": "valOutOfRange",
  open: "valOpen",
  closed: "valClosed",
  active: "valActive",
  inactive: "valInactive",
  ups: "valUps",
  pdu: "valPdu",
  scd: "valScd",
  psu: "valPsu",
  ats: "valAts",
};

/**
 * Explanations for the NUT variables where the name alone leaves a user guessing. Deliberately
 * NOT one per variable: `device.serial` explains itself, and an invented sentence is worse than
 * none (fleet rule — `common.desc` stays empty where there is nothing to explain).
 */
const VAR_DESC_I18N: Record<string, I18nKey> = {
  "battery.charge": "descBatteryCharge",
  "battery.charge.low": "descBatteryChargeLow",
  "battery.runtime": "descBatteryRuntime",
  "battery.type": "descBatteryType",
  "battery.charger.status": "descBatteryChargerStatus",
  "device.type": "descDeviceType",
  "driver.flag.ignorelb": "descDriverFlagIgnorelb",
  "driver.parameter.pollfreq": "descDriverParameterPollfreq",
  "driver.parameter.pollinterval": "descDriverParameterPollinterval",
  "input.transfer.high": "descInputTransferHigh",
  "input.transfer.low": "descInputTransferLow",
  "input.voltage": "descInputVoltage",
  "input.frequency": "descInputFrequency",
  "input.voltage.extended": "descInputVoltageExtended",
  "output.voltage": "descOutputVoltage",
  "output.voltage.nominal": "descOutputVoltageNominal",
  "output.frequency.nominal": "descOutputFrequencyNominal",
  "ups.status": "descUpsStatus",
  "ups.load": "descUpsLoad",
  "ups.power": "descUpsPower",
  "ups.realpower": "descUpsRealpower",
  "ups.power.nominal": "descUpsPowerNominal",
  "ups.delay.shutdown": "descUpsDelayShutdown",
  "ups.delay.start": "descUpsDelayStart",
  "ups.timer.shutdown": "descUpsTimerShutdown",
  "ups.timer.start": "descUpsTimerStart",
  "ups.beeper.status": "descUpsBeeperStatus",
  "ups.temperature": "descUpsTemperature",
  "outlet.switchable": "descOutletSwitchable",
  "outlet.status": "descOutletStatus",
  "ambient.temperature": "descAmbientTemperature",
  "ambient.humidity": "descAmbientHumidity",
};

/** Explanations for the channels — what kind of readings live below them. */
const CHANNEL_DESC_I18N: Record<string, I18nKey> = {
  battery: "descChannelBattery",
  device: "descChannelDevice",
  driver: "descChannelDriver",
  input: "descChannelInput",
  output: "descChannelOutput",
  ups: "descChannelUps",
  outlet: "descChannelOutlet",
  ambient: "descChannelAmbient",
  status: "descChannelStatus",
  commands: "descChannelCommands",
  info: "descChannelUpsInfo",
};

/**
 * The explanation for a NUT variable, or undefined when the name says it all. Same
 * base-name collapse as {@link varTranslation} so three-phase and multi-sensor variants
 * reuse the explanation of their base variable.
 *
 * @param nutVarName NUT variable name
 */
function varDescription(nutVarName: string): LocalizedName | undefined {
  const key = VAR_DESC_I18N[nutVarName];
  if (key) {
    return tDesc(key);
  }
  const generic = nutVarName.replace(/\.(\d+|L\d(-(L\d|N))?|N)\./, ".");
  const genericKey = VAR_DESC_I18N[generic];
  return genericKey ? tDesc(genericKey) : undefined;
}

/** Severity level → its label key (0 = OK … 4 = emergency). */
const SEVERITY_I18N: I18nKey[] = ["sev0", "sev1", "sev2", "sev3", "sev4"];

/**
 * Translate the labels of a value list; a value without a catalog entry keeps the server's own
 * token as its label.
 *
 * @param states The value list as detected from the NUT variable
 */
function localizeStates(states: Record<string, string> | undefined): Record<string, string> | undefined {
  if (!states) {
    return undefined;
  }
  const out: Record<string, string> = {};
  for (const [value, fallback] of Object.entries(states)) {
    const key = VALUE_I18N[value];
    out[value] = key ? tText(key) : fallback;
  }
  return out;
}

/** LIST UPS says this when the NUT server has no `desc` configured for a UPS in ups.conf. */
const NO_DESCRIPTION = "Description unavailable";

/** Manages creation, update and cleanup of ioBroker objects and states for NUT UPS devices. */
export class StateManager {
  private readonly adapter: utils.AdapterInstance;
  private readonly createdIds = new Set<string>();
  /** NUT variables already warned about as garbage in a numeric field (warn once). */
  private readonly warnedGarbageVars = new Set<string>();
  /** Last device name derived from mfr+model per UPS — lets a transient/wrong fallback self-correct. */
  private readonly fallbackNames = new Map<string, string>();
  /** Recording configurations of renamed datapoints whose successor is created later in this run. */
  private readonly pendingRecording = new Map<string, Record<string, unknown>>();
  /**
   * stateId → original NUT variable/command name. The dot→dash id mapping is lossy for names
   * containing a literal dash (three-phase input.L1-L2.*), so onStateChange reads the real name
   * back from here instead of reversing the id.
   */
  private readonly nutNames = new Map<string, string>();

  /**
   * @param adapter The ioBroker adapter instance
   */
  constructor(adapter: utils.AdapterInstance) {
    this.adapter = adapter;
  }

  /**
   * Re-apply the adapter's own manifest objects to an EXISTING installation.
   *
   * js-controller does refresh `common.desc` of an `instanceObjects` entry on every start — but
   * it does so with `preserve: { common: ["name"], native: true }` (measured in
   * `@iobroker/js-controller-adapter` 7.2.2, `_extendObjects`). The NAME is therefore frozen at
   * whatever the version that first created the object wrote: a rename in the manifest reaches
   * fresh installs only, and nothing — not the manifest, not a gate, not a test — would show it.
   * Only the live tree of an updated system would.
   *
   * The six ids are written out one by one on purpose rather than looped over the manifest: the
   * fleet gate matches the literal id at the `extendObject` call, and a loop would be DRYer but
   * unverifiable (`reference_gate_braucht_die_woertliche_kennung`).
   */
  async refreshInstanceObjects(): Promise<void> {
    await this.adapter.extendObject("info", {
      common: { name: tName("channelInfo"), desc: tDesc("descChannelInfo") },
    });
    await this.adapter.extendObject("info.connection", {
      common: { name: tName("connectionStatus"), desc: tDesc("descConnectionStatus") },
    });
    await this.adapter.extendObject("info.upsTotal", {
      common: { name: tName("upsCountTotal"), desc: tDesc("descUpsCountTotal") },
    });
    await this.adapter.extendObject("info.upsReachable", {
      common: { name: tName("upsCountReachable"), desc: tDesc("descUpsCountReachable") },
    });
    await this.adapter.extendObject("info.allUpsReachable", {
      common: { name: tName("upsAllReachable"), desc: tDesc("descUpsAllReachable") },
    });
    await this.adapter.extendObject("notify", {
      common: { name: tName("notifyTrigger"), desc: tDesc("descNotifyTrigger") },
    });
  }

  /**
   * Create device + standard channels for a discovered UPS.
   *
   * @param upsName NUT UPS identifier (e.g. "ups0")
   * @param description UPS description from LIST UPS
   */
  async ensureUpsDevice(upsName: string, description: string): Promise<void> {
    this.adapter.log.debug(`ensureUpsDevice: ${upsName} desc='${description}'`);
    // The server's own text, wrapped as a translation object like every other name (core-team
    // line, #15). Without a `desc` in ups.conf the server answers a placeholder — the UPS name
    // is the better label then, and the first poll replaces it with manufacturer + model.
    const label = description && description !== NO_DESCRIPTION ? description : upsName;
    await this.adapter.extendObject(
      upsName,
      {
        type: "device",
        common: {
          name: tRaw(label),
          statusStates: {
            onlineId: `${this.adapter.namespace}.${upsName}.info.reachable`,
          },
        },
        native: {},
      },
      // No `preserve` for the name: the adapter owns common.name/desc like it owns type and
      // role (krobi 2026-09-02 — a user's place is 0_userdata, not an adapter's datapoints).
      // The recording configuration is the explicit exception and stays untouched: merging
      // never removes what it does not carry (reference_iobroker_objekt_aendern_ohne_loeschen).
    );
    this.createdIds.add(upsName);

    await this.ensureChannel(upsName, "info");

    await this.ensureState(`${upsName}.info.reachable`, {
      type: "boolean",
      role: "indicator.reachable",
      read: true,
      write: false,
      name: tName("upsReachable"),
      desc: tDesc("descUpsReachable"),
      def: false,
    });

    // Last upsmon event routed to this UPS through the `notify` trigger state. Lives under the
    // adapter-owned info channel: a dotless NUT variable lands directly under the device, so any
    // leaf there could one day collide with a real variable name — info never can.
    await this.ensureState(`${upsName}.info.notify`, {
      type: "string",
      role: "text",
      read: true,
      write: false,
      name: tName("upsLastNotify"),
      desc: tDesc("descUpsLastNotify"),
    });

    await this.cleanupDeprecatedInfoStates(upsName);
  }

  /**
   * Update device common.name from LIST VAR data when LIST UPS description is unusable.
   *
   * The adapter owns the name: the derived one is written whenever it differs from the one
   * this adapter wrote last (memory-guarded, so a steady poll costs no broker round-trip).
   * A rename in the object tree is reset on the next sync — that is the fleet line since
   * 2026-09-02, not an oversight. `preserve: common.name` would additionally never apply
   * here, since the device object always carries a name (v0.2.5-v0.4.1 lost the fallback
   * that way).
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
    if (description && description !== NO_DESCRIPTION) {
      return;
    }
    const mfr = variables.find(v => v.name === "device.mfr")?.value?.trim();
    const model = variables.find(v => v.name === "device.model")?.value?.trim();
    if (!mfr && !model) {
      return;
    }
    const name = [mfr, model].filter(Boolean).join(" ");
    // Already applied this exact fallback name → no broker round-trip on steady-state polls.
    if (this.fallbackNames.get(upsName) === name) {
      return;
    }

    this.adapter.log.debug(`updateDeviceName ${upsName}: using fallback '${name}' (mfr+model)`);
    await this.adapter.extendObject(upsName, { common: { name: tRaw(name) } });
    this.fallbackNames.set(upsName, name);
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
    const name: LocalizedName = i18nKey ? tName(i18nKey) : tRaw(channelName);
    const descKey = CHANNEL_DESC_I18N[channelName];

    await this.ensureObject(id, {
      type: "channel",
      common: descKey ? { name, desc: tDesc(descKey) } : { name },
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
      // Dotless variables (e.g. a bare "ALARM" that some drivers expose) have no
      // channel segment — a same-named channel would collide with the state id and
      // leave a typeless object. Create those directly under the device instead.
      const firstDot = v.name.indexOf(".");
      if (firstDot >= 0) {
        await this.ensureChannel(upsName, v.name.slice(0, firstDot));
      }

      const isWritable = rwNames.has(v.name);
      const detected = detectType(v.name, v.value, isWritable);

      // Garbage value in a numeric field (e.g. "Infinity", "12abc") → discard
      // instead of storing junk, and warn once per variable (no log spam).
      if (detected.expectedNumeric) {
        // Keyed per UPS, not per variable name: the warning names the UPS, so a second UPS
        // reporting the same junk has to be able to say so once as well.
        const warnKey = `${upsName}.${v.name}`;
        if (!this.warnedGarbageVars.has(warnKey)) {
          this.warnedGarbageVars.add(warnKey);
          this.adapter.log.warn(
            `Discarding non-numeric value ${JSON.stringify(v.value)} for numeric variable '${v.name}' on ${upsName}`,
          );
        }
        continue;
      }

      const stateId = nutVarToStateId(upsName, v.name);
      this.nutNames.set(stateId, v.name);
      const states = localizeStates(detectStates(v.name));
      await this.ensureState(stateId, {
        type: detected.type,
        role: detected.role,
        unit: detected.unit,
        read: detected.read,
        write: detected.write,
        name: varTranslation(v.name) ?? tRaw(nutVarToReadableName(v.name)),
        desc: varDescription(v.name),
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

    await this.ensureAndSet(
      `${upsName}.status.raw`,
      {
        type: "string",
        role: "text",
        read: true,
        write: false,
        name: tName("statusRaw"),
        desc: tDesc("descStatusRaw"),
      },
      result.raw,
    );

    await this.ensureAndSet(
      `${upsName}.status.severity`,
      {
        type: "number",
        role: "value.severity",
        read: true,
        write: false,
        name: tName("statusSeverity"),
        desc: tDesc("descStatusSeverity"),
        states: Object.fromEntries(SEVERITY_I18N.map((key, level) => [level, tText(key)])),
      },
      result.severity,
    );

    await this.ensureAndSet(
      `${upsName}.status.display`,
      {
        type: "string",
        role: "text",
        read: true,
        write: false,
        name: tName("statusDisplay"),
        desc: tDesc("descStatusDisplay"),
      },
      getDisplayEntries(rawStatus)
        .map(entry => (entry.i18nKey ? tText(entry.i18nKey) : entry.token))
        .join(", "),
    );

    for (const flagKey of ALL_FLAG_KEYS) {
      const meta = FLAG_META[flagKey];
      await this.ensureAndSet(
        `${upsName}.status.${flagKey}`,
        {
          type: "boolean",
          role: meta?.role ?? "indicator",
          read: true,
          write: false,
          name: meta ? tName(meta.i18nKey) : tRaw(flagKey),
          desc: meta ? tDesc(meta.descKey) : undefined,
        },
        result.flags[flagKey],
      );
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
      this.nutNames.set(stateId, cmd.name);
      const cmdI18nKey = COMMAND_I18N[cmd.name];
      await this.ensureState(stateId, {
        type: "boolean",
        role: "button",
        read: false,
        write: true,
        name: cmdI18nKey ? tName(cmdI18nKey) : tRaw(cmd.name.replace(/\./g, " ").replace(/^./, c => c.toUpperCase())),
        // Every command the catalog knows gets its explanation; an unmapped one keeps none —
        // the adapter cannot know what a driver-private command does.
        desc: cmdI18nKey
          ? tDesc(`desc${cmdI18nKey.charAt(0).toUpperCase()}${cmdI18nKey.slice(1)}` as I18nKey)
          : undefined,
        def: false,
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
  nutNameForState(stateId: string): string | undefined {
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
  async markAllUnreachable(): Promise<void> {
    const adapterObjects = await this.adapter.getAdapterObjectsAsync();
    const localIds = new Set(Object.keys(adapterObjects).map(id => id.replace(`${this.adapter.namespace}.`, "")));

    for (const [id, obj] of Object.entries(adapterObjects)) {
      if (obj.type !== "device") {
        continue;
      }
      const reachableId = `${id.replace(`${this.adapter.namespace}.`, "")}.info.reachable`;
      // A device from an older object layout may not carry the state — writing it would create
      // a value without an object behind it.
      if (!localIds.has(reachableId)) {
        continue;
      }
      await this.adapter.setStateChangedAsync(reachableId, { val: false, ack: true });
    }
    // The summary makes the same claim one level up — "2 of 2 reachable" while nothing is
    // being read is the identical lie. `info.upsTotal` stays: how many UPSes exist did not
    // change just because nobody is asking them.
    await this.adapter.setStateChangedAsync("info.upsReachable", { val: 0, ack: true });
    await this.adapter.setStateChangedAsync("info.allUpsReachable", { val: false, ack: true });
  }

  /**
   * Write the fleet summary: how many UPS devices the NUT server reports and how many of them
   * answered this poll. `allUpsReachable` is the one line an automation can watch instead of
   * checking every device — deliberately false while nothing was found at all, because "0 of 0"
   * is not "everything is fine".
   *
   * The three states are static instance objects, so they exist from installation on and need
   * no create-on-first-write.
   *
   * @param total UPS devices currently discovered on the NUT server
   * @param reachable How many of them answered this poll
   */
  async writeUpsSummary(total: number, reachable: number): Promise<void> {
    await this.adapter.setStateChangedAsync("info.upsTotal", { val: total, ack: true });
    await this.adapter.setStateChangedAsync("info.upsReachable", { val: reachable, ack: true });
    await this.adapter.setStateChangedAsync("info.allUpsReachable", {
      val: total > 0 && reachable === total,
      ack: true,
    });
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
      this.dropCacheUnder(deviceId);
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

      // Adapter-owned roots that are NOT UPS devices: the info channel and the notify trigger
      // state. Without the exemption the orphan sweep would eat them on every discover.
      if (topLevel === "info" || topLevel === "notify") {
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
      // The v0.1.0 id is the SAME datapoint under an older scheme (ups0.battery.charge.low →
      // ups0.battery.charge-low), so this is a move, not a removal: the user's recording goes
      // with it. Only a leaf carries one; a parent that merely holds children has none.
      const parts = id.split(".");
      const successor = `${parts[0]}.${parts[1]}.${parts.slice(2).join("-")}`;
      await this.carryRecordingFrom(adapterObjects[`${this.adapter.namespace}.${id}`], successor);
      this.adapter.log.debug(`Removing v0.1.0 dot-style object: ${id}`);
      await this.adapter.delObjectAsync(id);
      this.createdIds.delete(id);
    }
  }

  private async cleanupDeprecatedInfoStates(upsName: string): Promise<void> {
    // Once per runtime per UPS — these states are gone after the first connect, so re-running
    // the delObject calls on every reconnect is wasted work. Cache-keyed like the name fallback;
    // cleared together with the device in cleanupRemovedUps, so a re-added UPS cleans up again.
    const cacheKey = `${upsName}.__deprecatedCleanup`;
    if (this.createdIds.has(cacheKey)) {
      return;
    }
    this.createdIds.add(cacheKey);
    // Two of these are RENAMES — the datapoint lives on under a new id, so the user's
    // recording moves with it before the old object goes (the successors already exist:
    // ensureUpsDevice creates info.reachable above, the status flags come with the first poll).
    const renamed: Record<string, string> = {
      // 0.4.0: the old `online` leaf collided with the status.online / OL flag.
      [`${upsName}.info.online`]: `${upsName}.info.reachable`,
      // 0.6.0: the non-standard flag name was replaced by the real ECO token.
      [`${upsName}.status.highEfficiency`]: `${upsName}.status.ecoMode`,
    };
    // Dropped for good — not real NUT status_set tokens (COMM/NOCOMM), or never a datapoint of
    // ours. NB: `testing` is NOT here — TEST is a real token (apc_modbus, powercom, …) and is a
    // current flag again. Without the delete the old state lingers frozen at its last value —
    // ioBroker does not auto-remove states an adapter stops writing.
    const dropped = [
      `${upsName}.info.name`,
      `${upsName}.info.description`,
      `${upsName}.status.commEstablished`,
      `${upsName}.status.commLost`,
    ];
    for (const id of [...Object.keys(renamed), ...dropped]) {
      try {
        const successor = renamed[id];
        if (successor) {
          await this.carryRecording(id, successor);
        }
        await this.adapter.delObjectAsync(id);
        this.adapter.log.debug(`Removed deprecated state: ${id}`);
      } catch {
        // Object doesn't exist — nothing to clean up
      }
    }
  }

  /**
   * Remove every cached memory of a UPS whose objects have just been deleted.
   *
   * ALL of them, not only the object-id caches: a UPS can come back within the same runtime since
   * design #25 (the poll re-reads LIST UPS, so a device added or removed on the NUT server appears
   * or disappears without a reconnect). A leftover `fallbackNames` entry then makes
   * `updateDeviceName` believe it already wrote that name — the re-created device keeps the bare
   * UPS name and never gets "manufacturer + model" back until the adapter restarts. The other two
   * are the same class, one step smaller: a stale `pendingRecording` entry would hand a dead
   * predecessor's recording to a fresh state, and a stale `warnedGarbageVars` entry would swallow
   * the first garbage-value warning of the returning UPS.
   *
   * @param prefix UPS object-ID segment whose cached state is dropped
   */
  private dropCacheUnder(prefix: string): void {
    const under = (id: string): boolean => id === prefix || id.startsWith(`${prefix}.`);
    for (const id of [...this.createdIds]) {
      if (under(id)) {
        this.createdIds.delete(id);
      }
    }
    for (const id of [...this.nutNames.keys()]) {
      if (under(id)) {
        this.nutNames.delete(id);
      }
    }
    for (const id of [...this.pendingRecording.keys()]) {
      if (under(id)) {
        this.pendingRecording.delete(id);
      }
    }
    for (const key of [...this.warnedGarbageVars]) {
      if (under(key)) {
        this.warnedGarbageVars.delete(key);
      }
    }
    this.fallbackNames.delete(prefix);
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
    // extendObject, not setObjectNotExists: a channel created by an older version keeps whatever
    // name that version wrote, and "create if missing" would never correct it — the adapter owns
    // the name (design #31), so it has to reach EXISTING trees too. Once per runtime per id
    // (createdIds), so a steady poll costs no extra write.
    await this.adapter.extendObject(id, {
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
      /** Short explanation; omitted where the name already says everything. */
      desc?: LocalizedName;
      unit?: string;
      def?: boolean;
      states?: Record<string, string>;
    },
  ): Promise<void> {
    if (this.createdIds.has(id)) {
      return;
    }
    // A value list can SHRINK between adapter versions or driver updates. extendObject merges
    // key by key, so a dropped entry would linger in the dropdown and stay writable — clear it
    // first, then write the fresh list (two merges, never a delete).
    if (common.states !== undefined) {
      await this.clearStatesBeforeWrite(id);
    }
    await this.adapter.extendObject(id, {
      type: "state",
      common,
      native: {},
    });
    this.createdIds.add(id);
    await this.applyCarriedRecording(id);
  }

  /**
   * Empty `common.states` on an EXISTING object, so the fresh list that follows replaces it
   * instead of merging into it (js-controller merges key by key; `null` overwrites).
   *
   * @param id State object id
   */
  private async clearStatesBeforeWrite(id: string): Promise<void> {
    const existing = await this.adapter.getObjectAsync(id);
    const common = existing?.common as { states?: unknown } | undefined;
    if (common?.states === undefined || common.states === null) {
      return;
    }
    await this.adapter.extendObject(id, { common: { states: null } });
  }

  /**
   * Move a recording configuration from a renamed predecessor onto the state that replaces it.
   * The adapter owns the datapoint, the user owns the recording — a rename by the adapter must
   * not cost the user their charts.
   *
   * @param fromId The id that is about to disappear
   * @param toId The id that continues the datapoint (may not exist yet)
   */
  private async carryRecording(fromId: string, toId: string): Promise<void> {
    const old = await this.adapter.getObjectAsync(fromId);
    await this.carryRecordingFrom(old, toId);
  }

  /**
   * Same as {@link carryRecording}, for a predecessor already read from the object store.
   *
   * @param old The predecessor object (or null/undefined)
   * @param toId The id that continues the datapoint (may not exist yet)
   */
  private async carryRecordingFrom(old: ioBroker.Object | null | undefined, toId: string): Promise<void> {
    const custom = (old?.common as { custom?: Record<string, unknown> } | undefined)?.custom;
    if (!custom || Object.keys(custom).length === 0) {
      return;
    }
    const target = await this.adapter.getObjectAsync(toId);
    if (!target) {
      // The successor is created later in this run (the first poll builds the variable states)
      // — hand it over then, the predecessor is gone by that point.
      this.pendingRecording.set(toId, custom);
      return;
    }
    await this.adapter.extendObject(toId, { common: { custom } });
    this.adapter.log.info(`Kept the recording settings of the renamed datapoint on ${toId}`);
  }

  /**
   * Apply a recording configuration held back for a state that did not exist yet.
   *
   * @param id The state that has just been created
   */
  private async applyCarriedRecording(id: string): Promise<void> {
    const custom = this.pendingRecording.get(id);
    if (!custom) {
      return;
    }
    this.pendingRecording.delete(id);
    await this.adapter.extendObject(id, { common: { custom } });
    this.adapter.log.info(`Kept the recording settings of the renamed datapoint on ${id}`);
  }

  /**
   * Ensure a state exists (once) and write its current value — the create-then-set pair used for
   * every status/flag datapoint.
   *
   * @param id State id
   * @param common Object definition forwarded to ensureState
   * @param val Value to write (acknowledged)
   */
  private async ensureAndSet(
    id: string,
    common: Parameters<StateManager["ensureState"]>[1],
    val: ioBroker.StateValue,
  ): Promise<void> {
    await this.ensureState(id, common);
    await this.adapter.setStateChangedAsync(id, { val, ack: true });
  }

  /**
   * Enrich an existing state with ENUM/RANGE metadata from the NUT server.
   * Uses extendObject to deep-merge — overwrites only the provided keys.
   *
   * The value labels are translated HERE, not at the call site: a LIST ENUM answer arrives as raw
   * NUT tokens, and this write lands AFTER `updateVariables` has already put the localized catalog
   * labels on the same object — so an untranslated list would quietly undo design #35 for exactly
   * the writable enum datapoints. Translating inside means a future third caller cannot reintroduce
   * that; the values themselves stay the NUT tokens, only their labels follow the system language.
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
      common.states = localizeStates(patch.states);
    }
    if (patch.min !== undefined) {
      common.min = patch.min;
    }
    if (patch.max !== undefined) {
      common.max = patch.max;
    }
    if (Object.keys(common).length > 0) {
      if (patch.states) {
        await this.clearStatesBeforeWrite(id);
      }
      await this.adapter.extendObject(id, { common });
    }
  }
}
