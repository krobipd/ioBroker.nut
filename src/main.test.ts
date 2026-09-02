/**
 * Orchestration tests for main.ts — onReady wiring, the idempotent onConnected
 * setup (auth-failure → yellow, command buttons, timer arming), the poll matrix
 * (per-UPS error dedup, DATA-STALE, one-shot enrichment, connection gating),
 * classifyError, onStateChange command/SET-VAR gates and onUnload.
 *
 * Fleet harness pattern: `@iobroker/adapter-core` is mocked with a stub Adapter
 * class; the NutClient and StateManager are injected as fakes through the
 * factory seams (makeClient/makeStateManager) — their real implementations are
 * covered by their own suites against real sockets / the preserve-aware mock.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
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

    setState(id: string, state: { val: unknown; ack?: boolean }): Promise<void> {
      this.states.set(this.fullId(id), { val: state.val, ack: state.ack ?? false });
      return Promise.resolve();
    }

    setStateChangedAsync(id: string, state: { val: unknown; ack?: boolean }): Promise<void> {
      this.states.set(this.fullId(id), { val: state.val, ack: state.ack ?? false });
      return Promise.resolve();
    }

    subscribeStatesAsync(pattern: string): Promise<void> {
      this.subscriptions.push(pattern);
      return Promise.resolve();
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

    getForeignObjectAsync = vi.fn((_id: string): Promise<unknown> => Promise.resolve(null));
    extendForeignObjectAsync = vi.fn(async (_id: string, _obj: unknown): Promise<void> => {});

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
  getForeignObjectAsync: ReturnType<typeof vi.fn>;
  extendForeignObjectAsync: ReturnType<typeof vi.fn>;
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
    listUps: vi.fn(() => Promise.resolve(upsList)),
    listVar: vi.fn((): Promise<NutVariable[]> =>
      Promise.resolve([
        { name: "battery.charge", value: "100" },
        { name: "ups.status", value: "OL" },
      ]),
    ),
    listRw: vi.fn((): Promise<NutVariable[]> => Promise.resolve([])),
    listCmd: vi.fn(() => Promise.resolve([{ name: "beeper.enable" }])),
    listEnum: vi.fn(() => Promise.resolve([])),
    listRange: vi.fn(() => Promise.resolve([])),
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
  markAllUnreachable: ReturnType<typeof vi.fn>;
  writeUpsSummary: ReturnType<typeof vi.fn>;
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
    markAllUnreachable: vi.fn(async () => {}),
    writeUpsSummary: vi.fn(async () => {}),
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
  warnedNotifyRefs: Set<string>;
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

/**
 * onReady + simulate the client's connect callback (the unified loop firing).
 *
 * @param config Instance settings that replace the base config
 * @param upsList UPS list the fake client reports, defaults to one UPS
 */
async function setupConnected(config: Partial<typeof BASE_CONFIG> = {}, upsList?: UpsInfo[]): Promise<Setup> {
  const s = setup(config, upsList);
  await s.internal.onReady();
  expect(s.client.start).toHaveBeenCalledTimes(1);
  await s.internal.onConnected();
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

  it("clears the online indicators before the first connect (a hard kill leaves them stale)", async () => {
    const { internal, sm } = setup();
    await internal.onReady();
    expect(sm.markAllUnreachable).toHaveBeenCalledTimes(1);
  });

  it("clears the online indicators even when no host is configured", async () => {
    const { internal, sm } = setup({ host: "" });
    await internal.onReady();
    expect(sm.markAllUnreachable).toHaveBeenCalledTimes(1);
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

  it("subscribes the wildcard exactly once and only when commands or SET VAR are enabled", async () => {
    // The notify trigger subscription from onReady is always there; the wildcard only for writes.
    const off = await setupConnected();
    expect(off.stub.subscriptions).toEqual(["notify"]);

    const on = await setupConnected({ enableSetVar: true });
    await on.internal.onConnected();
    expect(on.stub.subscriptions).toEqual(["notify", "*"]);
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
    expect(logsOf(stub, "error").some(m => m.includes("TLS connection to NUT server 10.0.0.3:3493 failed"))).toBe(true);
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
  it("maps NutError to its code, network codes to NETWORK, timeouts to TIMEOUT", () => {
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
    // The poll checks LIST UPS before LIST VAR — release only once it really is inside LIST VAR.
    await vi.waitFor(() => expect(s.client.listVar).toHaveBeenCalled());
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
      states: { 20: "20", 30: "30" },
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

describe("UPS list changes on the NUT server at runtime", () => {
  it("an unchanged list runs no discovery and creates nothing again", async () => {
    const s = await setupConnected();
    s.sm.ensureUpsDevice.mockClear();
    s.sm.cleanupRemovedUps.mockClear();
    await s.internal.poll();
    await s.internal.poll();
    expect(s.sm.ensureUpsDevice).not.toHaveBeenCalled();
    expect(s.sm.cleanupRemovedUps).not.toHaveBeenCalled();
    expect(logsOf(s.stub, "info").some(m => m.includes("UPS list on the NUT server changed"))).toBe(false);
  });

  it("a UPS added on the server appears on the next poll, with its command buttons", async () => {
    const s = await setupConnected({ enableCommands: true, username: "u", password: "p" });
    s.sm.createCommandButtons.mockClear();
    s.client.listUps.mockResolvedValue([
      { name: "ups0", description: "Main UPS" },
      { name: "ups1", description: "New UPS" },
    ]);
    await s.internal.poll();
    expect([...s.internal.discoveredUps.keys()]).toEqual(["ups0", "ups1"]);
    expect(s.sm.ensureUpsDevice).toHaveBeenCalledWith("ups1", "New UPS");
    expect(s.sm.createCommandButtons).toHaveBeenCalledWith("ups1", expect.anything());
    expect(s.stub.states.get("nut2.0.ups1.info.reachable")).toEqual({ val: true, ack: true });
    expect(logsOf(s.stub, "info").some(m => m.includes("UPS list on the NUT server changed: ups0, ups1"))).toBe(true);
  });

  it("a UPS removed on the server is cleaned up on the next poll", async () => {
    const s = await setupConnected({}, [
      { name: "ups0", description: "Main UPS" },
      { name: "ups1", description: "Second UPS" },
    ]);
    s.client.listUps.mockResolvedValue([{ name: "ups0", description: "Main UPS" }]);
    await s.internal.poll();
    expect([...s.internal.discoveredUps.keys()]).toEqual(["ups0"]);
    expect(s.sm.cleanupRemovedUps).toHaveBeenLastCalledWith(new Set(["ups0"]));
    expect(s.sm.writeUpsSummary).toHaveBeenLastCalledWith(1, 1);
  });

  it("a LIST UPS failure fails the poll as a whole (no half-updated tree)", async () => {
    const s = await setupConnected();
    s.client.listUps.mockRejectedValue(Object.assign(new Error("x"), { code: "ECONNRESET" }));
    await s.internal.poll();
    expect(s.client.listVar).toHaveBeenCalledTimes(1); // only the initial poll in setupConnected
    expect(s.stub.states.get("nut2.0.ups0.info.reachable")).toEqual({ val: false, ack: true });
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

  it("ignores writes to the adapter-owned info/status channels instead of trying SET VAR", async () => {
    const s = await setupConnected({ enableSetVar: true, enableCommands: true });
    await s.internal.onStateChange("nut2.0.ups0.info.notify", { val: "ONBATT", ack: false });
    await s.internal.onStateChange("nut2.0.ups0.info.reachable", { val: true, ack: false });
    await s.internal.onStateChange("nut2.0.ups0.status.online", { val: false, ack: false });
    expect(s.client.setVar).not.toHaveBeenCalled();
    expect(s.client.instCmd).not.toHaveBeenCalled();
    expect(logsOf(s.stub, "error")).toEqual([]);
    expect(logsOf(s.stub, "debug").filter(m => m.includes("adapter-owned"))).toHaveLength(3);
  });

  it("SET VAR: a null or object value never reaches the wire (warn, no write, no ack)", async () => {
    const s = await setupConnected({ enableSetVar: true });
    await s.internal.onStateChange("nut2.0.ups0.ups.delay-shutdown", { val: null, ack: false });
    await s.internal.onStateChange("nut2.0.ups0.ups.delay-shutdown", { val: { a: 1 }, ack: false });
    expect(s.client.setVar).not.toHaveBeenCalled();
    expect(s.stub.states.get("nut2.0.ups0.ups.delay-shutdown")).toBeUndefined();
    const warns = logsOf(s.stub, "warn").filter(m => m.includes("SET VAR ignored"));
    expect(warns).toHaveLength(2);
    expect(warns[0]).toContain("null");
  });

  it("ignores writes with an unexpected id structure", async () => {
    const s = await setupConnected({ enableSetVar: true });
    await s.internal.onStateChange("nut2.0.shallow", { val: 1, ack: false });
    expect(s.client.setVar).not.toHaveBeenCalled();
  });
});

describe("notify trigger — the upsmon doorbell", () => {
  it("subscribes the trigger in onReady, even on a misconfigured instance", async () => {
    // The doorbell must exist before (and independent of) any successful connect —
    // with the NUT server down, a write still has to be received and recorded.
    const { internal, stub } = setup({ host: "" });
    await internal.onReady();
    expect(stub.subscriptions).toContain("notify");
  });

  it("records the event on the matched UPS, acks the trigger and polls", async () => {
    const s = await setupConnected();
    s.client.listVar.mockClear();

    await s.internal.onStateChange("nut2.0.notify", { val: "ONBATT ups0", ack: false });

    expect(s.stub.states.get("nut2.0.ups0.info.notify")).toEqual({ val: "ONBATT", ack: true });
    expect(s.stub.states.get("nut2.0.notify")).toEqual({ val: "ONBATT ups0", ack: true });
    expect(s.client.listVar).toHaveBeenCalled();
    expect(logsOf(s.stub, "info").some(m => m.includes("upsmon event 'ONBATT'"))).toBe(true);
  });

  it("matches the real NUT name (with @host) even when the object ID is sanitized", async () => {
    const s = await setupConnected({}, [{ name: "my ups!", description: "Weird UPS" }]);

    await s.internal.onStateChange("nut2.0.notify", { val: "LOWBATT my ups!@nas.local", ack: false });

    expect(s.stub.states.get("nut2.0.my_ups_.info.notify")).toEqual({ val: "LOWBATT", ack: true });
  });

  it("matches the sanitized object ID as well", async () => {
    const s = await setupConnected({}, [{ name: "my ups!", description: "Weird UPS" }]);

    await s.internal.onStateChange("nut2.0.notify", { val: "LOWBATT my_ups_", ack: false });

    expect(s.stub.states.get("nut2.0.my_ups_.info.notify")).toEqual({ val: "LOWBATT", ack: true });
  });

  it("unknown UPS reference: polls everything, warns once, acks — no device write", async () => {
    const s = await setupConnected();
    s.client.listVar.mockClear();

    await s.internal.onStateChange("nut2.0.notify", { val: "ONBATT ghost", ack: false });
    await s.internal.onStateChange("nut2.0.notify", { val: "ONLINE ghost", ack: false });

    expect(s.client.listVar).toHaveBeenCalled();
    expect(s.stub.states.has("nut2.0.ghost.info.notify")).toBe(false);
    expect(s.stub.states.get("nut2.0.notify")).toEqual({ val: "ONLINE ghost", ack: true });
    // Warn once per unknown name — the repeat goes to debug.
    expect(logsOf(s.stub, "warn").filter(m => m.includes("unknown UPS 'ghost'"))).toHaveLength(1);
  });

  it("an empty write is a bare manual refresh: poll yes, event no, info-noise no", async () => {
    const s = await setupConnected();
    s.client.listVar.mockClear();
    const infoBefore = logsOf(s.stub, "info").length;

    await s.internal.onStateChange("nut2.0.notify", { val: "", ack: false });

    expect(s.client.listVar).toHaveBeenCalled();
    expect(s.stub.states.get("nut2.0.notify")).toEqual({ val: "", ack: true });
    expect(s.stub.states.has("nut2.0.ups0.info.notify")).toBe(false);
    expect(logsOf(s.stub, "info").length).toBe(infoBefore);
  });

  it("acks the trigger with the normalised text, not the raw write", async () => {
    const s = await setupConnected();
    await s.internal.onStateChange("nut2.0.notify", { val: "  ONBATT   ups0@nas  ", ack: false });
    expect(s.stub.states.get("nut2.0.notify")).toEqual({ val: "ONBATT   ups0@nas", ack: true });
    // An object pushed through the REST API is no trigger value — the echo is an empty string,
    // never "[object Object]" and never the object itself in a string state.
    await s.internal.onStateChange("nut2.0.notify", { val: { evil: 1 }, ack: false });
    expect(s.stub.states.get("nut2.0.notify")).toEqual({ val: "", ack: true });
    const blob = "Y".repeat(600);
    await s.internal.onStateChange("nut2.0.notify", { val: blob, ack: false });
    expect((s.stub.states.get("nut2.0.notify")!.val as string).length).toBe(200);
  });

  it("ignores its own ack echo", async () => {
    const s = await setupConnected();
    s.client.listVar.mockClear();

    await s.internal.onStateChange("nut2.0.notify", { val: "ONBATT", ack: true });

    expect(s.client.listVar).not.toHaveBeenCalled();
  });

  it("an event during a running poll queues exactly one follow-up poll", async () => {
    const s = await setupConnected();
    const resolvers: Array<(vars: NutVariable[]) => void> = [];
    s.client.listVar.mockImplementation(() => new Promise<NutVariable[]>(res => resolvers.push(res)));
    s.client.listVar.mockClear();

    const running = s.internal.poll();
    await vi.waitFor(() => expect(s.client.listVar).toHaveBeenCalledTimes(1));
    // The poll is now stuck inside LIST VAR; the doorbell rings twice meanwhile.
    const n1 = s.internal.onStateChange("nut2.0.notify", { val: "ONBATT ups0", ack: false });
    const n2 = s.internal.onStateChange("nut2.0.notify", { val: "LOWBATT ups0", ack: false });
    expect(s.client.listVar).toHaveBeenCalledTimes(1);

    resolvers[0]([{ name: "ups.status", value: "OB" }]);
    await running;
    await Promise.all([n1, n2]);
    // Exactly ONE follow-up poll for both rings together.
    await vi.waitFor(() => expect(s.client.listVar).toHaveBeenCalledTimes(2));
    resolvers[1]([{ name: "ups.status", value: "OB LB" }]);
    // Both events were still recorded individually.
    expect(s.stub.states.get("nut2.0.ups0.info.notify")).toEqual({ val: "LOWBATT", ack: true });
  });

  it("a follow-up queued during a poll is dropped when the adapter unloads before that poll ends", async () => {
    const s = await setupConnected();
    const resolvers: Array<(vars: NutVariable[]) => void> = [];
    s.client.listVar.mockImplementation(() => new Promise<NutVariable[]>(res => resolvers.push(res)));
    s.client.listVar.mockClear();
    s.client.listUps.mockClear();

    const running = s.internal.poll();
    await vi.waitFor(() => expect(s.client.listVar).toHaveBeenCalledTimes(1));
    const ring = s.internal.onStateChange("nut2.0.notify", { val: "SHUTDOWN ups0", ack: false });
    await ring; // queued as a follow-up — the poll is still inside LIST VAR
    // The host stops the instance while that poll is still running.
    const callback = vi.fn();
    s.internal.onUnload(callback);
    await vi.waitFor(() => expect(callback).toHaveBeenCalledTimes(1));
    const listUpsCalls = s.client.listUps.mock.calls.length;

    resolvers[0]([{ name: "ups.status", value: "OB" }]);
    await running;
    await new Promise(r => setImmediate(r));
    // No second poll after the shutdown: it would run against the torn-down client and write
    // states after the host was already told "done".
    expect(s.client.listUps).toHaveBeenCalledTimes(listUpsCalls);
    expect(s.client.listVar).toHaveBeenCalledTimes(1);
  });

  it("without a client (server never reached) the event is still recorded and acked", async () => {
    const { internal, stub } = setup({ host: "" });
    await internal.onReady();
    const errorsFromSetup = logsOf(stub, "error").length; // the legitimate "host is required"

    await internal.onStateChange("nut2.0.notify", { val: "SHUTDOWN", ack: false });

    expect(stub.states.get("nut2.0.notify")).toEqual({ val: "SHUTDOWN", ack: true });
    expect(logsOf(stub, "error").length).toBe(errorsFromSetup);
  });

  it("records the event and acks BEFORE polling, so a dying NUT host cannot swallow it", async () => {
    const s = await setupConnected();
    s.client.listVar.mockRejectedValue(new Error("host is going down"));

    await s.internal.onStateChange("nut2.0.notify", { val: "SHUTDOWN ups0", ack: false });

    expect(s.stub.states.get("nut2.0.ups0.info.notify")).toEqual({ val: "SHUTDOWN", ack: true });
    expect(s.stub.states.get("nut2.0.notify")).toEqual({ val: "SHUTDOWN ups0", ack: true });
  });

  it("the unknown-name warn-dedup set stays bounded under a flood of distinct names", async () => {
    // The set is fed by an external write (upsmon / anyone with write access). Without a cap it
    // would grow one entry per distinct unknown UPS name for the whole adapter lifetime.
    const s = await setupConnected();
    for (let i = 0; i < 300; i++) {
      await s.internal.onStateChange("nut2.0.notify", { val: `ONBATT ghost-${i}`, ack: false });
    }
    expect(s.internal.warnedNotifyRefs.size).toBeLessThanOrEqual(100);
  });
});

describe("onUnload", () => {
  it("clears the timer, shuts down gracefully when authenticated, destroys test clients", async () => {
    const s = await setupConnected({ username: "u", password: "p" });
    const testClient = { destroy: vi.fn() };
    s.internal.testClients.add(testClient);
    const callback = vi.fn();

    s.internal.onUnload(callback);
    await vi.waitFor(() => expect(callback).toHaveBeenCalledTimes(1));

    expect(s.client.shutdown).toHaveBeenCalledTimes(1); // graceful LOGOUT path
    expect(s.client.destroy).not.toHaveBeenCalled();
    expect(testClient.destroy).toHaveBeenCalledTimes(1);
    expect(s.internal.testClients.size).toBe(0);
    expect(s.stub.states.get("nut2.0.info.connection")).toEqual({ val: false, ack: true });
  });

  it("marks every discovered UPS unreachable so a stopped adapter stops showing it online", async () => {
    const s = await setupConnected();
    s.stub.states.set("nut2.0.ups0.info.reachable", { val: true, ack: true });

    s.internal.onUnload(vi.fn());

    expect(s.stub.states.get("nut2.0.ups0.info.reachable")).toEqual({ val: false, ack: true });
  });

  it("hard-destroys when not authenticated", async () => {
    const s = await setupConnected();
    const callback = vi.fn();
    s.internal.onUnload(callback);
    await vi.waitFor(() => expect(callback).toHaveBeenCalledTimes(1));
    expect(s.client.destroy).toHaveBeenCalledTimes(1);
    expect(s.client.shutdown).not.toHaveBeenCalled();
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

describe("UPS summary through the whole life cycle", () => {
  it("reports how many UPSes answered after a poll", async () => {
    const s = await setupConnected({}, [
      { name: "ups0", description: "One" },
      { name: "ups1", description: "Two" },
    ]);
    s.sm.writeUpsSummary.mockClear();

    await s.internal.poll();

    expect(s.sm.writeUpsSummary).toHaveBeenLastCalledWith(2, 2);
  });

  it("counts a UPS that stopped answering as not reachable", async () => {
    const s = await setupConnected({}, [
      { name: "ups0", description: "One" },
      { name: "ups1", description: "Two" },
    ]);
    s.client.listVar.mockImplementation((ups: string) => {
      if (ups === "ups1") {
        return Promise.reject(new Error("no answer"));
      }
      return Promise.resolve([{ name: "ups.status", value: "OL" }]);
    });
    s.sm.writeUpsSummary.mockClear();

    await s.internal.poll();

    expect(s.sm.writeUpsSummary).toHaveBeenLastCalledWith(2, 1);
  });

  it("drops the summary to zero when the whole poll fails", async () => {
    const s = await setupConnected();
    s.client.listVar.mockRejectedValue(new Error("server gone"));
    s.client.isConnected = false;
    s.sm.writeUpsSummary.mockClear();

    await s.internal.poll();

    expect(s.sm.writeUpsSummary).toHaveBeenLastCalledWith(1, 0);
  });

  it("takes the summary down when the adapter stops", async () => {
    const s = await setupConnected();
    const callback = vi.fn();

    s.internal.onUnload(callback);
    await vi.waitFor(() => expect(callback).toHaveBeenCalledTimes(1));

    expect(s.stub.states.get("nut2.0.info.upsReachable")).toEqual({ val: 0, ack: true });
    expect(s.stub.states.get("nut2.0.info.allUpsReachable")).toEqual({ val: false, ack: true });
    // How many UPSes exist did not change just because the adapter is off.
    expect(s.stub.states.has("nut2.0.info.upsTotal")).toBe(false);
  });
});

describe("shutdown contract", () => {
  it("the manifest must not declare stopInstance, or none of this runs at all", () => {
    // With the entry the host kills the process one second after asking it to stop —
    // onUnload never runs and every state written while shutting down is dead code.
    // A property of the MANIFEST, so only a test can defend it.
    const manifest = JSON.parse(readFileSync(join(__dirname, "..", "io-package.json"), "utf8")) as {
      common: { supportedMessages?: Record<string, unknown> };
    };
    expect(manifest.common.supportedMessages?.stopInstance).toBeUndefined();
  });

  it("tells the controller we are done only AFTER the last state was written", async () => {
    const s = await setupConnected();
    const order: string[] = [];
    // Resolves on a LATER turn of the event loop, like a real database round trip — an
    // immediately-resolving stub would record the write synchronously and the test would
    // pass even with the callback fired first.
    (s.stub as unknown as { setState: (id: string, v: unknown) => Promise<void> }).setState = (id: string) =>
      new Promise<void>(resolve =>
        setTimeout(() => {
          order.push(`write:${id}`);
          resolve();
        }, 0),
      );
    const callback = vi.fn(() => order.push("callback"));

    s.internal.onUnload(callback);
    await vi.waitFor(() => expect(callback).toHaveBeenCalledTimes(1));

    expect(order[order.length - 1]).toBe("callback");
    expect(order).toContain("write:info.connection");
    expect(order).toContain("write:ups0.info.reachable");
  });

  it("switches off a leftover stopInstance flag and stops the start there", async () => {
    const s = setup();
    s.stub.getForeignObjectAsync.mockResolvedValue({
      common: { supportedMessages: { stopInstance: true } },
    });

    await s.internal.onReady();

    expect(s.stub.extendForeignObjectAsync).toHaveBeenCalledWith("system.adapter.nut2.0", {
      common: { supportedMessages: { stopInstance: false } },
    });
    // Carrying on would arm timers in a process the host is already shutting down.
    expect(s.client.start).not.toHaveBeenCalled();
    expect(s.sm.markAllUnreachable).not.toHaveBeenCalled();
  });

  it("starts normally when the flag is already off", async () => {
    const s = setup();
    s.stub.getForeignObjectAsync.mockResolvedValue({
      common: { supportedMessages: { stopInstance: false } },
    });

    await s.internal.onReady();

    expect(s.stub.extendForeignObjectAsync).not.toHaveBeenCalled();
    expect(s.client.start).toHaveBeenCalledTimes(1);
  });
});

describe("device markers follow a wholesale poll failure", () => {
  it("marks every UPS unreachable when the poll fails as a whole", async () => {
    const s = await setupConnected();
    // A failure OUTSIDE the per-UPS loop (the states DB, not one device).
    s.stub.states.clear();
    const original = s.internal.stateManager!;
    (original as unknown as { updateVariables: unknown }).updateVariables = vi.fn(async () => {});
    s.client.listVar.mockResolvedValue([{ name: "ups.status", value: "OL" }]);
    s.sm.writeUpsSummary.mockRejectedValueOnce(new Error("states db gone"));

    await s.internal.poll();

    expect(s.stub.states.get("nut2.0.ups0.info.reachable")).toEqual({ val: false, ack: true });
    expect(s.sm.writeUpsSummary).toHaveBeenLastCalledWith(1, 0);
  });
});

describe("the whole chain agrees in every state", () => {
  it("marks the UPSes unreachable when authentication fails on a reconnect", async () => {
    const s = await setupConnected({ username: "u", password: "p" });
    // First connect worked — the UPS is green and counted.
    expect(s.stub.states.get("nut2.0.ups0.info.reachable")).toEqual({ val: true, ack: true });
    s.sm.writeUpsSummary.mockClear();
    s.client.authenticate.mockRejectedValue(new Error("ACCESS-DENIED"));

    await s.internal.onConnected();

    expect(s.stub.states.get("nut2.0.info.connection")).toEqual({ val: false, ack: true });
    expect(s.stub.states.get("nut2.0.ups0.info.reachable")).toEqual({ val: false, ack: true });
    expect(s.sm.writeUpsSummary).toHaveBeenLastCalledWith(1, 0);
  });

  it("marks the UPSes unreachable when the encrypted connection fails fatally", async () => {
    const s = await setupConnected();
    s.sm.writeUpsSummary.mockClear();

    s.client.onFatal!(new Error("FEATURE-NOT-CONFIGURED"));
    await vi.waitFor(() => expect(s.sm.writeUpsSummary).toHaveBeenCalled());

    expect(s.stub.states.get("nut2.0.info.connection")).toEqual({ val: false, ack: true });
    expect(s.stub.states.get("nut2.0.ups0.info.reachable")).toEqual({ val: false, ack: true });
    expect(s.sm.writeUpsSummary).toHaveBeenLastCalledWith(1, 0);
  });
});
