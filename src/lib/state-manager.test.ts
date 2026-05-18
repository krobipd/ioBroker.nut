import { StateManager, nutVarToStateId, nutVarToReadableName } from "./state-manager";

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
    namespace: "nut.0",
    log: {
      info: (msg: string) => logs.push(`INFO: ${msg}`),
      debug: (msg: string) => logs.push(`DEBUG: ${msg}`),
      warn: (msg: string) => logs.push(`WARN: ${msg}`),
      error: (msg: string) => logs.push(`ERROR: ${msg}`),
    },
    setObjectNotExistsAsync: async (id: string, obj: MockObj) => {
      if (!objects.has(id)) {
        objects.set(id, obj);
      }
    },
    extendObjectAsync: async (id: string, obj: MockObj) => {
      const existing = objects.get(id);
      if (existing) {
        existing.common = { ...existing.common, ...obj.common };
      } else {
        objects.set(id, obj);
      }
    },
    setState: async (id: string, state: MockState) => {
      states.set(id, state);
    },
    getAdapterObjectsAsync: async () => {
      const result: Record<string, MockObj> = {};
      for (const [id, obj] of objects) {
        result[`nut.0.${id}`] = obj;
      }
      return result;
    },
    delObjectAsync: async (id: string, _opts?: { recursive?: boolean }) => {
      deletedIds.push(id);
      for (const key of objects.keys()) {
        if (key === id || key.startsWith(`${id}.`)) {
          objects.delete(key);
        }
      }
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

    it("should create info channel, info.online, info.name and info.description", async () => {
      const { adapter, objects, states } = createMockAdapter();
      const sm = new StateManager(adapter);

      await sm.ensureUpsDevice("ups0", "Main UPS");

      expect(objects.has("ups0.info")).toBe(true);
      expect(objects.get("ups0.info")?.type).toBe("channel");
      expect(objects.has("ups0.info.online")).toBe(true);
      expect(objects.get("ups0.info.online")?.common.role).toBe("indicator.reachable");
      expect(states.has("ups0.info.name")).toBe(true);
      expect(states.get("ups0.info.name")?.val).toBe("ups0");
      expect(states.has("ups0.info.description")).toBe(true);
      expect(states.get("ups0.info.description")?.val).toBe("Main UPS");
    });

    it("should set statusStates.onlineId on device object", async () => {
      const { adapter, objects } = createMockAdapter();
      const sm = new StateManager(adapter);

      await sm.ensureUpsDevice("ups0", "Main UPS");

      const common = objects.get("ups0")?.common as any;
      expect(common?.statusStates?.onlineId).toBe("nut.0.ups0.info.online");
    });

    it("should update device description on re-discover", async () => {
      const { adapter, objects } = createMockAdapter();
      const sm = new StateManager(adapter);

      await sm.ensureUpsDevice("ups0", "Main UPS");
      await sm.ensureUpsDevice("ups0", "Updated UPS");

      expect(objects.get("ups0")?.common.name).toBe("Updated UPS");
    });

    it("should create multiple devices", async () => {
      const { adapter, objects } = createMockAdapter();
      const sm = new StateManager(adapter);

      await sm.ensureUpsDevice("ups0", "Main UPS");
      await sm.ensureUpsDevice("ups1", "Backup UPS");

      expect(objects.has("ups0")).toBe(true);
      expect(objects.has("ups1")).toBe(true);
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
      expect((name as any).en).toBe("Battery");
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

      await sm.updateVariables("ups0", [
        { name: "battery.charge", value: "100" },
        { name: "ups.status", value: "OL" },
      ], new Set());

      expect(objects.has("ups0.battery.charge")).toBe(true);
      expect(states.get("ups0.battery.charge")?.val).toBe(100);
      expect(states.get("ups0.ups.status")?.val).toBe("OL");
    });

    it("should create channels automatically", async () => {
      const { adapter, objects } = createMockAdapter();
      const sm = new StateManager(adapter);

      await sm.updateVariables("ups0", [
        { name: "battery.charge", value: "100" },
      ], new Set());

      expect(objects.has("ups0.battery")).toBe(true);
    });

    it("should set write:true for writable variables", async () => {
      const { adapter, objects } = createMockAdapter();
      const sm = new StateManager(adapter);

      await sm.updateVariables("ups0", [
        { name: "ups.delay.shutdown", value: "20" },
      ], new Set(["ups.delay.shutdown"]));

      const common = objects.get("ups0.ups.delay-shutdown")?.common;
      expect(common?.write).toBe(true);
    });

    it("should detect correct types", async () => {
      const { adapter, states } = createMockAdapter();
      const sm = new StateManager(adapter);

      await sm.updateVariables("ups0", [
        { name: "battery.charge", value: "100" },
        { name: "device.mfr", value: "EATON" },
        { name: "input.voltage", value: "221.0" },
      ], new Set());

      expect(states.get("ups0.battery.charge")?.val).toBe(100);
      expect(states.get("ups0.device.mfr")?.val).toBe("EATON");
      expect(states.get("ups0.input.voltage")?.val).toBe(221.0);
    });

    it("should process shallow variables before deep ones", async () => {
      const { adapter, objects } = createMockAdapter();
      const sm = new StateManager(adapter);

      await sm.updateVariables("ups0", [
        { name: "battery.charge.low", value: "15" },
        { name: "battery.charge", value: "100" },
      ], new Set());

      const keys = [...objects.keys()];
      const chargeIdx = keys.indexOf("ups0.battery.charge");
      const chargeLowIdx = keys.indexOf("ups0.battery.charge-low");
      expect(chargeIdx).toBeLessThan(chargeLowIdx);
    });

    it("should use readable names for state objects", async () => {
      const { adapter, objects } = createMockAdapter();
      const sm = new StateManager(adapter);

      await sm.updateVariables("ups0", [
        { name: "battery.charge.low", value: "15" },
      ], new Set());

      const common = objects.get("ups0.battery.charge-low")?.common;
      expect(common?.name).toBe("Charge low");
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
  describe("createCommandButtons", () => {
    it("should create button states with dots→dashes and readable names", async () => {
      const { adapter, objects } = createMockAdapter();
      const sm = new StateManager(adapter);

      await sm.createCommandButtons("ups0", [
        { name: "beeper.enable" },
        { name: "load.off" },
      ]);

      expect(objects.has("ups0.commands")).toBe(true);
      expect(objects.has("ups0.commands.beeper-enable")).toBe(true);
      expect(objects.has("ups0.commands.load-off")).toBe(true);

      const common = objects.get("ups0.commands.beeper-enable")?.common;
      expect(common?.role).toBe("button");
      expect(common?.write).toBe(true);
      expect(common?.read).toBe(false);
      expect(common?.name).toBe("Beeper enable");
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
      adapter.setObjectNotExistsAsync = async (...args: any[]) => {
        callCount++;
        return originalSetObj(...args);
      };

      const sm = new StateManager(adapter);

      await sm.updateVariables("ups0", [
        { name: "battery.charge", value: "100" },
      ], new Set());

      const firstCount = callCount;

      await sm.updateVariables("ups0", [
        { name: "battery.charge", value: "95" },
      ], new Set());

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

      await sm.updateVariables("ups0", [
        { name: "battery.charge", value: "100" },
        { name: "battery.charge.low", value: "15" },
      ], new Set());

      expect(objects.has("ups0.battery.charge")).toBe(true);
      expect(objects.has("ups0.battery.charge-low")).toBe(true);
      expect(states.get("ups0.battery.charge")?.val).toBe(100);
      expect(states.get("ups0.battery.charge-low")?.val).toBe(15);
    });

    it("should handle driver.version variants with dash conversion", async () => {
      const { adapter, objects, states } = createMockAdapter();
      const sm = new StateManager(adapter);

      await sm.updateVariables("ups0", [
        { name: "driver.version", value: "2.8.0" },
        { name: "driver.version.data", value: "MGE HID 1.46" },
        { name: "driver.version.internal", value: "0.47" },
      ], new Set());

      expect(objects.has("ups0.driver.version")).toBe(true);
      expect(objects.has("ups0.driver.version-data")).toBe(true);
      expect(objects.has("ups0.driver.version-internal")).toBe(true);
      expect(states.get("ups0.driver.version")?.val).toBe("2.8.0");
    });

    it("should handle outlet paths with dash conversion", async () => {
      const { adapter, objects } = createMockAdapter();
      const sm = new StateManager(adapter);

      await sm.updateVariables("ups0", [
        { name: "outlet.desc", value: "Main Outlet" },
        { name: "outlet.1.desc", value: "PowerShare 1" },
        { name: "outlet.1.status", value: "on" },
        { name: "outlet.2.desc", value: "PowerShare 2" },
      ], new Set());

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
    it("should handle all 54 variables from live test", async () => {
      const { adapter, objects, states } = createMockAdapter();
      const sm = new StateManager(adapter);

      const vars = [
        { name: "battery.charge", value: "100" },
        { name: "battery.charge.low", value: "15" },
        { name: "battery.runtime", value: "2207" },
        { name: "battery.type", value: "PbAc" },
        { name: "device.mfr", value: "EATON" },
        { name: "device.model", value: "Ellipse PRO 1600 " },
        { name: "device.serial", value: "G364T29133" },
        { name: "device.type", value: "ups" },
        { name: "ups.status", value: "OL" },
        { name: "ups.load", value: "15" },
        { name: "ups.power", value: "159" },
        { name: "ups.realpower", value: "147" },
        { name: "input.voltage", value: "221.0" },
        { name: "input.frequency", value: "50.0" },
        { name: "output.voltage", value: "223.0" },
        { name: "output.frequency", value: "50.0" },
      ];

      await sm.updateVariables("ups0", vars, new Set(["ups.delay.shutdown", "ups.delay.start"]));

      // Numeric types (dots→dashes after channel)
      expect(states.get("ups0.battery.charge")?.val).toBe(100);
      expect(states.get("ups0.battery.runtime")?.val).toBe(2207);
      expect(states.get("ups0.input.voltage")?.val).toBe(221.0);
      expect(states.get("ups0.ups.load")?.val).toBe(15);
      expect(states.get("ups0.ups.power")?.val).toBe(159);
      expect(states.get("ups0.ups.realpower")?.val).toBe(147);
      expect(states.get("ups0.battery.charge-low")?.val).toBe(15);

      // String types
      expect(states.get("ups0.battery.type")?.val).toBe("PbAc");
      expect(states.get("ups0.device.mfr")?.val).toBe("EATON");
      expect(states.get("ups0.device.model")?.val).toBe("Ellipse PRO 1600 ");
      expect(states.get("ups0.ups.status")?.val).toBe("OL");

      // Channels created
      expect(objects.has("ups0.battery")).toBe(true);
      expect(objects.has("ups0.device")).toBe(true);
      expect(objects.has("ups0.ups")).toBe(true);
      expect(objects.has("ups0.input")).toBe(true);
      expect(objects.has("ups0.output")).toBe(true);
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
      const { adapter, objects, deletedIds } = createMockAdapter();
      const sm = new StateManager(adapter);

      await sm.ensureUpsDevice("ups0", "Main UPS");
      await sm.cleanupLegacyObjects(new Set(["ups0"]));

      expect(deletedIds).not.toContain("info");
      expect(deletedIds).not.toContain("ups0");
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
      objects.set("ups0.a.b.c.d", { type: "state", common: { name: "deep" }, native: {} });
      objects.set("ups0.a.b.c", { type: "state", common: { name: "mid" }, native: {} });

      await sm.cleanupLegacyObjects(new Set(["ups0"]));

      const dIdx = deletedIds.indexOf("ups0.a.b.c.d");
      const cIdx = deletedIds.indexOf("ups0.a.b.c");
      expect(dIdx).toBeLessThan(cIdx);
    });
  });
});
