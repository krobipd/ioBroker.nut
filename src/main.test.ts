/**
 * Orchestration tests for main.ts — onReady wiring, the idempotent onConnected
 * setup (auth-failure → yellow, command buttons, timer arming), the poll matrix
 * (per-UPS error dedup, DATA-STALE, one-shot enrichment, connection gating),
 * classifyError, onStateChange command/SET-VAR gates and onUnload.
 *
 * Fleet harness pattern: @iobroker/adapter-core is mocked with a stub Adapter
 * class; the NutClient and StateManager are injected as fakes through the
 * factory seams (makeClient/makeStateManager) — their real implementations are
 * covered by their own suites against real sockets / the preserve-aware mock.
 */

import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@iobroker/adapter-core", () => {
  class StubAdapter {
    namespace = "nut2.0";
    adapterDir = "/stub-adapter-dir";
    config: Record<string, unknown> = {};
    states = new Map<string, { val: unknown; ack: boolean }>();
    logs: { level: string; msg: string }[] = [];
    handlers = new Map<string, (...args: unknown[]) => unknown>();
    subscriptions: string[] = [];
    intervals: { cb: () => void; ms: number }[] = [];
    timeouts: { cb: () => void; ms: number; cleared: boolean }[] = [];

    log = {
      debug: (m: string): void => void this.logs.push({ level: "debug", msg: m }),
      info: (m: string): void => void this.logs.push({ level: "info", msg: m }),
      warn: (m: string): void => void this.logs.push({ level: "warn", msg: m }),
      error: (m: string): void => void this.logs.push({ level: "error", msg: m }),
    };

    constructor(_options?: unknown) {}

    on(event: string, cb: (...args: unknown[]) => unknown): this {
      this.handlers.set(event, cb);
      return this;
    }

    private fullId(id: string): string {
      return id.startsWith(`${this.namespace}.`) ? id : `${this.namespace}.${id}`;
    }

    async setState(id: string, state: { val: unknown; ack?: boolean }): Promise<void> {
      this.states.set(this.fullId(id), { val: state.val, ack: state.ack ?? false });
    }

    async setStateChangedAsync(id: string, state: { val: unknown; ack?: boolean }): Promise<void> {
      this.states.set(this.fullId(id), { val: state.val, ack: state.ack ?? false });
    }

    async subscribeStatesAsync(pattern: string): Promise<void> {
      this.subscriptions.push(pattern);
    }

    setInterval(cb: () => void, ms: number): object {
      this.intervals.push({ cb, ms });
      return { __interval: this.intervals.length - 1 };
    }

    clearInterval(_handle: unknown): void {}

    setTimeout(cb: () => void, ms: number): object {
      const entry = { cb, ms, cleared: false };
      this.timeouts.push(entry);
      return entry;
    }

    clearTimeout(handle: unknown): void {
      const entry = this.timeouts.find(t => t === handle);
      if (entry) {
        entry.cleared = true;
      }
    }

    sendTo(): void {}
  }

  return {
    Adapter: StubAdapter,
    I18n: {
      init: vi.fn(async () => {}),
      getTranslatedObject: vi.fn((key: string) => ({ en: key })),
      translate: vi.fn((key: string) => key),
    },
  };
});

import { NutAdapter } from "./main";
import { NutError } from "./lib/nut-client";
import type { NutClient } from "./lib/nut-client";
import type { StateManager } from "./lib/state-manager";
import type { NutVariable, UpsInfo } from "./lib/types";

/** Stub surface added by the adapter-core mock (see vi.mock factory above). */
interface StubSurface {
  config: Record<string, unknown>;
  states: Map<string, { val: unknown; ack: boolean }>;
  logs: { level: string; msg: string }[];
  subscriptions: string[];
  intervals: { cb: () => void; ms: number }[];
  timeouts: { cb: () => void; ms: number; cleared: boolean }[];
}

interface FakeClient {
  start: ReturnType<typeof vi.fn>;
  connect: ReturnType<typeof vi.fn>;
  destroy: ReturnType<typeof vi.fn>;
  shutdown: ReturnType<typeof vi.fn>;
  authenticate: ReturnType<typeof vi.fn>;
  login: ReturnType<typeof vi.fn>;
  listUps: ReturnType<typeof vi.fn>;
  listVar: ReturnType<typeof vi.fn>;
  listRw: ReturnType<typeof vi.fn>;
  listCmd: ReturnType<typeof vi.fn>;
  listEnum: ReturnType<typeof vi.fn>;
  listRange: ReturnType<typeof vi.fn>;
  instCmd: ReturnType<typeof vi.fn>;
  setVar: ReturnType<typeof vi.fn>;
  setOnConnect: ReturnType<typeof vi.fn>;
  setOnFatal: ReturnType<typeof vi.fn>;
  isConnected: boolean;
  /** Captured by setOnConnect — drive it to simulate the client's (re)connect. */
  onConnect: (() => void) | null;
  onFatal: ((err: unknown) => void) | null;
}

function makeFakeClient(upsList: UpsInfo[] = [{ name: "ups0", description: "Main UPS" }]): FakeClient {
  const fake: FakeClient = {
    start: vi.fn(),
    connect: vi.fn(async () => {}),
    destroy: vi.fn(),
    shutdown: vi.fn(),
    authenticate: vi.fn(async () => {}),
    login: vi.fn(async () => {}),
    listUps: vi.fn(async () => upsList),
    listVar: vi.fn(async (): Promise<NutVariable[]> => [
      { name: "battery.charge", value: "100" },
      { name: "ups.status", value: "OL" },
    ]),
    listRw: vi.fn(async (): Promise<NutVariable[]> => []),
    listCmd: vi.fn(async () => [{ name: "beeper.enable" }]),
    listEnum: vi.fn(async () => []),
    listRange: vi.fn(async () => []),
    instCmd: vi.fn(async () => {}),
    setVar: vi.fn(async () => {}),
    setOnConnect: vi.fn((cb: () => void) => {
      fake.onConnect = cb;
    }),
    setOnFatal: vi.fn((cb: (err: unknown) => void) => {
      fake.onFatal = cb;
    }),
    isConnected: true,
    onConnect: null,
    onFatal: null,
  };
  return fake;
}

interface FakeStateManager {
  ensureUpsDevice: ReturnType<typeof vi.fn>;
  updateVariables: ReturnType<typeof vi.fn>;
  updateDeviceName: ReturnType<typeof vi.fn>;
  updateStatusFlags: ReturnType<typeof vi.fn>;
  createCommandButtons: ReturnType<typeof vi.fn>;
  cleanupRemovedUps: ReturnType<typeof vi.fn>;
  cleanupLegacyObjects: ReturnType<typeof vi.fn>;
  enrichStateMetadata: ReturnType<typeof vi.fn>;
  nutNameForState: ReturnType<typeof vi.fn>;
}

function makeFakeStateManager(): FakeStateManager {
  return {
    ensureUpsDevice: vi.fn(async () => {}),
    updateVariables: vi.fn(async () => {}),
    updateDeviceName: vi.fn(async () => {}),
    updateStatusFlags: vi.fn(async () => {}),
    createCommandButtons: vi.fn(async () => {}),
    cleanupRemovedUps: vi.fn(async () => {}),
    cleanupLegacyObjects: vi.fn(async () => {}),
    enrichStateMetadata: vi.fn(async () => {}),
    nutNameForState: vi.fn(() => undefined),
  };
}

/** Typed access to the private members the orchestration tests drive. */
interface Internal {
  onReady: () => Promise<void>;
  onConnected: () => Promise<void>;
  onStateChange: (id: string, state: { val: unknown; ack: boolean } | null | undefined) => Promise<void>;
  onUnload: (callback: () => void) => void;
  poll: () => Promise<void>;
  discover: () => Promise<void>;
  classifyError: (err: unknown) => string;
  makeClient: (...args: unknown[]) => NutClient;
  makeStateManager: () => StateManager;
  client: FakeClient | null;
  stateManager: FakeStateManager | null;
  failedUps: Set<string>;
  enrichedUps: Set<string>;
  discoveredUps: Map<string, UpsInfo>;
  authenticated: boolean;
  testClients: Set<{ destroy: () => void }>;
  pollTimer: unknown;
  lastErrorCode: string;
}

const BASE_CONFIG = {
  host: "10.0.0.3",
  port: 3493,
  networkInterface: "",
  pollInterval: 15,
  username: "",
  password: "",
  useTls: false,
  tlsRejectUnauthorized: false,
  commandTimeout: 5,
  enableCommands: false,
  enableSetVar: false,
};

interface Setup {
  adapter: NutAdapter;
  internal: Internal;
  stub: StubSurface;
  client: FakeClient;
  sm: FakeStateManager;
}

function setup(config: Partial<typeof BASE_CONFIG> = {}, upsList?: UpsInfo[]): Setup {
  const adapter = new NutAdapter();
  const stub = adapter as unknown as StubSurface;
  const internal = adapter as unknown as Internal;
  stub.config = { ...BASE_CONFIG, ...config };
  const client = makeFakeClient(upsList);
  const sm = makeFakeStateManager();
  internal.makeClient = () => client as unknown as NutClient;
  internal.makeStateManager = () => sm as unknown as StateManager;
  return { adapter, internal, stub, client, sm };
}

/** onReady + simulate the client's connect callback (the unified loop firing). */
async function setupConnected(config: Partial<typeof BASE_CONFIG> = {}, upsList?: UpsInfo[]): Promise<Setup> {
  const s = setup(config, upsList);
  await s.internal.onReady();
  expect(s.client.start).toHaveBeenCalledTimes(1);
  await (s.internal.onConnected as () => Promise<void>)();
  return s;
}

function logsOf(stub: StubSurface, level: string): string[] {
  return stub.logs.filter(l => l.level === level).map(l => l.msg);
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("onReady", () => {
  it("wires the client (onConnect/onFatal) and starts the retry loop", async () => {
    const { internal, client } = setup();
    await internal.onReady();
    expect(client.setOnConnect).toHaveBeenCalledTimes(1);
    expect(client.setOnFatal).toHaveBeenCalledTimes(1);
    expect(client.start).toHaveBeenCalledTimes(1);
  });

  it("errors out without a host and never builds a client", async () => {
    const { internal, stub, client } = setup({ host: "   " });
    await internal.onReady();
    expect(logsOf(stub, "error").some(m => m.includes("host is required"))).toBe(true);
    expect(client.start).not.toHaveBeenCalled();
  });

  it("sets info.connection=false at startup", async () => {
    const { internal, stub } = setup();
    await internal.onReady();
    expect(stub.states.get("nut2.0.info.connection")).toEqual({ val: false, ack: true });
  });

  it("catches unexpected errors (onReady failed log, no throw)", async () => {
    const { internal, stub } = setup();
    internal.makeClient = () => {
      throw new Error("boom in factory");
    };
    await internal.onReady();
    expect(logsOf(stub, "error").some(m => m.includes("onReady failed: boom in factory"))).toBe(true);
  });
});

describe("onConnected — idempotent post-connect setup", () => {
  it("still arms the poll timer if post-connect setup fails on a live socket", async () => {
    const s = setup();
    await s.internal.onReady();
    s.sm.ensureUpsDevice.mockRejectedValue(new Error("DB write failed during discovery"));
    await s.internal.onConnected();
    expect(s.internal.pollTimer).toBeDefined();
    expect(logsOf(s.stub, "error").some(m => m.includes("Post-connect setup failed"))).toBe(true);
  });

  it("happy path: discovers, polls, arms the timer once and logs the started line", async () => {
    const { stub, client, sm } = await setupConnected();

    expect(client.listUps).toHaveBeenCalled();
    expect(sm.ensureUpsDevice).toHaveBeenCalledWith("ups0", "Main UPS");
    expect(sm.updateVariables).toHaveBeenCalled();
    expect(stub.intervals).toHaveLength(0);
    expect(stub.timeouts).toHaveLength(1);
    expect(stub.timeouts[0].ms).toBe(15000);
    expect(logsOf(stub, "info").some(m => m.includes("NUT adapter started — 1 UPS(es) on 10.0.0.3:3493"))).toBe(true);
    expect(stub.states.get("nut2.0.info.connection")).toEqual({ val: true, ack: true });
  });

  it("chains the next poll from the previous poll's completion (setTimeout, not setInterval)", async () => {
    const s = await setupConnected();
    expect(s.stub.intervals).toHaveLength(0);
    expect(s.stub.timeouts).toHaveLength(1);
    // Firing the timer runs a poll; only after it finishes is the next timer scheduled.
    s.stub.timeouts[0].cb();
    await new Promise(resolve => setImmediate(resolve));
    expect(s.stub.timeouts.length).toBeGreaterThanOrEqual(2);
    expect(s.stub.timeouts[s.stub.timeouts.length - 1].ms).toBe(15000);
  });

  it("does not arm a second poll timer on reconnect (idempotent re-entry)", async () => {
    const { internal, stub } = await setupConnected();
    await internal.onConnected();
    expect(stub.timeouts).toHaveLength(1);
    expect(logsOf(stub, "info").some(m => m.includes("Reconnected to NUT server"))).toBe(true);
  });

  it("authenticates but does NOT LOGIN per UPS (one LOGIN/connection — multi-UPS would ALREADY-LOGGED-IN)", async () => {
    const { client } = await setupConnected({ username: "admin", password: "secret" });
    expect(client.authenticate).toHaveBeenCalledWith("admin", "secret");
    expect(client.login).not.toHaveBeenCalled();
  });

  it("auth failure → error+info logs, client destroyed, yellow, NO poll timer", async () => {
    const s = setup({ username: "admin", password: "wrong" });
    s.client.authenticate.mockRejectedValue(new NutError("ACCESS-DENIED"));
    await s.internal.onReady();
    await s.internal.onConnected();

    expect(logsOf(s.stub, "error").some(m => m.includes("Authentication failed"))).toBe(true);
    expect(logsOf(s.stub, "info").some(m => m.includes("adapter is idle"))).toBe(true);
    expect(s.client.destroy).toHaveBeenCalledTimes(1);
    expect(s.stub.states.get("nut2.0.info.connection")).toEqual({ val: false, ack: true });
    expect(s.stub.timeouts).toHaveLength(0);
  });

  it("creates command buttons only when authenticated AND enableCommands", async () => {
    const withCmd = await setupConnected({ username: "u", password: "p", enableCommands: true });
    expect(withCmd.sm.createCommandButtons).toHaveBeenCalledWith("ups0", [{ name: "beeper.enable" }]);

    const noAuth = await setupConnected({ enableCommands: true });
    expect(noAuth.sm.createCommandButtons).not.toHaveBeenCalled();
  });

  it("a failing LIST CMD for one UPS is non-fatal (debug only)", async () => {
    const s = setup({ username: "u", password: "p", enableCommands: true });
    s.client.listCmd.mockRejectedValue(new Error("no commands"));
    await s.internal.onReady();
    await s.internal.onConnected();
    expect(logsOf(s.stub, "debug").some(m => m.includes("Failed to list commands"))).toBe(true);
    expect(logsOf(s.stub, "error")).toEqual([]);
  });

  it("subscribes exactly once and only when commands or SET VAR are enabled", async () => {
    const off = await setupConnected();
    expect(off.stub.subscriptions).toEqual([]);

    const on = await setupConnected({ enableSetVar: true });
    await on.internal.onConnected();
    expect(on.stub.subscriptions).toEqual(["*"]);
  });

  it("post-connect failure is caught and logged", async () => {
    const s = setup();
    s.client.listUps.mockRejectedValue(new Error("LIST UPS exploded"));
    await s.internal.onReady();
    await s.internal.onConnected();
    expect(logsOf(s.stub, "error").some(m => m.includes("Post-connect setup failed"))).toBe(true);
  });
});

describe("onConnectFatal", () => {
  it("logs the TLS guidance, destroys the client and goes yellow", async () => {
    const { internal, stub, client } = setup({ useTls: true });
    await internal.onReady();
    client.onFatal!(new NutError("FEATURE-NOT-CONFIGURED"));
    expect(logsOf(stub, "error").some(m => m.includes("TLS connection to NUT server 10.0.0.3:3493 failed"))).toBe(
      true,
    );
    expect(client.destroy).toHaveBeenCalledTimes(1);
  });
});

describe("discover", () => {
  it("registers all UPSes and runs both cleanups with the known-name set", async () => {
    const s = await setupConnected({}, [
      { name: "ups0", description: "Main" },
      { name: "ups1", description: "Backup" },
    ]);
    expect([...s.internal.discoveredUps.keys()]).toEqual(["ups0", "ups1"]);
    expect(s.sm.cleanupRemovedUps).toHaveBeenCalledWith(new Set(["ups0", "ups1"]));
    expect(s.sm.cleanupLegacyObjects).toHaveBeenCalledWith(new Set(["ups0", "ups1"]));
  });

  it("prunes stale failedUps/enrichedUps markers when a UPS disappears (v0.4.2)", async () => {
    const s = await setupConnected();
    // Markers for a UPS that the next discover no longer returns.
    s.internal.failedUps.add("ghost");
    s.internal.enrichedUps.add("ghost");
    s.internal.failedUps.add("ups0");

    await s.internal.discover();

    expect(s.internal.failedUps.has("ghost")).toBe(false);
    expect(s.internal.enrichedUps.has("ghost")).toBe(false);
    // Markers of still-present UPSes survive.
    expect(s.internal.failedUps.has("ups0")).toBe(true);
  });
});

describe("UPS name sanitization", () => {
  it("sanitizes forbidden UPS names into object IDs but uses the real name for the NUT protocol", async () => {
    const s = await setupConnected({ enableCommands: true, enableSetVar: true, username: "u", password: "p" }, [
      { name: "my ups!", description: "Weird UPS" },
    ]);
    // Object tree + cleanup work on the sanitized ID; discoveredUps is keyed on it.
    expect([...s.internal.discoveredUps.keys()]).toEqual(["my_ups_"]);
    expect(s.sm.ensureUpsDevice).toHaveBeenCalledWith("my_ups_", "Weird UPS");
    expect(s.sm.cleanupRemovedUps).toHaveBeenCalledWith(new Set(["my_ups_"]));
    // NUT protocol calls (poll) use the real, unsanitized name.
    expect(s.client.listVar).toHaveBeenCalledWith("my ups!");
    // Command buttons: LIST CMD uses the real name, buttons are created under the sanitized ID.
    expect(s.client.listCmd).toHaveBeenCalledWith("my ups!");
    expect(s.sm.createCommandButtons).toHaveBeenCalledWith("my_ups_", [{ name: "beeper.enable" }]);
    // A command targeting the sanitized object ID must reach NUT with the real name.
    await s.internal.onStateChange("nut2.0.my_ups_.commands.beeper-enable", { val: true, ack: false });
    expect(s.client.instCmd).toHaveBeenCalledWith("my ups!", "beeper.enable");
  });

  it("disambiguates two UPS names that collapse to the same object ID and warns", async () => {
    const s = await setupConnected({}, [
      { name: "u.p", description: "A" },
      { name: "u p", description: "B" },
    ]);
    expect([...s.internal.discoveredUps.keys()]).toEqual(["u_p", "u_p-2"]);
    expect(logsOf(s.stub, "warn").some(m => m.includes("collides"))).toBe(true);
  });
});

describe("classifyError", () => {
  it("maps NutError to its code, network codes to NETWORK, timeouts to TIMEOUT", async () => {
    const { internal } = setup();
    expect(internal.classifyError(new NutError("DATA-STALE"))).toBe("DATA-STALE");
    expect(internal.classifyError(Object.assign(new Error("x"), { code: "ECONNREFUSED" }))).toBe("NETWORK");
    expect(internal.classifyError(Object.assign(new Error("x"), { code: "EHOSTUNREACH" }))).toBe("NETWORK");
    expect(internal.classifyError(Object.assign(new Error("x"), { code: "ETIMEDOUT" }))).toBe("TIMEOUT");
    expect(internal.classifyError(new Error("NUT command timed out: LIST UPS"))).toBe("TIMEOUT");
    expect(internal.classifyError(Object.assign(new Error("x"), { code: "EWEIRD" }))).toBe("EWEIRD");
    expect(internal.classifyError(new Error("plain"))).toBe("UNKNOWN");
    expect(internal.classifyError("not an error")).toBe("UNKNOWN");
  });
});

describe("poll", () => {
  it("applies a valid RANGE bound but ignores a non-decimal one (strict parse, not parseFloat)", async () => {
    const s = await setupConnected({ enableSetVar: true });
    s.client.listRw.mockResolvedValue([{ name: "ups.delay.shutdown", value: "20" }]);
    s.client.listEnum.mockResolvedValue([]);
    s.client.listRange.mockResolvedValue([{ min: "50abc", max: "600" }]);
    s.internal.enrichedUps.clear();
    s.sm.enrichStateMetadata.mockClear();
    await s.internal.poll();
    expect(s.sm.enrichStateMetadata).toHaveBeenCalledWith(expect.any(String), { max: 600 });
  });

  it("does not query LIST RW or mark variables writable while SET VAR is disabled", async () => {
    const s = await setupConnected({ enableSetVar: false });
    s.client.listRw.mockResolvedValue([{ name: "ups.delay.shutdown", value: "20" }]);
    s.client.listRw.mockClear();
    s.sm.updateVariables.mockClear();
    await s.internal.poll();
    expect(s.client.listRw).not.toHaveBeenCalled();
    const lastCall = s.sm.updateVariables.mock.calls.at(-1);
    expect(lastCall?.[2]).toEqual(new Set());
  });

  it("updates variables, device name, status flags and reachable per UPS", async () => {
    const s = await setupConnected();
    s.sm.updateVariables.mockClear();
    await s.internal.poll();

    expect(s.sm.updateVariables).toHaveBeenCalledWith(
      "ups0",
      expect.arrayContaining([expect.objectContaining({ name: "ups.status" })]),
      new Set(),
    );
    expect(s.sm.updateStatusFlags).toHaveBeenCalledWith("ups0", "OL", undefined);
    expect(s.stub.states.get("nut2.0.ups0.info.reachable")).toEqual({ val: true, ack: true });
    expect(s.stub.states.get("nut2.0.info.connection")).toEqual({ val: true, ack: true });
  });

  it("passes battery.charger.status through to the status flags", async () => {
    const s = await setupConnected();
    s.client.listVar.mockResolvedValue([
      { name: "ups.status", value: "OL" },
      { name: "battery.charger.status", value: "charging" },
    ]);
    await s.internal.poll();
    expect(s.sm.updateStatusFlags).toHaveBeenCalledWith("ups0", "OL", "charging");
  });

  it("skips when the previous poll is still running (in-flight guard)", async () => {
    const s = await setupConnected();
    let release: () => void = () => {};
    s.client.listVar.mockImplementation(
      () => new Promise(resolve => (release = () => resolve([{ name: "ups.status", value: "OL" }]))),
    );
    const p1 = s.internal.poll();
    const p2 = s.internal.poll();
    release();
    await Promise.all([p1, p2]);
    expect(logsOf(s.stub, "debug").some(m => m.includes("previous poll still running"))).toBe(true);
  });

  it("LIST RW failure is non-critical — poll continues with no writable vars", async () => {
    const s = await setupConnected({ enableSetVar: true });
    s.client.listRw.mockRejectedValue(new Error("RW unsupported"));
    s.sm.updateVariables.mockClear();
    await s.internal.poll();
    expect(s.sm.updateVariables).toHaveBeenCalledWith("ups0", expect.anything(), new Set());
    expect(logsOf(s.stub, "warn")).toEqual([]);
  });

  it("per-UPS failure: reachable=false, warn once, debug on repeat, recovery info", async () => {
    const s = await setupConnected();
    s.client.listVar.mockRejectedValue(new Error("UPS gone"));

    await s.internal.poll();
    expect(s.stub.states.get("nut2.0.ups0.info.reachable")).toEqual({ val: false, ack: true });
    expect(logsOf(s.stub, "warn").filter(m => m.includes("Failed to poll UPS 'ups0'"))).toHaveLength(1);

    await s.internal.poll();
    // Repeat goes to debug — still exactly ONE warn.
    expect(logsOf(s.stub, "warn").filter(m => m.includes("Failed to poll UPS 'ups0'"))).toHaveLength(1);

    s.client.listVar.mockResolvedValue([{ name: "ups.status", value: "OL" }]);
    await s.internal.poll();
    expect(logsOf(s.stub, "info").some(m => m.includes("UPS 'ups0' recovered"))).toBe(true);
    expect(s.stub.states.get("nut2.0.ups0.info.reachable")).toEqual({ val: true, ack: true });
  });

  it("DATA-STALE gets its own friendly warning (states kept)", async () => {
    const s = await setupConnected();
    s.client.listVar.mockRejectedValue(new NutError("DATA-STALE"));
    await s.internal.poll();
    expect(logsOf(s.stub, "warn").some(m => m.includes("driver reports stale data"))).toBe(true);
  });

  it("enriches enum/range metadata exactly once per connection", async () => {
    const s = await setupConnected({ enableSetVar: true });
    s.client.listRw.mockResolvedValue([{ name: "ups.delay.shutdown", value: "20" }]);
    s.client.listEnum.mockResolvedValue(["20", "30"]);
    s.client.listRange.mockResolvedValue([{ min: "10", max: "300" }]);
    s.internal.enrichedUps.clear();
    s.sm.enrichStateMetadata.mockClear();

    await s.internal.poll();
    const callsAfterFirst = s.sm.enrichStateMetadata.mock.calls.length;
    expect(callsAfterFirst).toBeGreaterThan(0);
    expect(s.sm.enrichStateMetadata).toHaveBeenCalledWith("ups0.ups.delay-shutdown", {
      states: { "20": "20", "30": "30" },
    });
    expect(s.sm.enrichStateMetadata).toHaveBeenCalledWith("ups0.ups.delay-shutdown", { min: 10, max: 300 });

    await s.internal.poll();
    expect(s.sm.enrichStateMetadata.mock.calls.length).toBe(callsAfterFirst);
  });

  it("does not put yes/no enum states on a boolean writable var (they are booleans, not enums)", async () => {
    // A writable yes/no var (ups.start.auto) is a boolean state; its LIST ENUM yes/no must not be
    // pushed as common.states — a string-keyed {yes,no} map is meaningless on a boolean.
    const s = await setupConnected({ enableSetVar: true });
    s.client.listRw.mockResolvedValue([{ name: "ups.start.auto", value: "yes" }]);
    s.client.listEnum.mockResolvedValue(["yes", "no"]);
    s.client.listRange.mockResolvedValue([]);
    s.internal.enrichedUps.clear();
    s.sm.enrichStateMetadata.mockClear();

    await s.internal.poll();
    expect(s.sm.enrichStateMetadata).not.toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ states: expect.anything() }),
    );
  });

  it("gates info.connection on the client connection, not on the loop having run", async () => {
    const s = await setupConnected();
    s.client.isConnected = false; // server dropped; per-UPS errors are swallowed in the loop
    s.client.listVar.mockRejectedValue(new Error("conn lost"));
    await s.internal.poll();
    expect(s.stub.states.get("nut2.0.info.connection")).toEqual({ val: false, ack: true });
  });

  it("whole-poll failure: classify, warn once for NETWORK, restore info on recovery", async () => {
    const s = await setupConnected();
    // Force a failure OUTSIDE the per-UPS loop: setStateChangedAsync for info.connection throws…
    // simpler: make discoveredUps iteration throw via a poisoned client on the outer await.
    s.internal.discoveredUps.clear();
    const poison = Object.assign(new Error("connect ECONNREFUSED"), { code: "ECONNREFUSED" });
    const stubAdapter = s.adapter as unknown as {
      setStateChangedAsync: (id: string, state: { val: unknown; ack?: boolean }) => Promise<void>;
    };
    const original = stubAdapter.setStateChangedAsync.bind(stubAdapter);
    let shouldThrow = true;
    stubAdapter.setStateChangedAsync = async (id, state) => {
      // Poison only the SUCCESS-path write (val=true) — the catch handler's
      // val=false write must go through, like a broker that fails the call
      // because the underlying connection is gone.
      if (shouldThrow && id.includes("info.connection") && state.val === true) {
        throw poison;
      }
      return original(id, state);
    };

    await s.internal.poll();
    expect(logsOf(s.stub, "warn").some(m => m.includes("Cannot reach NUT server"))).toBe(true);
    expect(s.internal.lastErrorCode).toBe("NETWORK");

    await s.internal.poll();
    // Repeat of the same class → debug, no second warn.
    expect(logsOf(s.stub, "warn").filter(m => m.includes("Cannot reach NUT server"))).toHaveLength(1);

    shouldThrow = false;
    await s.internal.poll();
    expect(logsOf(s.stub, "info").some(m => m === "Connection restored")).toBe(true);
    expect(s.internal.lastErrorCode).toBe("");
  });
});

describe("onStateChange — command and SET VAR gates", () => {
  it("ignores acked/null states and unknown UPS ids", async () => {
    const s = await setupConnected({ enableCommands: true, enableSetVar: true });
    await s.internal.onStateChange("nut2.0.ups0.commands.beeper-enable", { val: true, ack: true });
    await s.internal.onStateChange("nut2.0.ups0.commands.beeper-enable", null);
    await s.internal.onStateChange("nut2.0.ghost.commands.beeper-enable", { val: true, ack: false });
    expect(s.client.instCmd).not.toHaveBeenCalled();
    // A state of a UPS that is gone (renamed, unplugged, removed from the NUT
    // server) is a normal event — it must stay a debug line. An error entry
    // sends whoever reads the log hunting a fault that does not exist.
    expect(logsOf(s.stub, "error")).toEqual([]);
    expect(logsOf(s.stub, "debug").some(m => m.includes("unknown UPS"))).toBe(true);
  });

  it("executes a command (dashes→dots), resets the button and logs", async () => {
    const s = await setupConnected({ enableCommands: true });
    await s.internal.onStateChange("nut2.0.ups0.commands.test-battery-start", { val: true, ack: false });
    expect(s.client.instCmd).toHaveBeenCalledWith("ups0", "test.battery.start");
    expect(s.stub.states.get("nut2.0.ups0.commands.test-battery-start")).toEqual({ val: false, ack: true });
    expect(logsOf(s.stub, "info").some(m => m.includes("Command executed: test.battery.start"))).toBe(true);
  });

  it("blocks commands when enableCommands is off", async () => {
    const s = await setupConnected({ enableCommands: false });
    await s.internal.onStateChange("nut2.0.ups0.commands.load-off", { val: true, ack: false });
    expect(s.client.instCmd).not.toHaveBeenCalled();
    expect(logsOf(s.stub, "warn").some(m => m.includes("Command blocked"))).toBe(true);
  });

  it("a failing command logs an error and STILL resets the button", async () => {
    const s = await setupConnected({ enableCommands: true });
    s.client.instCmd.mockRejectedValue(new NutError("INSTCMD-FAILED"));
    await s.internal.onStateChange("nut2.0.ups0.commands.load-off", { val: true, ack: false });
    expect(logsOf(s.stub, "error").some(m => m.includes("Command failed: load.off"))).toBe(true);
    expect(s.stub.states.get("nut2.0.ups0.commands.load-off")).toEqual({ val: false, ack: true });
  });

  it("SET VAR: reconstructs the variable name (dashes→dots) and acks on success", async () => {
    const s = await setupConnected({ enableSetVar: true });
    await s.internal.onStateChange("nut2.0.ups0.ups.delay-shutdown", { val: 30, ack: false });
    expect(s.client.setVar).toHaveBeenCalledWith("ups0", "ups.delay.shutdown", "30");
    expect(s.stub.states.get("nut2.0.ups0.ups.delay-shutdown")).toEqual({ val: 30, ack: true });
  });

  it("SET VAR: uses the stored NUT name so a literal dash survives (three-phase)", async () => {
    const s = await setupConnected({ enableSetVar: true });
    s.sm.nutNameForState.mockReturnValue("input.L1-L2.voltage");
    await s.internal.onStateChange("nut2.0.ups0.input.L1-L2-voltage", { val: 247, ack: false });
    expect(s.client.setVar).toHaveBeenCalledWith("ups0", "input.L1-L2.voltage", "247");
  });

  it("SET VAR: writes a yes/no boolean back as 'yes'/'no', not 'true'/'false'", async () => {
    // ups.start.auto/.battery/.reboot are RW yes/no variables on many drivers (mge-hid, delta,
    // eaton, voltronic) → detectType makes them boolean switches. Writing must translate the
    // boolean to the yes/no token NUT expects; String(true) = "true" would be rejected.
    const s = await setupConnected({ enableSetVar: true });
    s.sm.nutNameForState.mockReturnValue("ups.start.auto");

    await s.internal.onStateChange("nut2.0.ups0.ups.start-auto", { val: false, ack: false });
    expect(s.client.setVar).toHaveBeenCalledWith("ups0", "ups.start.auto", "no");

    s.client.setVar.mockClear();
    await s.internal.onStateChange("nut2.0.ups0.ups.start-auto", { val: true, ack: false });
    expect(s.client.setVar).toHaveBeenCalledWith("ups0", "ups.start.auto", "yes");
  });

  it("INSTCMD: uses the stored NUT name rather than reversing the id", async () => {
    const s = await setupConnected({ enableCommands: true });
    s.sm.nutNameForState.mockReturnValue("beeper.disable");
    await s.internal.onStateChange("nut2.0.ups0.commands.beeper-mute", { val: true, ack: false });
    expect(s.client.instCmd).toHaveBeenCalledWith("ups0", "beeper.disable");
  });

  it("blocks SET VAR when enableSetVar is off", async () => {
    const s = await setupConnected({ enableSetVar: false });
    await s.internal.onStateChange("nut2.0.ups0.ups.delay-shutdown", { val: 30, ack: false });
    expect(s.client.setVar).not.toHaveBeenCalled();
    expect(logsOf(s.stub, "warn").some(m => m.includes("SET VAR blocked"))).toBe(true);
  });

  it("a failing SET VAR logs an error and does NOT ack", async () => {
    const s = await setupConnected({ enableSetVar: true });
    s.client.setVar.mockRejectedValue(new NutError("SET-FAILED"));
    await s.internal.onStateChange("nut2.0.ups0.ups.delay-shutdown", { val: 30, ack: false });
    expect(logsOf(s.stub, "error").some(m => m.includes("SET VAR failed"))).toBe(true);
    expect(s.stub.states.has("nut2.0.ups0.ups.delay-shutdown")).toBe(false);
  });

  it("ignores writes with an unexpected id structure", async () => {
    const s = await setupConnected({ enableSetVar: true });
    await s.internal.onStateChange("nut2.0.shallow", { val: 1, ack: false });
    expect(s.client.setVar).not.toHaveBeenCalled();
  });
});

describe("onUnload", () => {
  it("clears the timer, shuts down gracefully when authenticated, destroys test clients", async () => {
    const s = await setupConnected({ username: "u", password: "p" });
    const testClient = { destroy: vi.fn() };
    s.internal.testClients.add(testClient);
    const callback = vi.fn();

    s.internal.onUnload(callback);

    expect(callback).toHaveBeenCalledTimes(1);
    expect(s.client.shutdown).toHaveBeenCalledTimes(1); // graceful LOGOUT path
    expect(s.client.destroy).not.toHaveBeenCalled();
    expect(testClient.destroy).toHaveBeenCalledTimes(1);
    expect(s.internal.testClients.size).toBe(0);
    expect(s.stub.states.get("nut2.0.info.connection")).toEqual({ val: false, ack: true });
  });

  it("hard-destroys when not authenticated", async () => {
    const s = await setupConnected();
    const callback = vi.fn();
    s.internal.onUnload(callback);
    expect(s.client.destroy).toHaveBeenCalledTimes(1);
    expect(s.client.shutdown).not.toHaveBeenCalled();
    expect(callback).toHaveBeenCalledTimes(1);
  });

  it("calls the callback even when teardown throws", async () => {
    const s = await setupConnected();
    s.client.destroy.mockImplementation(() => {
      throw new Error("teardown exploded");
    });
    const callback = vi.fn();
    s.internal.onUnload(callback);
    expect(callback).toHaveBeenCalledTimes(1);
  });
});
