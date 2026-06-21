import type { NutClient } from "./nut-client";
import { dispatchMessage, type MessageRouterDeps } from "./message-router";
import type { NutClientOptions } from "./types";

interface SentMessage {
  from: string;
  command: string;
  response: unknown;
  callback: ioBroker.MessageCallbackInfo | undefined;
}

interface TestHarness {
  sends: SentMessage[];
  logs: { level: "debug" | "warn"; msg: string }[];
  createdClients: { host: string; port: number }[];
  createdOptions: (NutClientOptions | undefined)[];
  registered: NutClient[];
  completed: NutClient[];
  deps: MessageRouterDeps;
}

function makeHarness(
  listUpsResult?: { name: string; description: string }[],
  connectError?: Error,
  authError?: Error,
): TestHarness {
  const sends: SentMessage[] = [];
  const logs: { level: "debug" | "warn"; msg: string }[] = [];
  const createdClients: { host: string; port: number }[] = [];
  const createdOptions: (NutClientOptions | undefined)[] = [];
  const registered: NutClient[] = [];
  const completed: NutClient[] = [];

  const deps: MessageRouterDeps = {
    log: {
      debug: msg => logs.push({ level: "debug", msg }),
      warn: msg => logs.push({ level: "warn", msg }),
    },
    sendTo: (from, command, response, callback) => {
      sends.push({ from, command, response, callback });
    },
    createTestClient: (host, port, options) => {
      createdClients.push({ host, port });
      createdOptions.push(options);
      return {
        connect: async () => {
          if (connectError) {
            throw connectError;
          }
        },
        listUps: async () => listUpsResult ?? [{ name: "ups0", description: "Eaton" }],
        authenticate: async () => {
          if (authError) {
            throw authError;
          }
        },
        login: async () => {},
        destroy: () => {},
      } as unknown as NutClient;
    },
    onTestClientCreated: client => registered.push(client),
    onTestClientDone: client => completed.push(client),
  };

  return { sends, logs, createdClients, createdOptions, registered, completed, deps };
}

function buildMessage(overrides: Partial<ioBroker.Message>): ioBroker.Message {
  return {
    command: "checkConnection",
    from: "system.adapter.test.0",
    callback: { id: 1, message: "x", time: 0, ack: false } as ioBroker.MessageCallbackInfo,
    message: undefined,
    ...overrides,
  } as ioBroker.Message;
}

describe("dispatchMessage", () => {
  // -----------------------------------------------------------------------
  // Default-branch contract
  // -----------------------------------------------------------------------
  describe("default-branch contract", () => {
    it("should return { error: 'Unknown command' } for unrecognised commands", async () => {
      const h = makeHarness();
      await dispatchMessage(buildMessage({ command: "totallyMadeUpCommand" }), h.deps);

      expect(h.sends).toHaveLength(1);
      expect(h.sends[0].command).toBe("totallyMadeUpCommand");
      expect(h.sends[0].response).toEqual({ error: "Unknown command" });
      expect(h.sends[0].callback).toBeDefined();
    });

    it("should emit a debug line for unknown commands", async () => {
      const h = makeHarness();
      await dispatchMessage(buildMessage({ command: "weirdCmd" }), h.deps);

      const debugMsgs = h.logs.filter(l => l.level === "debug").map(l => l.msg);
      expect(debugMsgs.some(m => m.includes("unknown command 'weirdCmd'"))).toBe(true);
    });

    it("should always invoke sendTo exactly once per command", async () => {
      const h = makeHarness();
      await dispatchMessage(buildMessage({ command: "x" }), h.deps);
      await dispatchMessage(buildMessage({ command: "y" }), h.deps);
      await dispatchMessage(buildMessage({ command: "z" }), h.deps);

      expect(h.sends).toHaveLength(3);
      for (const s of h.sends) {
        expect(s.callback).toBeDefined();
      }
    });
  });

  // -----------------------------------------------------------------------
  // Entry log
  // -----------------------------------------------------------------------
  describe("entry log", () => {
    it("should emit entry debug before callback early-return for broadcasts", async () => {
      const h = makeHarness();
      await dispatchMessage({ command: "broadcast", from: "x", message: {} } as ioBroker.Message, h.deps);

      expect(h.sends).toHaveLength(0);
      const debugMsgs = h.logs.filter(l => l.level === "debug").map(l => l.msg);
      expect(debugMsgs.some(m => m.includes("onMessage: command='broadcast'"))).toBe(true);
      expect(debugMsgs.some(m => m.includes("has-callback=false"))).toBe(true);
    });
  });

  // -----------------------------------------------------------------------
  // checkConnection
  // -----------------------------------------------------------------------
  describe("checkConnection", () => {
    it("should return error for missing host", async () => {
      const h = makeHarness();
      await dispatchMessage(buildMessage({ command: "checkConnection", message: { host: "", port: 3493 } }), h.deps);

      expect(h.sends).toHaveLength(1);
      expect(h.sends[0].response).toEqual({ success: false, message: "Host is required" });
      expect(h.createdClients).toHaveLength(0);
    });

    it("should connect and list UPS devices on valid config", async () => {
      const h = makeHarness([
        { name: "ups0", description: "Eaton PRO 1600" },
        { name: "ups1", description: "APC Smart" },
      ]);
      await dispatchMessage(
        buildMessage({ command: "checkConnection", message: { host: "192.168.1.100", port: 3493 } }),
        h.deps,
      );

      expect(h.createdClients).toEqual([{ host: "192.168.1.100", port: 3493 }]);
      expect(h.sends).toHaveLength(1);
      const resp = h.sends[0].response as { success: boolean; message: string };
      expect(resp.success).toBe(true);
      expect(resp.message).toContain("2 UPS(es)");
      expect(resp.message).toContain("ups0");
      expect(resp.message).toContain("ups1");
    });

    it("should use default port 3493 when port is not a number", async () => {
      const h = makeHarness();
      await dispatchMessage(buildMessage({ command: "checkConnection", message: { host: "myhost" } }), h.deps);

      expect(h.createdClients).toEqual([{ host: "myhost", port: 3493 }]);
    });

    it("forwards networkInterface, commandTimeout and TLS options to the test client", async () => {
      const h = makeHarness([{ name: "ups0", description: "Eaton" }]);
      await dispatchMessage(
        buildMessage({
          command: "checkConnection",
          message: {
            host: "192.168.1.100",
            port: 3493,
            networkInterface: "10.0.0.5",
            commandTimeout: 8,
            useTls: true,
            tlsRejectUnauthorized: true,
          },
        }),
        h.deps,
      );

      expect(h.createdOptions).toHaveLength(1);
      expect(h.createdOptions[0]).toMatchObject({
        localAddress: "10.0.0.5",
        commandTimeout: 8000, // seconds → ms
        useTls: true,
        tlsRejectUnauthorized: true,
      });
    });

    it("omits localAddress and defaults TLS off when not configured", async () => {
      const h = makeHarness([{ name: "ups0", description: "Eaton" }]);
      await dispatchMessage(buildMessage({ command: "checkConnection", message: { host: "h", port: 3493 } }), h.deps);

      expect(h.createdOptions[0]).toMatchObject({
        localAddress: undefined,
        useTls: false,
        tlsRejectUnauthorized: false,
      });
    });

    it("should forward connection errors as failure response", async () => {
      const h = makeHarness(undefined, new Error("ECONNREFUSED"));
      await dispatchMessage(
        buildMessage({ command: "checkConnection", message: { host: "10.0.0.1", port: 3493 } }),
        h.deps,
      );

      expect(h.sends).toHaveLength(1);
      const resp = h.sends[0].response as { success: boolean; message: string };
      expect(resp.success).toBe(false);
      expect(resp.message).toBe("ECONNREFUSED");
    });
  });

  // -----------------------------------------------------------------------
  // checkConnection with auth
  // -----------------------------------------------------------------------
  describe("checkConnection with auth", () => {
    it("should authenticate when username and password provided", async () => {
      const h = makeHarness([{ name: "ups0", description: "Eaton" }]);
      await dispatchMessage(
        buildMessage({
          command: "checkConnection",
          message: { host: "192.168.1.100", port: 3493, username: "admin", password: "secret" },
        }),
        h.deps,
      );

      expect(h.sends).toHaveLength(1);
      const resp = h.sends[0].response as { success: boolean; message: string };
      expect(resp.success).toBe(true);
      expect(resp.message).toContain("authenticated");
    });

    it("should not authenticate when no credentials provided", async () => {
      const h = makeHarness([{ name: "ups0", description: "Eaton" }]);
      await dispatchMessage(
        buildMessage({
          command: "checkConnection",
          message: { host: "192.168.1.100", port: 3493 },
        }),
        h.deps,
      );

      expect(h.sends).toHaveLength(1);
      const resp = h.sends[0].response as { success: boolean; message: string };
      expect(resp.success).toBe(true);
      expect(resp.message).not.toContain("authenticated");
    });

    it("should return failure when auth fails", async () => {
      const h = makeHarness([{ name: "ups0", description: "Eaton" }], undefined, new Error("ACCESS-DENIED"));
      await dispatchMessage(
        buildMessage({
          command: "checkConnection",
          message: { host: "192.168.1.100", port: 3493, username: "admin", password: "wrong" },
        }),
        h.deps,
      );

      expect(h.sends).toHaveLength(1);
      const resp = h.sends[0].response as { success: boolean; message: string };
      expect(resp.success).toBe(false);
      expect(resp.message).toContain("ACCESS-DENIED");
    });

    it("should still call onTestClientDone when auth fails", async () => {
      const h = makeHarness([{ name: "ups0", description: "Eaton" }], undefined, new Error("ACCESS-DENIED"));
      await dispatchMessage(
        buildMessage({
          command: "checkConnection",
          message: { host: "192.168.1.100", port: 3493, username: "admin", password: "wrong" },
        }),
        h.deps,
      );

      expect(h.registered).toHaveLength(1);
      expect(h.completed).toHaveLength(1);
    });

  });

  // -----------------------------------------------------------------------
  // obj.message coercion
  // -----------------------------------------------------------------------
  describe("obj.message coercion", () => {
    it("should treat null obj.message as missing host", async () => {
      const h = makeHarness();
      await dispatchMessage(buildMessage({ message: null as unknown as ioBroker.Message["message"] }), h.deps);

      expect(h.sends).toHaveLength(1);
      expect(h.sends[0].response).toEqual({ success: false, message: "Host is required" });
    });

    it("should treat string obj.message as missing host", async () => {
      const h = makeHarness();
      await dispatchMessage(buildMessage({ message: "junk" as unknown as ioBroker.Message["message"] }), h.deps);

      expect(h.sends).toHaveLength(1);
      expect((h.sends[0].response as { success: boolean }).success).toBe(false);
    });

    it("should treat array obj.message as missing host", async () => {
      const h = makeHarness();
      await dispatchMessage(buildMessage({ message: [] as unknown as ioBroker.Message["message"] }), h.deps);

      expect(h.sends).toHaveLength(1);
      expect((h.sends[0].response as { success: boolean }).success).toBe(false);
    });
  });

  // -----------------------------------------------------------------------
  // Test-client lifecycle hooks
  // -----------------------------------------------------------------------
  describe("test-client lifecycle hooks", () => {
    it("should call onTestClientCreated then onTestClientDone on success", async () => {
      const h = makeHarness([{ name: "ups0", description: "Eaton" }]);
      await dispatchMessage(buildMessage({ command: "checkConnection", message: { host: "h", port: 3493 } }), h.deps);

      expect(h.registered).toHaveLength(1);
      expect(h.completed).toHaveLength(1);
      expect(h.registered[0]).toBe(h.completed[0]);
    });

    it("should call onTestClientDone even when connect throws", async () => {
      const sends: SentMessage[] = [];
      const registered: NutClient[] = [];
      const completed: NutClient[] = [];
      const failingClient = {
        connect: async () => {
          throw new Error("boom");
        },
        destroy: () => {},
      } as unknown as NutClient;
      const deps: MessageRouterDeps = {
        log: { debug: () => {}, warn: () => {} },
        sendTo: (from, command, response, callback) => {
          sends.push({ from, command, response, callback });
        },
        createTestClient: () => failingClient,
        onTestClientCreated: c => registered.push(c),
        onTestClientDone: c => completed.push(c),
      };
      await dispatchMessage(buildMessage({ command: "checkConnection", message: { host: "h", port: 3493 } }), deps);

      expect(registered).toHaveLength(1);
      expect(completed).toHaveLength(1);
      expect(registered[0]).toBe(completed[0]);
      expect(sends).toHaveLength(1);
      expect((sends[0].response as { success: boolean }).success).toBe(false);
    });

    it("should not register a test-client when host is missing", async () => {
      const h = makeHarness();
      await dispatchMessage(buildMessage({ command: "checkConnection", message: { host: "" } }), h.deps);

      expect(h.registered).toHaveLength(0);
      expect(h.completed).toHaveLength(0);
    });
  });
});
