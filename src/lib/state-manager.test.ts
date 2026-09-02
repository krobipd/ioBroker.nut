import { vi } from "vitest";

vi.mock("@iobroker/adapter-core", () => ({
  I18n: {
    getTranslatedObject: vi.fn((key: string) => ({ en: key, de: `${key}_de` })),
  },
}));

import { StateManager, nutVarToStateId, nutVarToReadableName, sanitizeUpsName } from "./state-manager";

// ---------------------------------------------------------------------------
// Mock adapter
// ---------------------------------------------------------------------------

interface MockObj {
  type: string;
  common: Record<string, unknown>;
  native: Record<string, unknown>;
}

interface MockState {
  val: unknown;
  ack: boolean;
}

function createMockAdapter(): {
  adapter: any;
  objects: Map<string, MockObj>;
  states: Map<string, MockState>;
  deletedIds: string[];
  logs: string[];
} {
  const objects = new Map<string, MockObj>();
  const states = new Map<string, MockState>();
  const deletedIds: string[] = [];
  const logs: string[] = [];

  const adapter = {
    namespace: "nut2.0",
    log: {
      info: (msg: string) => logs.push(`INFO: ${msg}`),
      debug: (msg: string) => logs.push(`DEBUG: ${msg}`),
      warn: (msg: string) => logs.push(`WARN: ${msg}`),
      error: (msg: string) => logs.push(`ERROR: ${msg}`),
    },
    setObjectNotExistsAsync: (id: string, obj: MockObj) => {
      if (!objects.has(id)) {
        objects.set(id, obj);
      }
      return Promise.resolve();
    },
    getObjectAsync: (id: string) => Promise.resolve(objects.get(id) ?? null),
    // Mirrors the REAL js-controller preserve semantics (7.0.7
    // removePreservedProperties): a preserved attribute that exists on the OLD
    // object wins — the new value is dropped. The earlier mock merged
    // unconditionally and thereby hid that the mfr+model name fallback never
    // applied in production (v0.2.5-v0.4.1).
    extendObject: (id: string, obj: MockObj, options?: { preserve?: { common?: string[] } }) => {
      const existing = objects.get(id);
      if (!existing) {
        objects.set(id, obj);
        return Promise.resolve();
      }
      const newCommon = { ...obj.common };
      for (const prop of options?.preserve?.common ?? []) {
        if (existing.common?.[prop] !== undefined && newCommon[prop] !== undefined) {
          delete newCommon[prop];
        }
      }
      existing.common = { ...existing.common, ...newCommon };
      return Promise.resolve();
    },
    setState: (id: string, state: MockState) => {
      states.set(id, state);
      return Promise.resolve();
    },
    setStateChangedAsync: (id: string, state: MockState) => {
      states.set(id, state);
      return Promise.resolve();
    },
    getAdapterObjectsAsync: () => {
      const result: Record<string, MockObj> = {};
      for (const [id, obj] of objects) {
        result[`nut2.0.${id}`] = obj;
      }
      return Promise.resolve(result);
    },
    delObjectAsync: (id: string, _opts?: { recursive?: boolean }) => {
      deletedIds.push(id);
      for (const key of objects.keys()) {
        if (key === id || key.startsWith(`${id}.`)) {
          objects.delete(key);
        }
      }
      return Promise.resolve();
    },
  };

  return { adapter, objects, states, deletedIds, logs };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("StateManager", () => {
  // -----------------------------------------------------------------------
  // Device creation
  // -----------------------------------------------------------------------
  describe("ensureUpsDevice", () => {
    it("should create device object", async () => {
      const { adapter, objects } = createMockAdapter();
      const sm = new StateManager(adapter);

      await sm.ensureUpsDevice("ups0", "Main UPS");

      expect(objects.has("ups0")).toBe(true);
      expect(objects.get("ups0")?.type).toBe("device");
    });

    it("should create info channel and info.reachable but not info.name or info.description", async () => {
      const { adapter, objects } = createMockAdapter();
      const sm = new StateManager(adapter);

      await sm.ensureUpsDevice("ups0", "Main UPS");

      expect(objects.has("ups0.info")).toBe(true);
      expect(objects.get("ups0.info")?.type).toBe("channel");
      expect(objects.has("ups0.info.reachable")).toBe(true);
      expect(objects.get("ups0.info.reachable")?.common.role).toBe("indicator.reachable");
      expect(objects.has("ups0.info.name")).toBe(false);
      expect(objects.has("ups0.info.description")).toBe(false);
    });

    it("should set statusStates.onlineId on device object", async () => {
      const { adapter, objects } = createMockAdapter();
      const sm = new StateManager(adapter);

      await sm.ensureUpsDevice("ups0", "Main UPS");

      const common = objects.get("ups0")?.common as any;
      expect(common?.statusStates?.onlineId).toBe("nut2.0.ups0.info.reachable");
    });

    it("preserves the existing device name on re-discover (user names win — mcm1957 line)", async () => {
      const { adapter, objects } = createMockAdapter();
      const sm = new StateManager(adapter);

      await sm.ensureUpsDevice("ups0", "Main UPS");
      // The user may have renamed the device meanwhile; preserve keeps whatever
      // name the object carries — a changed LIST UPS description does NOT win.
      await sm.ensureUpsDevice("ups0", "Updated UPS");

      expect(objects.get("ups0")?.common.name).toBe("Main UPS");
    });

    it("should create multiple devices", async () => {
      const { adapter, objects } = createMockAdapter();
      const sm = new StateManager(adapter);

      await sm.ensureUpsDevice("ups0", "Main UPS");
      await sm.ensureUpsDevice("ups1", "Backup UPS");

      expect(objects.has("ups0")).toBe(true);
      expect(objects.has("ups1")).toBe(true);
    });

    it("creates the per-UPS last-event state under the adapter-owned info channel", async () => {
      // Under info, not directly under the device: a NUT server is free to expose a
      // variable of any name, and a dotless var lands directly under the device —
      // the info channel is the only namespace NUT can never write into.
      const { adapter, objects } = createMockAdapter();
      const sm = new StateManager(adapter);

      await sm.ensureUpsDevice("ups0", "Main UPS");

      const notify = objects.get("ups0.info.notify");
      expect(notify?.type).toBe("state");
      expect(notify?.common.role).toBe("text");
      expect(notify?.common.type).toBe("string");
      expect(notify?.common.write).toBe(false);
      expect(notify?.common.read).toBe(true);
    });
  });

  // -----------------------------------------------------------------------
  // Device name fallback
  // -----------------------------------------------------------------------
  describe("updateDeviceName", () => {
    it("should not update name when description is usable", async () => {
      const { adapter, objects } = createMockAdapter();
      const sm = new StateManager(adapter);

      await sm.ensureUpsDevice("ups0", "My Custom UPS");
      await sm.updateDeviceName("ups0", "My Custom UPS", [
        { name: "device.mfr", value: "EATON" },
        { name: "device.model", value: "Ellipse PRO 1600" },
      ]);

      expect(objects.get("ups0")?.common.name).toBe("My Custom UPS");
    });

    it("should update name from mfr+model when description is unavailable", async () => {
      const { adapter, objects } = createMockAdapter();
      const sm = new StateManager(adapter);

      await sm.ensureUpsDevice("ups0", "Description unavailable");
      await sm.updateDeviceName("ups0", "Description unavailable", [
        { name: "device.mfr", value: "EATON" },
        { name: "device.model", value: "Ellipse PRO 1600 " },
      ]);

      expect(objects.get("ups0")?.common.name).toBe("EATON Ellipse PRO 1600");
    });

    it("should trim trailing spaces from model", async () => {
      const { adapter, objects } = createMockAdapter();
      const sm = new StateManager(adapter);

      await sm.ensureUpsDevice("ups0", "Description unavailable");
      await sm.updateDeviceName("ups0", "Description unavailable", [
        { name: "device.mfr", value: "EATON" },
        { name: "device.model", value: "  PRO 1600  " },
      ]);

      expect(objects.get("ups0")?.common.name).toBe("EATON PRO 1600");
    });

    it("should use only model when mfr is missing", async () => {
      const { adapter, objects } = createMockAdapter();
      const sm = new StateManager(adapter);

      await sm.ensureUpsDevice("ups0", "Description unavailable");
      await sm.updateDeviceName("ups0", "Description unavailable", [{ name: "device.model", value: "Smart-UPS 1500" }]);

      expect(objects.get("ups0")?.common.name).toBe("Smart-UPS 1500");
    });

    it("should update name when description is empty", async () => {
      const { adapter, objects } = createMockAdapter();
      const sm = new StateManager(adapter);

      await sm.ensureUpsDevice("ups0", "");
      await sm.updateDeviceName("ups0", "", [
        { name: "device.mfr", value: "APC" },
        { name: "device.model", value: "Back-UPS 600" },
      ]);

      expect(objects.get("ups0")?.common.name).toBe("APC Back-UPS 600");
    });

    it("should not update if neither mfr nor model available", async () => {
      const { adapter, objects } = createMockAdapter();
      const sm = new StateManager(adapter);

      await sm.ensureUpsDevice("ups0", "Description unavailable");
      await sm.updateDeviceName("ups0", "Description unavailable", [{ name: "battery.charge", value: "100" }]);

      expect(objects.get("ups0")?.common.name).toBe("Description unavailable");
    });

    it("does NOT overwrite a user-modified device name (fallback only replaces the auto-set value)", async () => {
      const { adapter, objects } = createMockAdapter();
      const sm = new StateManager(adapter);

      await sm.ensureUpsDevice("ups0", "Description unavailable");
      // User renamed the device in the admin meanwhile.
      objects.get("ups0")!.common.name = "Keller-USV";

      await sm.updateDeviceName("ups0", "Description unavailable", [
        { name: "device.mfr", value: "EATON" },
        { name: "device.model", value: "PRO 1600" },
      ]);

      expect(objects.get("ups0")?.common.name).toBe("Keller-USV");
    });

    it("runs the broker round-trip only once per runtime, not on every poll (v0.4.2)", async () => {
      const { adapter } = createMockAdapter();
      let getCalls = 0;
      const origGet = adapter.getObjectAsync;
      adapter.getObjectAsync = (...args: any[]) => {
        getCalls++;
        return Promise.resolve(origGet(...args));
      };
      let extendCalls = 0;
      const origExtend = adapter.extendObject;
      adapter.extendObject = (...args: any[]) => {
        extendCalls++;
        return Promise.resolve(origExtend(...args));
      };
      const sm = new StateManager(adapter);

      await sm.ensureUpsDevice("ups0", "Description unavailable");
      const baselineExtend = extendCalls;
      const vars = [
        { name: "device.mfr", value: "EATON" },
        { name: "device.model", value: "PRO 1600" },
      ];
      await sm.updateDeviceName("ups0", "Description unavailable", vars);
      await sm.updateDeviceName("ups0", "Description unavailable", vars);
      await sm.updateDeviceName("ups0", "Description unavailable", vars);

      expect(getCalls).toBe(1);
      expect(extendCalls).toBe(baselineExtend + 1);
    });

    it("self-corrects the name when mfr/model change after first discovery (#5)", async () => {
      const { adapter, objects } = createMockAdapter();
      const sm = new StateManager(adapter);
      await sm.ensureUpsDevice("ups0", "Description unavailable");

      // first discovery: a transient/placeholder mfr+model arrives
      await sm.updateDeviceName("ups0", "Description unavailable", [
        { name: "device.mfr", value: "Dummy Manufacturer" },
        { name: "device.model", value: "Dummy UPS" },
      ]);
      expect(objects.get("ups0")?.common.name).toBe("Dummy Manufacturer Dummy UPS");

      // later poll: the real values arrive → name self-corrects (no freeze)
      await sm.updateDeviceName("ups0", "Description unavailable", [
        { name: "device.mfr", value: "Eaton" },
        { name: "device.model", value: "5PX 1500" },
      ]);
      expect(objects.get("ups0")?.common.name).toBe("Eaton 5PX 1500");
    });
  });

  // -----------------------------------------------------------------------
  // Channel creation
  // -----------------------------------------------------------------------
  describe("ensureChannel", () => {
    it("should create channel with i18n name", async () => {
      const { adapter, objects } = createMockAdapter();
      const sm = new StateManager(adapter);

      await sm.ensureChannel("ups0", "battery");

      expect(objects.has("ups0.battery")).toBe(true);
      expect(objects.get("ups0.battery")?.type).toBe("channel");
      const name = objects.get("ups0.battery")?.common.name;
      expect(typeof name).toBe("object");
      expect(name).toHaveProperty("en");
      expect(name).toHaveProperty("de");
    });

    it("should use plain name for unknown channels", async () => {
      const { adapter, objects } = createMockAdapter();
      const sm = new StateManager(adapter);

      await sm.ensureChannel("ups0", "custom");

      expect(objects.get("ups0.custom")?.common.name).toBe("custom");
    });

    it("should create all standard NUT channels", async () => {
      const { adapter, objects } = createMockAdapter();
      const sm = new StateManager(adapter);

      const channels = ["battery", "device", "driver", "input", "output", "ups", "outlet", "ambient"];
      for (const ch of channels) {
        await sm.ensureChannel("ups0", ch);
      }

      expect(objects.size).toBe(channels.length);
    });
  });

  // -----------------------------------------------------------------------
  // Variable updates
  // -----------------------------------------------------------------------
  describe("updateVariables", () => {
    it("should create states for variables with dots→dashes", async () => {
      const { adapter, objects, states } = createMockAdapter();
      const sm = new StateManager(adapter);

      await sm.updateVariables(
        "ups0",
        [
          { name: "battery.charge", value: "100" },
          { name: "ups.status", value: "OL" },
        ],
        new Set(),
      );

      expect(objects.has("ups0.battery.charge")).toBe(true);
      expect(states.get("ups0.battery.charge")?.val).toBe(100);
      expect(states.get("ups0.ups.status")?.val).toBe("OL");
    });

    it("discards garbage in a numeric field and warns exactly once", async () => {
      const { adapter, states, logs } = createMockAdapter();
      const sm = new StateManager(adapter);

      // battery.charge carries a unit → it is expected numeric. Storing
      // "Infinity" would flip the datapoint's type and every consumer reading
      // it (charts, scripts) gets a value it cannot use.
      await sm.updateVariables("ups0", [{ name: "battery.charge", value: "Infinity" }], new Set());
      expect(states.has("ups0.battery.charge")).toBe(false);
      const warns = (): string[] => logs.filter(l => l.startsWith("WARN:") && l.includes("Discarding non-numeric"));
      expect(warns()).toHaveLength(1);

      // Second poll with the same garbage: dropped again, but no second warn —
      // a UPS that reports junk every 15 s must not flood the log.
      await sm.updateVariables("ups0", [{ name: "battery.charge", value: "12abc" }], new Set());
      expect(states.has("ups0.battery.charge")).toBe(false);
      expect(warns()).toHaveLength(1);

      // A good value afterwards still lands.
      await sm.updateVariables("ups0", [{ name: "battery.charge", value: "77" }], new Set());
      expect(states.get("ups0.battery.charge")?.val).toBe(77);
    });

    it("should create channels automatically", async () => {
      const { adapter, objects } = createMockAdapter();
      const sm = new StateManager(adapter);

      await sm.updateVariables("ups0", [{ name: "battery.charge", value: "100" }], new Set());

      expect(objects.has("ups0.battery")).toBe(true);
    });

    it("should set write:true for writable variables", async () => {
      const { adapter, objects } = createMockAdapter();
      const sm = new StateManager(adapter);

      await sm.updateVariables("ups0", [{ name: "ups.delay.shutdown", value: "20" }], new Set(["ups.delay.shutdown"]));

      const common = objects.get("ups0.ups.delay-shutdown")?.common;
      expect(common?.write).toBe(true);
    });

    it("should detect correct types", async () => {
      const { adapter, states } = createMockAdapter();
      const sm = new StateManager(adapter);

      await sm.updateVariables(
        "ups0",
        [
          { name: "battery.charge", value: "100" },
          { name: "device.mfr", value: "EATON" },
          { name: "input.voltage", value: "221.0" },
        ],
        new Set(),
      );

      expect(states.get("ups0.battery.charge")?.val).toBe(100);
      expect(states.get("ups0.device.mfr")?.val).toBe("EATON");
      expect(states.get("ups0.input.voltage")?.val).toBe(221.0);
    });

    it("should process shallow variables before deep ones", async () => {
      const { adapter, objects } = createMockAdapter();
      const sm = new StateManager(adapter);

      await sm.updateVariables(
        "ups0",
        [
          { name: "battery.charge.low", value: "15" },
          { name: "battery.charge", value: "100" },
        ],
        new Set(),
      );

      const keys = [...objects.keys()];
      const chargeIdx = keys.indexOf("ups0.battery.charge");
      const chargeLowIdx = keys.indexOf("ups0.battery.charge-low");
      expect(chargeIdx).toBeLessThan(chargeLowIdx);
    });

    it("should use readable names for state objects", async () => {
      const { adapter, objects } = createMockAdapter();
      const sm = new StateManager(adapter);

      await sm.updateVariables("ups0", [{ name: "battery.charge.low", value: "15" }], new Set());

      const common = objects.get("ups0.battery.charge-low")?.common;
      expect(common?.name).toHaveProperty("en");
      expect(common?.name).toHaveProperty("de");
    });
  });

  // -----------------------------------------------------------------------
  // Role migration on update — a changed role must reach existing objects
  // -----------------------------------------------------------------------
  describe("role migration on update", () => {
    it("should overwrite an existing state's generic role on the next poll (value → value.frequency)", async () => {
      const { adapter, objects } = createMockAdapter();
      // Seed the object as an older adapter version created it: generic value role.
      objects.set("ups0.input.frequency", {
        type: "state",
        common: { type: "number", role: "value", name: "Frequency", unit: "Hz", read: true, write: false },
        native: {},
      });
      const sm = new StateManager(adapter);

      await sm.updateVariables("ups0", [{ name: "input.frequency", value: "50.0" }], new Set());

      expect(objects.get("ups0.input.frequency")?.common.role).toBe("value.frequency");
    });
  });

  // -----------------------------------------------------------------------
  // Status flags
  // -----------------------------------------------------------------------
  describe("updateStatusFlags", () => {
    it("should create status channel and states", async () => {
      const { adapter, objects, states } = createMockAdapter();
      const sm = new StateManager(adapter);

      await sm.updateStatusFlags("ups0", "OL");

      expect(objects.has("ups0.status")).toBe(true);
      expect(states.get("ups0.status.raw")?.val).toBe("OL");
      expect(states.get("ups0.status.severity")?.val).toBe(0);
      expect(states.get("ups0.status.online")?.val).toBe(true);
      expect(states.get("ups0.status.onBattery")?.val).toBe(false);
    });

    it("should update all flags on OL CHRG", async () => {
      const { adapter, states } = createMockAdapter();
      const sm = new StateManager(adapter);

      await sm.updateStatusFlags("ups0", "OL CHRG");

      expect(states.get("ups0.status.online")?.val).toBe(true);
      expect(states.get("ups0.status.charging")?.val).toBe(true);
      expect(states.get("ups0.status.onBattery")?.val).toBe(false);
    });

    it("should set severity 3 for OB LB", async () => {
      const { adapter, states } = createMockAdapter();
      const sm = new StateManager(adapter);

      await sm.updateStatusFlags("ups0", "OB LB");

      expect(states.get("ups0.status.severity")?.val).toBe(3);
    });

    it("should assign role value.severity to the severity state", async () => {
      const { adapter, objects } = createMockAdapter();
      const sm = new StateManager(adapter);

      await sm.updateStatusFlags("ups0", "OL");

      expect(objects.get("ups0.status.severity")?.common.role).toBe("value.severity");
    });

    it("should create boolean states for all known flags", async () => {
      const { adapter, objects } = createMockAdapter();
      const sm = new StateManager(adapter);

      await sm.updateStatusFlags("ups0", "OL");

      for (const key of ["online", "onBattery", "lowBattery", "charging", "forcedShutdown"]) {
        expect(objects.has(`ups0.status.${key}`)).toBe(true);
      }
    });
  });

  // -----------------------------------------------------------------------
  // Command buttons
  // -----------------------------------------------------------------------
  describe("nutNameForState", () => {
    it("stores the original NUT name so a dash-context var id reverses losslessly", async () => {
      const { adapter } = createMockAdapter();
      const sm = new StateManager(adapter);
      await sm.updateVariables(
        "ups0",
        [{ name: "input.L1-L2.voltage", value: "398.3" }],
        new Set(["input.L1-L2.voltage"]),
      );
      expect(sm.nutNameForState("ups0.input.L1-L2-voltage")).toBe("input.L1-L2.voltage");
      expect(sm.nutNameForState("ups0.does.not-exist")).toBeUndefined();
    });
  });

  describe("three-phase / multi-sensor name translation (DP-7)", () => {
    it("collapses a single-phase L-context var to the translated base name", async () => {
      const { adapter, objects } = createMockAdapter();
      const sm = new StateManager(adapter);
      await sm.updateVariables("ups0", [{ name: "input.L1.voltage", value: "230" }], new Set());
      expect(objects.get("ups0.input.L1-voltage")?.common.name).toEqual({
        en: "input.voltage",
        de: "input.voltage_de",
      });
    });

    it("collapses a line-to-line phase pair to the translated base name", async () => {
      const { adapter, objects } = createMockAdapter();
      const sm = new StateManager(adapter);
      await sm.updateVariables("ups0", [{ name: "input.L1-L2.voltage", value: "398" }], new Set());
      expect(objects.get("ups0.input.L1-L2-voltage")?.common.name).toEqual({
        en: "input.voltage",
        de: "input.voltage_de",
      });
    });
  });

  describe("createCommandButtons", () => {
    it("should create button states with dots→dashes and readable names", async () => {
      const { adapter, objects } = createMockAdapter();
      const sm = new StateManager(adapter);

      await sm.createCommandButtons("ups0", [{ name: "beeper.enable" }, { name: "load.off" }]);

      expect(objects.has("ups0.commands")).toBe(true);
      expect(objects.has("ups0.commands.beeper-enable")).toBe(true);
      expect(objects.has("ups0.commands.load-off")).toBe(true);

      const common = objects.get("ups0.commands.beeper-enable")?.common;
      expect(common?.role).toBe("button");
      expect(common?.write).toBe(true);
      expect(common?.read).toBe(false);
      expect(common?.name).toHaveProperty("en");
      expect(common?.name).toHaveProperty("de");
    });
  });

  // -----------------------------------------------------------------------
  // Cleanup
  // -----------------------------------------------------------------------
  describe("cleanupRemovedUps", () => {
    it("should remove devices not in current set", async () => {
      const { adapter, deletedIds } = createMockAdapter();
      const sm = new StateManager(adapter);

      await sm.ensureUpsDevice("ups0", "Main");
      await sm.ensureUpsDevice("ups1", "Backup");

      await sm.cleanupRemovedUps(new Set(["ups0"]));

      expect(deletedIds).toContain("ups1");
      expect(deletedIds).not.toContain("ups0");
    });

    it("should not delete anything if all UPS are current", async () => {
      const { adapter, deletedIds } = createMockAdapter();
      const sm = new StateManager(adapter);

      await sm.ensureUpsDevice("ups0", "Main");
      deletedIds.length = 0;

      await sm.cleanupRemovedUps(new Set(["ups0"]));

      expect(deletedIds).toHaveLength(0);
    });

    it("should clear createdIds cache for removed devices", async () => {
      const { adapter, objects } = createMockAdapter();
      const sm = new StateManager(adapter);

      await sm.ensureUpsDevice("ups0", "Main");
      await sm.cleanupRemovedUps(new Set());

      // After cleanup, re-creating should work (not cached)
      objects.clear();
      await sm.ensureUpsDevice("ups0", "Re-created");
      expect(objects.has("ups0")).toBe(true);
    });

    it("should log removal", async () => {
      const { adapter, logs } = createMockAdapter();
      const sm = new StateManager(adapter);

      await sm.ensureUpsDevice("ups0", "Main");
      await sm.cleanupRemovedUps(new Set());

      expect(logs.some(l => l.includes("Removing stale UPS device: ups0"))).toBe(true);
    });
  });

  // -----------------------------------------------------------------------
  // createdIds cache
  // -----------------------------------------------------------------------
  describe("createdIds cache", () => {
    it("should not call setObjectNotExistsAsync twice for same id", async () => {
      let callCount = 0;
      const { adapter } = createMockAdapter();
      const originalSetObj = adapter.setObjectNotExistsAsync;
      adapter.setObjectNotExistsAsync = (...args: any[]) => {
        callCount++;
        return Promise.resolve(originalSetObj(...args));
      };

      const sm = new StateManager(adapter);

      await sm.updateVariables("ups0", [{ name: "battery.charge", value: "100" }], new Set());

      const firstCount = callCount;

      await sm.updateVariables("ups0", [{ name: "battery.charge", value: "95" }], new Set());

      // Second call should skip object creation (cached)
      expect(callCount).toBe(firstCount);
    });
  });

  // -----------------------------------------------------------------------
  // Dot-path edge cases
  // -----------------------------------------------------------------------
  describe("dot-path handling", () => {
    it("should handle battery.charge and battery.charge.low with dash conversion", async () => {
      const { adapter, objects, states } = createMockAdapter();
      const sm = new StateManager(adapter);

      await sm.updateVariables(
        "ups0",
        [
          { name: "battery.charge", value: "100" },
          { name: "battery.charge.low", value: "15" },
        ],
        new Set(),
      );

      expect(objects.has("ups0.battery.charge")).toBe(true);
      expect(objects.has("ups0.battery.charge-low")).toBe(true);
      expect(states.get("ups0.battery.charge")?.val).toBe(100);
      expect(states.get("ups0.battery.charge-low")?.val).toBe(15);
    });

    it("should handle driver.version variants with dash conversion", async () => {
      const { adapter, objects, states } = createMockAdapter();
      const sm = new StateManager(adapter);

      await sm.updateVariables(
        "ups0",
        [
          { name: "driver.version", value: "2.8.0" },
          { name: "driver.version.data", value: "MGE HID 1.46" },
          { name: "driver.version.internal", value: "0.47" },
        ],
        new Set(),
      );

      expect(objects.has("ups0.driver.version")).toBe(true);
      expect(objects.has("ups0.driver.version-data")).toBe(true);
      expect(objects.has("ups0.driver.version-internal")).toBe(true);
      expect(states.get("ups0.driver.version")?.val).toBe("2.8.0");
    });

    it("should handle outlet paths with dash conversion", async () => {
      const { adapter, objects } = createMockAdapter();
      const sm = new StateManager(adapter);

      await sm.updateVariables(
        "ups0",
        [
          { name: "outlet.desc", value: "Main Outlet" },
          { name: "outlet.1.desc", value: "PowerShare 1" },
          { name: "outlet.1.status", value: "on" },
          { name: "outlet.2.desc", value: "PowerShare 2" },
        ],
        new Set(),
      );

      expect(objects.has("ups0.outlet.desc")).toBe(true);
      expect(objects.has("ups0.outlet.1-desc")).toBe(true);
      expect(objects.has("ups0.outlet.1-status")).toBe(true);
      expect(objects.has("ups0.outlet.2-desc")).toBe(true);
    });
  });

  // -----------------------------------------------------------------------
  // Full Eaton PRO 1600 scenario
  // -----------------------------------------------------------------------
  describe("Eaton PRO 1600 scenario", () => {
    it("processes the complete LIST VAR set of one sample device (Eaton PRO 1600, 54 variables)", async () => {
      const { adapter, objects, states } = createMockAdapter();
      const sm = new StateManager(adapter);

      // ONE real sample device — NOT the universe of NUT variables. This Eaton happens to
      // expose these 54; the adapter is dynamic and creates states for whatever a driver
      // reports. Variables this device does NOT have (three-phase, ambient/EMP sensors,
      // outlet groups, other vendors' vars) are covered by the next test. Captured live from
      // a real Eaton PRO 1600: battery 4, device 4, driver 10, input 5,
      // outlet 11, output 4, ups 16 = 54.
      const vars = [
        // battery (4)
        { name: "battery.charge", value: "100" },
        { name: "battery.charge.low", value: "15" },
        { name: "battery.runtime", value: "2050" },
        { name: "battery.type", value: "PbAc" },
        // device (4)
        { name: "device.mfr", value: "EATON" },
        { name: "device.model", value: "Ellipse PRO 1600 " },
        { name: "device.serial", value: "G364T29133" },
        { name: "device.type", value: "ups" },
        // driver (10)
        { name: "driver.flag.ignorelb", value: "enabled" },
        { name: "driver.name", value: "usbhid-ups" },
        { name: "driver.parameter.pollfreq", value: "30" },
        { name: "driver.parameter.pollinterval", value: "2" },
        { name: "driver.parameter.port", value: "auto" },
        { name: "driver.parameter.synchronous", value: "auto" },
        { name: "driver.version", value: "2.8.0" },
        { name: "driver.version.data", value: "MGE HID 1.46" },
        { name: "driver.version.internal", value: "0.47" },
        { name: "driver.version.usb", value: "libusb-1.0.26 (API: 0x1000109)" },
        // input (5)
        { name: "input.frequency", value: "50.0" },
        { name: "input.transfer.high", value: "285" },
        { name: "input.transfer.low", value: "165" },
        { name: "input.voltage", value: "221.0" },
        { name: "input.voltage.extended", value: "no" },
        // outlet (11)
        { name: "outlet.desc", value: "Main Outlet" },
        { name: "outlet.id", value: "1" },
        { name: "outlet.switchable", value: "no" },
        { name: "outlet.1.desc", value: "PowerShare Outlet 1" },
        { name: "outlet.1.id", value: "2" },
        { name: "outlet.1.status", value: "on" },
        { name: "outlet.1.switchable", value: "no" },
        { name: "outlet.2.desc", value: "PowerShare Outlet 2" },
        { name: "outlet.2.id", value: "3" },
        { name: "outlet.2.status", value: "on" },
        { name: "outlet.2.switchable", value: "no" },
        // output (4)
        { name: "output.frequency", value: "50.0" },
        { name: "output.frequency.nominal", value: "50" },
        { name: "output.voltage", value: "223.0" },
        { name: "output.voltage.nominal", value: "230" },
        // ups (16)
        { name: "ups.beeper.status", value: "enabled" },
        { name: "ups.delay.shutdown", value: "20" },
        { name: "ups.delay.start", value: "30" },
        { name: "ups.firmware", value: "01.18.0022" },
        { name: "ups.load", value: "15" },
        { name: "ups.mfr", value: "EATON" },
        { name: "ups.model", value: "Ellipse PRO 1600 " },
        { name: "ups.power", value: "159" },
        { name: "ups.power.nominal", value: "1600" },
        { name: "ups.productid", value: "ffff" },
        { name: "ups.realpower", value: "147" },
        { name: "ups.serial", value: "G364T29133" },
        { name: "ups.status", value: "OL" },
        { name: "ups.timer.shutdown", value: "-1" },
        { name: "ups.timer.start", value: "-1" },
        { name: "ups.vendorid", value: "0463" },
      ];
      expect(vars).toHaveLength(54);

      // The 9 writable variables (LIST RW ups0).
      const rw = new Set([
        "input.transfer.high",
        "input.transfer.low",
        "input.voltage.extended",
        "outlet.1.desc",
        "outlet.2.desc",
        "outlet.desc",
        "output.voltage.nominal",
        "ups.delay.shutdown",
        "ups.delay.start",
      ]);
      await sm.updateVariables("ups0", vars, rw);

      // A state object exists for every one of the 54 variables (distinct ids).
      expect([...objects.values()].filter(o => o.type === "state")).toHaveLength(54);

      // Numbers (dots→dashes after the channel), incl. negative + nominal
      expect(states.get("ups0.battery.charge")?.val).toBe(100);
      expect(states.get("ups0.battery.runtime")?.val).toBe(2050);
      expect(states.get("ups0.battery.charge-low")?.val).toBe(15);
      expect(states.get("ups0.input.voltage")?.val).toBe(221.0);
      expect(states.get("ups0.ups.realpower")?.val).toBe(147);
      expect(states.get("ups0.ups.timer-shutdown")?.val).toBe(-1);
      expect(states.get("ups0.output.frequency-nominal")?.val).toBe(50);

      // Strings — trailing space, leading zeros, hex-looking id, known-string suffix/prefix
      expect(states.get("ups0.battery.type")?.val).toBe("PbAc");
      expect(states.get("ups0.device.model")?.val).toBe("Ellipse PRO 1600 ");
      expect(states.get("ups0.ups.status")?.val).toBe("OL");
      expect(states.get("ups0.ups.vendorid")?.val).toBe("0463");
      expect(states.get("ups0.ups.productid")?.val).toBe("ffff");
      expect(states.get("ups0.outlet.1-status")?.val).toBe("on");

      // Booleans — yes/no fields become real boolean states, not text.
      expect(states.get("ups0.input.voltage-extended")?.val).toBe(false);

      // Writable variable carries write:true
      expect(objects.get("ups0.ups.delay-shutdown")?.common.write).toBe(true);

      // All seven NUT channels created
      for (const ch of ["battery", "device", "driver", "input", "outlet", "output", "ups"]) {
        expect(objects.has(`ups0.${ch}`)).toBe(true);
      }
    });
  });

  // -----------------------------------------------------------------------
  // Standard NUT coverage beyond the one sample device
  // -----------------------------------------------------------------------
  describe("standard NUT coverage beyond the sample device", () => {
    it("handles three-phase, ambient/EMP and outlet-group variables the Eaton lacks", async () => {
      const { adapter, objects, states } = createMockAdapter();
      const sm = new StateManager(adapter);

      // Real NUT 2.8.5 standard variables (docs/nut-names.txt) that
      // the single Eaton sample never reports — the adapter must create them just the same.
      const vars = [
        // three-phase, incl. phase-pair names that ALREADY contain a dash
        { name: "input.phases", value: "3" },
        { name: "input.L1.current", value: "133.0" },
        { name: "input.L2.current", value: "48.2" },
        { name: "input.L3-L1.voltage", value: "405.4" },
        { name: "input.bypass.L1-L2.voltage", value: "398.3" },
        // ambient / EMP environment sensors (the spec's "n" → instance 1)
        { name: "ambient.count", value: "2" },
        { name: "ambient.1.name", value: "sensor 1" },
        { name: "ambient.1.temperature", value: "23.5" },
        { name: "ambient.1.humidity", value: "45" },
        { name: "ambient.1.temperature.status", value: "good" },
        // outlet groups
        { name: "outlet.group.count", value: "2" },
        { name: "outlet.group.1.name", value: "Branch Circuit A" },
        { name: "outlet.group.1.voltage", value: "244.23" },
        { name: "outlet.group.1.status", value: "on" },
        { name: "outlet.group.1.phase", value: "L1" },
      ];
      await sm.updateVariables("ups0", vars, new Set());

      // Dash conversion survives names that already contain a dash (phase pairs): only the
      // dot after the channel becomes a dash, the existing L3-L1 / L1-L2 dashes stay.
      expect(states.get("ups0.input.L3-L1-voltage")?.val).toBe(405.4);
      expect(objects.get("ups0.input.L3-L1-voltage")?.common.unit).toBe("V");
      expect(states.get("ups0.input.bypass-L1-L2-voltage")?.val).toBe(398.3);
      expect(states.get("ups0.input.L1-current")?.val).toBe(133.0);
      expect(objects.get("ups0.input.L1-current")?.common.unit).toBe("A");

      // Ambient / EMP — numbers with units, known-string name, status as text
      expect(states.get("ups0.ambient.1-temperature")?.val).toBe(23.5);
      expect(objects.get("ups0.ambient.1-temperature")?.common.unit).toBe("°C");
      expect(states.get("ups0.ambient.1-humidity")?.val).toBe(45);
      expect(objects.get("ups0.ambient.1-humidity")?.common.unit).toBe("%");
      expect(objects.get("ups0.ambient.1-name")?.common.type).toBe("string");

      // Outlet groups
      expect(states.get("ups0.outlet.group-1-voltage")?.val).toBe(244.23);
      expect(states.get("ups0.outlet.group-1-name")?.val).toBe("Branch Circuit A");
      expect(states.get("ups0.outlet.group-1-status")?.val).toBe("on");

      // Channels the Eaton sample never created
      expect(objects.has("ups0.ambient")).toBe(true);
      expect(objects.has("ups0.outlet")).toBe(true);
      expect(objects.has("ups0.input")).toBe(true);
    });
  });

  // -----------------------------------------------------------------------
  // nutVarToStateId
  // -----------------------------------------------------------------------
  describe("nutVarToStateId", () => {
    it("should convert dots after channel to dashes", () => {
      expect(nutVarToStateId("ups0", "battery.charge.low")).toBe("ups0.battery.charge-low");
    });

    it("should keep single-dot variables unchanged", () => {
      expect(nutVarToStateId("ups0", "battery.charge")).toBe("ups0.battery.charge");
    });

    it("should handle no-dot variables", () => {
      expect(nutVarToStateId("ups0", "status")).toBe("ups0.status");
    });

    it("should convert multiple dots", () => {
      expect(nutVarToStateId("ups0", "driver.version.internal")).toBe("ups0.driver.version-internal");
      expect(nutVarToStateId("ups0", "driver.reload.or.error")).toBe("ups0.driver.reload-or-error");
    });
  });

  // -----------------------------------------------------------------------
  // nutVarToReadableName
  // -----------------------------------------------------------------------
  describe("nutVarToReadableName", () => {
    it("should format leaf part as readable name", () => {
      expect(nutVarToReadableName("battery.charge.low")).toBe("Charge low");
    });

    it("should handle single-dot variables", () => {
      expect(nutVarToReadableName("battery.charge")).toBe("Charge");
    });

    it("should handle no-dot variables", () => {
      expect(nutVarToReadableName("status")).toBe("Status");
    });

    it("should capitalize first letter only", () => {
      expect(nutVarToReadableName("ups.delay.shutdown")).toBe("Delay shutdown");
    });
  });

  // -----------------------------------------------------------------------
  // cleanupLegacyObjects
  // -----------------------------------------------------------------------
  describe("cleanupLegacyObjects", () => {
    it("should remove root-level orphans from old adapter", async () => {
      const { adapter, objects, deletedIds } = createMockAdapter();
      const sm = new StateManager(adapter);

      objects.set("battery", { type: "channel", common: { name: "Battery" }, native: {} });
      objects.set("battery.charge", { type: "state", common: { name: "charge" }, native: {} });
      objects.set("commands", { type: "channel", common: { name: "Commands" }, native: {} });

      await sm.ensureUpsDevice("ups0", "Main UPS");
      await sm.cleanupLegacyObjects(new Set(["ups0"]));

      expect(deletedIds).toContain("battery");
      expect(deletedIds).toContain("commands");
    });

    it("should not remove info or known UPS objects", async () => {
      const { adapter, deletedIds } = createMockAdapter();
      const sm = new StateManager(adapter);

      await sm.ensureUpsDevice("ups0", "Main UPS");
      await sm.cleanupLegacyObjects(new Set(["ups0"]));

      expect(deletedIds).not.toContain("info");
      expect(deletedIds).not.toContain("ups0");
    });

    it("must not eat the root-level notify trigger state as an orphan", async () => {
      // `notify` is a static instance object at the root — it is NOT a UPS device,
      // so without an exemption the orphan sweep would delete it on every discover.
      const { adapter, objects, deletedIds } = createMockAdapter();
      const sm = new StateManager(adapter);

      objects.set("notify", { type: "state", common: { name: "Trigger" }, native: {} });

      await sm.ensureUpsDevice("ups0", "Main UPS");
      await sm.cleanupLegacyObjects(new Set(["ups0"]));

      expect(deletedIds).not.toContain("notify");
      expect(objects.has("notify")).toBe(true);
    });

    it("should remove v0.1.0 dot-style objects under known UPS", async () => {
      const { adapter, objects, deletedIds } = createMockAdapter();
      const sm = new StateManager(adapter);

      objects.set("ups0", { type: "device", common: { name: "Main" }, native: {} });
      objects.set("ups0.battery", { type: "channel", common: { name: "Battery" }, native: {} });
      objects.set("ups0.battery.charge", { type: "state", common: { name: "charge" }, native: {} });
      objects.set("ups0.battery.charge.low", { type: "state", common: { name: "charge.low" }, native: {} });
      objects.set("ups0.driver.version.data", { type: "state", common: { name: "version.data" }, native: {} });

      await sm.cleanupLegacyObjects(new Set(["ups0"]));

      expect(deletedIds).toContain("ups0.battery.charge.low");
      expect(deletedIds).toContain("ups0.driver.version.data");
      expect(deletedIds).not.toContain("ups0.battery.charge");
      expect(deletedIds).not.toContain("ups0.battery");
      expect(deletedIds).not.toContain("ups0");
    });

    it("should delete deepest dot-style objects first", async () => {
      const { adapter, objects, deletedIds } = createMockAdapter();
      const sm = new StateManager(adapter);

      objects.set("ups0", { type: "device", common: { name: "Main" }, native: {} });
      // Shallow object FIRST: the mock hands objects back in insertion order, so only the
      // depth sort can put the deeper one in front (deep-first insertion would pass without it).
      objects.set("ups0.a.b.c", { type: "state", common: { name: "mid" }, native: {} });
      objects.set("ups0.a.b.c.d", { type: "state", common: { name: "deep" }, native: {} });

      await sm.cleanupLegacyObjects(new Set(["ups0"]));

      const dIdx = deletedIds.indexOf("ups0.a.b.c.d");
      const cIdx = deletedIds.indexOf("ups0.a.b.c");
      expect(dIdx).toBeLessThan(cIdx);
    });
  });

  // -----------------------------------------------------------------------
  // cleanupDeprecatedInfoStates (called from ensureUpsDevice)
  // -----------------------------------------------------------------------
  describe("cleanupDeprecatedInfoStates", () => {
    it("should delete legacy info.name, info.description and the renamed info.online on device init", async () => {
      const { adapter, objects, deletedIds } = createMockAdapter();
      const sm = new StateManager(adapter);

      objects.set("ups0.info.name", { type: "state", common: { name: "UPS Name" }, native: {} });
      objects.set("ups0.info.description", { type: "state", common: { name: "Description" }, native: {} });
      // 0.4.0 renamed info.online → info.reachable; the old state must be cleaned up, not
      // left frozen at its last value (ioBroker does not auto-remove abandoned states).
      objects.set("ups0.info.online", { type: "state", common: { name: "Online" }, native: {} });

      await sm.ensureUpsDevice("ups0", "Main UPS");

      expect(deletedIds).toContain("ups0.info.name");
      expect(deletedIds).toContain("ups0.info.description");
      expect(deletedIds).toContain("ups0.info.online");
      // The replacement must still be created (and must NOT be deleted by the cleanup).
      expect(objects.has("ups0.info.reachable")).toBe(true);
      expect(deletedIds).not.toContain("ups0.info.reachable");
    });

    it("should not fail when deprecated states do not exist", async () => {
      const { adapter } = createMockAdapter();
      const sm = new StateManager(adapter);

      await expect(sm.ensureUpsDevice("ups0", "Main UPS")).resolves.not.toThrow();
    });

    it("runs the deprecated-state cleanup only once per runtime, not on every reconnect", async () => {
      const { adapter, objects, deletedIds } = createMockAdapter();
      const sm = new StateManager(adapter);

      objects.set("ups0.info.online", { type: "state", common: { name: "Online" }, native: {} });

      await sm.ensureUpsDevice("ups0", "Main UPS"); // first connect → cleanup runs
      await sm.ensureUpsDevice("ups0", "Main UPS"); // reconnect → cleanup must be skipped (cached)

      expect(deletedIds.filter(id => id === "ups0.info.online")).toHaveLength(1);
    });
  });

  // -----------------------------------------------------------------------
  // enrichStateMetadata
  // -----------------------------------------------------------------------
  describe("enrichStateMetadata", () => {
    it("should set common.states via extendObject", async () => {
      const { adapter, objects } = createMockAdapter();
      const sm = new StateManager(adapter);

      objects.set("ups0.output.voltage-nominal", {
        type: "state",
        common: { type: "number", role: "level", name: "Voltage nominal" },
        native: {},
      });

      await sm.enrichStateMetadata("ups0.output.voltage-nominal", {
        states: { 200: "200", 208: "208", 220: "220", 230: "230", 240: "240" },
      });

      const common = objects.get("ups0.output.voltage-nominal")?.common as any;
      expect(common.states).toEqual({ 200: "200", 208: "208", 220: "220", 230: "230", 240: "240" });
    });

    it("should set common.min and common.max via extendObject", async () => {
      const { adapter, objects } = createMockAdapter();
      const sm = new StateManager(adapter);

      objects.set("ups0.ups.delay-shutdown", {
        type: "state",
        common: { type: "number", role: "level", name: "Delay shutdown" },
        native: {},
      });

      await sm.enrichStateMetadata("ups0.ups.delay-shutdown", { min: 10, max: 300 });

      const common = objects.get("ups0.ups.delay-shutdown")?.common as any;
      expect(common.min).toBe(10);
      expect(common.max).toBe(300);
    });

    it("should not call extendObject when patch is empty", async () => {
      let extendCalled = false;
      const { adapter } = createMockAdapter();
      const origExtend = adapter.extendObject;
      adapter.extendObject = (...args: any[]) => {
        extendCalled = true;
        return Promise.resolve(origExtend(...args));
      };
      const sm = new StateManager(adapter);

      await sm.enrichStateMetadata("ups0.some.state", {});

      expect(extendCalled).toBe(false);
    });
  });

  describe("preserve option", () => {
    it("ensureUpsDevice passes preserve for common.name", async () => {
      const { adapter } = createMockAdapter();
      const calls: any[][] = [];
      const origExtend = adapter.extendObject;
      adapter.extendObject = (...args: any[]) => {
        calls.push(args);
        return Promise.resolve(origExtend(...args));
      };
      const sm = new StateManager(adapter);

      await sm.ensureUpsDevice("ups0", "Test UPS");

      const deviceCall = calls.find(c => c[0] === "ups0");
      expect(deviceCall).toBeDefined();
      expect(deviceCall![2]).toEqual({ preserve: { common: ["name"] } });
    });

    it("ensureState passes preserve for common.name", async () => {
      const { adapter } = createMockAdapter();
      const calls: any[][] = [];
      const origExtend = adapter.extendObject;
      adapter.extendObject = (...args: any[]) => {
        calls.push(args);
        return Promise.resolve(origExtend(...args));
      };
      const sm = new StateManager(adapter);

      await sm.updateVariables("ups0", [{ name: "battery.charge", value: "100" }], new Set());

      const stateCall = calls.find(c => c[0] === "ups0.battery.charge");
      expect(stateCall).toBeDefined();
      expect(stateCall![2]).toEqual({ preserve: { common: ["name"] } });
    });
  });

  describe("updateVariables — dotless variable (#4)", () => {
    it("stores a dotless variable as a real state under the device, not a colliding channel", async () => {
      const { adapter, objects, states } = createMockAdapter();
      const sm = new StateManager(adapter);

      await sm.updateVariables("ups0", [{ name: "ALARM", value: "On battery" }], new Set());

      const obj = objects.get("ups0.ALARM");
      expect(obj?.type).toBe("state");
      expect(obj?.common.type).toBe("string");
      expect(states.get("ups0.ALARM")?.val).toBe("On battery");
    });
  });
});

describe("sanitizeUpsName", () => {
  it("passes clean alphanumeric/underscore/dash names through unchanged", () => {
    expect(sanitizeUpsName("ups0")).toBe("ups0");
    expect(sanitizeUpsName("my-ups_2")).toBe("my-ups_2");
  });

  it("replaces spaces, dots and forbidden chars with underscore (object-ID safe)", () => {
    expect(sanitizeUpsName("my ups!")).toBe("my_ups_");
    expect(sanitizeUpsName("rack.a")).toBe("rack_a");
    expect(sanitizeUpsName("ups@home#1")).toBe("ups_home_1");
  });
});

describe("update migration — changed datapoints are updated in place", () => {
  it("upgrades an existing string state to boolean when the detected type changes (driver.flag)", async () => {
    const { adapter, objects } = createMockAdapter();
    const sm = new StateManager(adapter);
    // An older adapter version stored driver.flag.ignorelb as opaque text, and the user renamed it.
    objects.set("ups0.driver.flag-ignorelb", {
      type: "state",
      common: { type: "string", role: "text", name: "My flag", read: true, write: false },
      native: {},
    });

    await sm.updateVariables("ups0", [{ name: "driver.flag.ignorelb", value: "enabled" }], new Set());

    const obj = objects.get("ups0.driver.flag-ignorelb");
    expect(obj?.common.type).toBe("boolean"); // datapoint type migrated in place
    expect(obj?.common.role).toBe("indicator");
    expect(obj?.common.name).toBe("My flag"); // user rename preserved
  });

  it("adds common.states to an existing enum-less state on update (device.type)", async () => {
    const { adapter, objects } = createMockAdapter();
    const sm = new StateManager(adapter);
    objects.set("ups0.device.type", {
      type: "state",
      common: { type: "string", role: "text", name: "Device type" },
      native: {},
    });

    await sm.updateVariables("ups0", [{ name: "device.type", value: "ups" }], new Set());

    const obj = objects.get("ups0.device.type");
    expect(obj?.common.states).toEqual({ ups: "ups", pdu: "pdu", scd: "scd", psu: "psu", ats: "ats" });
  });
});

describe("markAllUnreachable", () => {
  it("resets info.reachable to false for every known UPS device", async () => {
    const { adapter, states } = createMockAdapter();
    const sm = new StateManager(adapter);
    await sm.ensureUpsDevice("ups0", "Main UPS");
    await sm.ensureUpsDevice("ups1", "Second UPS");
    states.set("ups0.info.reachable", { val: true, ack: true });
    states.set("ups1.info.reachable", { val: true, ack: true });

    await sm.markAllUnreachable();

    expect(states.get("ups0.info.reachable")).toEqual({ val: false, ack: true });
    expect(states.get("ups1.info.reachable")).toEqual({ val: false, ack: true });
  });

  it("skips devices without an info.reachable state instead of writing a missing id", async () => {
    const { adapter, objects, states } = createMockAdapter();
    const sm = new StateManager(adapter);
    objects.set("legacy", { type: "device", common: { name: "Device from an older layout" }, native: {} });

    await sm.markAllUnreachable();

    expect(states.has("legacy.info.reachable")).toBe(false);
  });

  it("ignores channels and states — only device objects carry the online indicator", async () => {
    const { adapter, states } = createMockAdapter();
    const sm = new StateManager(adapter);
    await sm.ensureUpsDevice("ups0", "Main UPS");
    await sm.updateVariables("ups0", [{ name: "ups.status", value: "OL" }], new Set());

    await sm.markAllUnreachable();

    expect(states.get("ups0.info.reachable")).toEqual({ val: false, ack: true });
    expect(states.get("ups0.ups.status")).toEqual({ val: "OL", ack: true });
  });
});

describe("UPS summary states", () => {
  it("writes how many UPSes there are and how many answer", async () => {
    const { adapter, states } = createMockAdapter();
    const sm = new StateManager(adapter as never);

    await sm.writeUpsSummary(3, 2);

    expect(states.get("info.upsTotal")).toEqual({ val: 3, ack: true });
    expect(states.get("info.upsReachable")).toEqual({ val: 2, ack: true });
    expect(states.get("info.allUpsReachable")).toEqual({ val: false, ack: true });
  });

  it("says all reachable only when every UPS answers", async () => {
    const { adapter, states } = createMockAdapter();
    const sm = new StateManager(adapter as never);

    await sm.writeUpsSummary(2, 2);

    expect(states.get("info.allUpsReachable")).toEqual({ val: true, ack: true });
  });

  it("does not claim all-reachable while no UPS is known at all", async () => {
    const { adapter, states } = createMockAdapter();
    const sm = new StateManager(adapter as never);

    await sm.writeUpsSummary(0, 0);

    // 0 of 0 is not "everything is fine" — it means nothing was found.
    expect(states.get("info.allUpsReachable")).toEqual({ val: false, ack: true });
  });

  it("takes the summary down with the devices when nothing is being read", async () => {
    const { adapter, states } = createMockAdapter();
    const sm = new StateManager(adapter as never);
    states.set("info.upsTotal", { val: 3, ack: true });
    states.set("info.upsReachable", { val: 3, ack: true });
    states.set("info.allUpsReachable", { val: true, ack: true });
    await sm.markAllUnreachable();

    // The count of UPSes that exist is still the best estimate — only the
    // "how many answer" part drops.
    expect(states.get("info.upsTotal")).toEqual({ val: 3, ack: true });
    expect(states.get("info.upsReachable")).toEqual({ val: 0, ack: true });
    expect(states.get("info.allUpsReachable")).toEqual({ val: false, ack: true });
  });
});
