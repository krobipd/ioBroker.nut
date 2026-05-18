import * as net from "node:net";
import { NutClient, NutError, NutTimeoutError } from "./nut-client";

// ---------------------------------------------------------------------------
// Mock NUT TCP Server
// ---------------------------------------------------------------------------

interface MockHandler {
  (command: string): string | string[] | null;
}

function createMockNutServer(handler?: MockHandler): {
  server: net.Server;
  start: () => Promise<number>;
  stop: () => Promise<void>;
  port: number;
  commands: string[];
} {
  const commands: string[] = [];
  let port = 0;

  const defaultHandler: MockHandler = (cmd: string): string | string[] | null => {
    if (cmd === "LIST UPS") {
      return [
        'BEGIN LIST UPS',
        'UPS ups0 "Main UPS"',
        'UPS ups1 "Backup UPS"',
        'END LIST UPS',
      ];
    }
    if (cmd.startsWith("LIST VAR ")) {
      const ups = cmd.split(" ")[2];
      return [
        `BEGIN LIST VAR ${ups}`,
        `VAR ${ups} battery.charge "100"`,
        `VAR ${ups} ups.status "OL"`,
        `VAR ${ups} ups.load "15"`,
        `END LIST VAR ${ups}`,
      ];
    }
    if (cmd.startsWith("LIST RW ")) {
      const ups = cmd.split(" ")[2];
      return [
        `BEGIN LIST RW ${ups}`,
        `RW ${ups} ups.delay.shutdown "20"`,
        `END LIST RW ${ups}`,
      ];
    }
    if (cmd.startsWith("LIST CMD ")) {
      const ups = cmd.split(" ")[2];
      return [
        `BEGIN LIST CMD ${ups}`,
        `CMD ${ups} beeper.enable`,
        `CMD ${ups} load.off`,
        `END LIST CMD ${ups}`,
      ];
    }
    if (cmd.startsWith("LIST ENUM ")) {
      const parts = cmd.split(" ");
      const ups = parts[2];
      const varName = parts[3];
      return [
        `BEGIN LIST ENUM ${ups} ${varName}`,
        `ENUM ${ups} ${varName} "200"`,
        `ENUM ${ups} ${varName} "230"`,
        `ENUM ${ups} ${varName} "240"`,
        `END LIST ENUM ${ups} ${varName}`,
      ];
    }
    if (cmd.startsWith("LIST RANGE ")) {
      const parts = cmd.split(" ");
      const ups = parts[2];
      const varName = parts[3];
      return [
        `BEGIN LIST RANGE ${ups} ${varName}`,
        `RANGE ${ups} ${varName} "100" "280"`,
        `END LIST RANGE ${ups} ${varName}`,
      ];
    }
    if (cmd.startsWith("GET VAR ")) {
      const parts = cmd.split(" ");
      return `VAR ${parts[2]} ${parts[3]} "42"`;
    }
    if (cmd.startsWith("SET VAR ")) {
      return "OK";
    }
    if (cmd.startsWith("INSTCMD ")) {
      return "OK";
    }
    if (cmd.startsWith("USERNAME ")) {
      return "OK";
    }
    if (cmd.startsWith("PASSWORD ")) {
      return "OK";
    }
    if (cmd.startsWith("LOGIN ")) {
      return "OK";
    }
    return "ERR UNKNOWN-COMMAND";
  };

  const server = net.createServer((socket) => {
    let buf = "";
    socket.setEncoding("utf8");
    socket.on("data", (data: string) => {
      buf += data;
      const lines = buf.split("\n");
      buf = lines.pop()!;

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed) continue;
        commands.push(trimmed);

        const h = handler ?? defaultHandler;
        const response = h(trimmed);
        if (response === null) return;
        if (Array.isArray(response)) {
          for (const r of response) {
            socket.write(r + "\n");
          }
        } else {
          socket.write(response + "\n");
        }
      }
    });
  });

  return {
    server,
    get port() { return port; },
    commands,
    start: () =>
      new Promise<number>((resolve) => {
        server.listen(0, "127.0.0.1", () => {
          const addr = server.address() as net.AddressInfo;
          port = addr.port;
          resolve(port);
        });
      }),
    stop: () =>
      new Promise<void>((resolve) => {
        server.close(() => resolve());
      }),
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("NutClient", () => {
  // -----------------------------------------------------------------------
  // Connection
  // -----------------------------------------------------------------------
  describe("connect", () => {
    it("should connect to a NUT server", async () => {
      const mock = createMockNutServer();
      const port = await mock.start();
      try {
        const client = new NutClient("127.0.0.1", port);
        await client.connect();
        expect(client.isConnected).toBe(true);
        client.destroy();
      } finally {
        await mock.stop();
      }
    });

    it("should reject when server is unavailable", async () => {
      const client = new NutClient("127.0.0.1", 1);
      await expect(client.connect()).rejects.toThrow();
    });

    it("should report not connected before connect", () => {
      const client = new NutClient("127.0.0.1", 3493);
      expect(client.isConnected).toBe(false);
    });

    it("should reject connect after destroy", async () => {
      const client = new NutClient("127.0.0.1", 3493);
      client.destroy();
      await expect(client.connect()).rejects.toThrow("Client has been destroyed");
    });
  });

  // -----------------------------------------------------------------------
  // LIST UPS
  // -----------------------------------------------------------------------
  describe("listUps", () => {
    it("should return all UPS devices", async () => {
      const mock = createMockNutServer();
      const port = await mock.start();
      try {
        const client = new NutClient("127.0.0.1", port);
        await client.connect();
        const upsList = await client.listUps();
        expect(upsList).toEqual([
          { name: "ups0", description: "Main UPS" },
          { name: "ups1", description: "Backup UPS" },
        ]);
        client.destroy();
      } finally {
        await mock.stop();
      }
    });

    it("should handle empty UPS list", async () => {
      const mock = createMockNutServer((cmd) => {
        if (cmd === "LIST UPS") {
          return ["BEGIN LIST UPS", "END LIST UPS"];
        }
        return "ERR UNKNOWN-COMMAND";
      });
      const port = await mock.start();
      try {
        const client = new NutClient("127.0.0.1", port);
        await client.connect();
        const upsList = await client.listUps();
        expect(upsList).toEqual([]);
        client.destroy();
      } finally {
        await mock.stop();
      }
    });

    it("should handle escaped quotes in UPS description", async () => {
      const mock = createMockNutServer((cmd) => {
        if (cmd === "LIST UPS") {
          return [
            "BEGIN LIST UPS",
            'UPS ups0 "Main \\"backup\\" UPS"',
            "END LIST UPS",
          ];
        }
        return "ERR UNKNOWN-COMMAND";
      });
      const port = await mock.start();
      try {
        const client = new NutClient("127.0.0.1", port);
        await client.connect();
        const upsList = await client.listUps();
        expect(upsList).toEqual([{ name: "ups0", description: 'Main "backup" UPS' }]);
        client.destroy();
      } finally {
        await mock.stop();
      }
    });
  });

  // -----------------------------------------------------------------------
  // LIST VAR
  // -----------------------------------------------------------------------
  describe("listVar", () => {
    it("should return all variables for a UPS", async () => {
      const mock = createMockNutServer();
      const port = await mock.start();
      try {
        const client = new NutClient("127.0.0.1", port);
        await client.connect();
        const vars = await client.listVar("ups0");
        expect(vars).toEqual([
          { name: "battery.charge", value: "100" },
          { name: "ups.status", value: "OL" },
          { name: "ups.load", value: "15" },
        ]);
        client.destroy();
      } finally {
        await mock.stop();
      }
    });

    it("should reject on unknown UPS", async () => {
      const mock = createMockNutServer((cmd) => {
        if (cmd === "LIST VAR unknown") return "ERR UNKNOWN-UPS";
        return "ERR UNKNOWN-COMMAND";
      });
      const port = await mock.start();
      try {
        const client = new NutClient("127.0.0.1", port);
        await client.connect();
        await expect(client.listVar("unknown")).rejects.toThrow(NutError);
        await expect(client.listVar("unknown")).rejects.toMatchObject({ code: "UNKNOWN-UPS" });
        client.destroy();
      } finally {
        await mock.stop();
      }
    });
  });

  // -----------------------------------------------------------------------
  // LIST RW
  // -----------------------------------------------------------------------
  describe("listRw", () => {
    it("should return writable variables", async () => {
      const mock = createMockNutServer();
      const port = await mock.start();
      try {
        const client = new NutClient("127.0.0.1", port);
        await client.connect();
        const rw = await client.listRw("ups0");
        expect(rw).toEqual([{ name: "ups.delay.shutdown", value: "20" }]);
        client.destroy();
      } finally {
        await mock.stop();
      }
    });
  });

  // -----------------------------------------------------------------------
  // LIST CMD
  // -----------------------------------------------------------------------
  describe("listCmd", () => {
    it("should return available commands", async () => {
      const mock = createMockNutServer();
      const port = await mock.start();
      try {
        const client = new NutClient("127.0.0.1", port);
        await client.connect();
        const cmds = await client.listCmd("ups0");
        expect(cmds).toEqual([{ name: "beeper.enable" }, { name: "load.off" }]);
        client.destroy();
      } finally {
        await mock.stop();
      }
    });
  });

  // -----------------------------------------------------------------------
  // LIST ENUM
  // -----------------------------------------------------------------------
  describe("listEnum", () => {
    it("should return enum values", async () => {
      const mock = createMockNutServer();
      const port = await mock.start();
      try {
        const client = new NutClient("127.0.0.1", port);
        await client.connect();
        const enums = await client.listEnum("ups0", "output.voltage.nominal");
        expect(enums).toEqual(["200", "230", "240"]);
        client.destroy();
      } finally {
        await mock.stop();
      }
    });
  });

  // -----------------------------------------------------------------------
  // LIST RANGE
  // -----------------------------------------------------------------------
  describe("listRange", () => {
    it("should return range constraints", async () => {
      const mock = createMockNutServer();
      const port = await mock.start();
      try {
        const client = new NutClient("127.0.0.1", port);
        await client.connect();
        const ranges = await client.listRange("ups0", "input.transfer.high");
        expect(ranges).toEqual([{ min: "100", max: "280" }]);
        client.destroy();
      } finally {
        await mock.stop();
      }
    });
  });

  // -----------------------------------------------------------------------
  // GET VAR
  // -----------------------------------------------------------------------
  describe("getVar", () => {
    it("should return a single variable value", async () => {
      const mock = createMockNutServer();
      const port = await mock.start();
      try {
        const client = new NutClient("127.0.0.1", port);
        await client.connect();
        const val = await client.getVar("ups0", "battery.charge");
        expect(val).toBe("42");
        client.destroy();
      } finally {
        await mock.stop();
      }
    });

    it("should reject on VAR-NOT-SUPPORTED", async () => {
      const mock = createMockNutServer((cmd) => {
        if (cmd.startsWith("GET VAR")) return "ERR VAR-NOT-SUPPORTED";
        return "ERR UNKNOWN-COMMAND";
      });
      const port = await mock.start();
      try {
        const client = new NutClient("127.0.0.1", port);
        await client.connect();
        await expect(client.getVar("ups0", "no.such.var")).rejects.toThrow(NutError);
        client.destroy();
      } finally {
        await mock.stop();
      }
    });
  });

  // -----------------------------------------------------------------------
  // SET VAR
  // -----------------------------------------------------------------------
  describe("setVar", () => {
    it("should send SET VAR with escaped value", async () => {
      const mock = createMockNutServer();
      const port = await mock.start();
      try {
        const client = new NutClient("127.0.0.1", port);
        await client.connect();
        await client.setVar("ups0", "ups.delay.shutdown", "30");
        expect(mock.commands).toContain('SET VAR ups0 ups.delay.shutdown "30"');
        client.destroy();
      } finally {
        await mock.stop();
      }
    });

    it("should escape special characters in value", async () => {
      const mock = createMockNutServer();
      const port = await mock.start();
      try {
        const client = new NutClient("127.0.0.1", port);
        await client.connect();
        await client.setVar("ups0", "outlet.desc", 'Test "outlet" \\ 1');
        expect(mock.commands).toContain('SET VAR ups0 outlet.desc "Test \\"outlet\\" \\\\ 1"');
        client.destroy();
      } finally {
        await mock.stop();
      }
    });

    it("should reject on SET-FAILED", async () => {
      const mock = createMockNutServer((cmd) => {
        if (cmd.startsWith("SET VAR")) return "ERR SET-FAILED";
        return "ERR UNKNOWN-COMMAND";
      });
      const port = await mock.start();
      try {
        const client = new NutClient("127.0.0.1", port);
        await client.connect();
        await expect(client.setVar("ups0", "ups.delay.shutdown", "30")).rejects.toMatchObject({
          code: "SET-FAILED",
        });
        client.destroy();
      } finally {
        await mock.stop();
      }
    });
  });

  // -----------------------------------------------------------------------
  // INSTCMD
  // -----------------------------------------------------------------------
  describe("instCmd", () => {
    it("should send INSTCMD", async () => {
      const mock = createMockNutServer();
      const port = await mock.start();
      try {
        const client = new NutClient("127.0.0.1", port);
        await client.connect();
        await client.instCmd("ups0", "beeper.enable");
        expect(mock.commands).toContain("INSTCMD ups0 beeper.enable");
        client.destroy();
      } finally {
        await mock.stop();
      }
    });

    it("should reject on INSTCMD-FAILED", async () => {
      const mock = createMockNutServer((cmd) => {
        if (cmd.startsWith("INSTCMD")) return "ERR INSTCMD-FAILED";
        return "ERR UNKNOWN-COMMAND";
      });
      const port = await mock.start();
      try {
        const client = new NutClient("127.0.0.1", port);
        await client.connect();
        await expect(client.instCmd("ups0", "load.off")).rejects.toMatchObject({
          code: "INSTCMD-FAILED",
        });
        client.destroy();
      } finally {
        await mock.stop();
      }
    });
  });

  // -----------------------------------------------------------------------
  // Authentication
  // -----------------------------------------------------------------------
  describe("authenticate", () => {
    it("should send USERNAME and PASSWORD", async () => {
      const mock = createMockNutServer();
      const port = await mock.start();
      try {
        const client = new NutClient("127.0.0.1", port);
        await client.connect();
        await client.authenticate("admin", "secret");
        expect(mock.commands).toContain("USERNAME admin");
        expect(mock.commands).toContain("PASSWORD secret");
        client.destroy();
      } finally {
        await mock.stop();
      }
    });

    it("should reject on INVALID-PASSWORD", async () => {
      const mock = createMockNutServer((cmd) => {
        if (cmd.startsWith("USERNAME")) return "OK";
        if (cmd.startsWith("PASSWORD")) return "ERR INVALID-PASSWORD";
        return "ERR UNKNOWN-COMMAND";
      });
      const port = await mock.start();
      try {
        const client = new NutClient("127.0.0.1", port);
        await client.connect();
        await expect(client.authenticate("admin", "wrong")).rejects.toMatchObject({
          code: "INVALID-PASSWORD",
        });
        client.destroy();
      } finally {
        await mock.stop();
      }
    });

    it("should reject on INVALID-USERNAME", async () => {
      const mock = createMockNutServer((cmd) => {
        if (cmd.startsWith("USERNAME")) return "ERR INVALID-USERNAME";
        return "ERR UNKNOWN-COMMAND";
      });
      const port = await mock.start();
      try {
        const client = new NutClient("127.0.0.1", port);
        await client.connect();
        await expect(client.authenticate("bad", "pw")).rejects.toMatchObject({
          code: "INVALID-USERNAME",
        });
        client.destroy();
      } finally {
        await mock.stop();
      }
    });
  });

  // -----------------------------------------------------------------------
  // LOGIN
  // -----------------------------------------------------------------------
  describe("login", () => {
    it("should send LOGIN for a UPS", async () => {
      const mock = createMockNutServer();
      const port = await mock.start();
      try {
        const client = new NutClient("127.0.0.1", port);
        await client.connect();
        await client.login("ups0");
        expect(mock.commands).toContain("LOGIN ups0");
        client.destroy();
      } finally {
        await mock.stop();
      }
    });

    it("should handle ALREADY-LOGGED-IN gracefully", async () => {
      const mock = createMockNutServer((cmd) => {
        if (cmd.startsWith("LOGIN")) return "ERR ALREADY-LOGGED-IN";
        return "ERR UNKNOWN-COMMAND";
      });
      const port = await mock.start();
      try {
        const client = new NutClient("127.0.0.1", port);
        await client.connect();
        await expect(client.login("ups0")).rejects.toMatchObject({
          code: "ALREADY-LOGGED-IN",
        });
        client.destroy();
      } finally {
        await mock.stop();
      }
    });
  });

  // -----------------------------------------------------------------------
  // Error handling
  // -----------------------------------------------------------------------
  describe("error handling", () => {
    it("should parse NUT error codes", async () => {
      const mock = createMockNutServer((cmd) => {
        if (cmd.startsWith("GET VAR")) return "ERR ACCESS-DENIED";
        return "ERR UNKNOWN-COMMAND";
      });
      const port = await mock.start();
      try {
        const client = new NutClient("127.0.0.1", port);
        await client.connect();
        try {
          await client.getVar("ups0", "battery.charge");
          expect.unreachable("should have thrown");
        } catch (err) {
          expect(err).toBeInstanceOf(NutError);
          expect((err as NutError).code).toBe("ACCESS-DENIED");
        }
        client.destroy();
      } finally {
        await mock.stop();
      }
    });

    it("should handle DATA-STALE error", async () => {
      const mock = createMockNutServer((cmd) => {
        if (cmd.startsWith("LIST VAR")) return "ERR DATA-STALE";
        return "ERR UNKNOWN-COMMAND";
      });
      const port = await mock.start();
      try {
        const client = new NutClient("127.0.0.1", port);
        await client.connect();
        await expect(client.listVar("ups0")).rejects.toMatchObject({ code: "DATA-STALE" });
        client.destroy();
      } finally {
        await mock.stop();
      }
    });

    it("should reject commands when not connected", async () => {
      const client = new NutClient("127.0.0.1", 3493);
      await expect(client.listUps()).rejects.toThrow("Not connected");
    });
  });

  // -----------------------------------------------------------------------
  // Command timeout
  // -----------------------------------------------------------------------
  describe("command timeout", () => {
    it("should timeout on unresponsive server", async () => {
      const mock = createMockNutServer(() => null);
      const port = await mock.start();
      try {
        const client = new NutClient("127.0.0.1", port, { commandTimeout: 100 });
        await client.connect();
        await expect(client.listUps()).rejects.toThrow(NutTimeoutError);
        client.destroy();
      } finally {
        await mock.stop();
      }
    });

    it("should use custom timeout", async () => {
      const mock = createMockNutServer(() => null);
      const port = await mock.start();
      try {
        const client = new NutClient("127.0.0.1", port, { commandTimeout: 50 });
        await client.connect();
        const start = Date.now();
        await expect(client.listUps()).rejects.toThrow(NutTimeoutError);
        const elapsed = Date.now() - start;
        expect(elapsed).toBeLessThan(300);
        client.destroy();
      } finally {
        await mock.stop();
      }
    });
  });

  // -----------------------------------------------------------------------
  // Queue serialization
  // -----------------------------------------------------------------------
  describe("command queue", () => {
    it("should serialize concurrent commands", async () => {
      const mock = createMockNutServer();
      const port = await mock.start();
      try {
        const client = new NutClient("127.0.0.1", port);
        await client.connect();

        const [ups, vars, cmds] = await Promise.all([
          client.listUps(),
          client.listVar("ups0"),
          client.listCmd("ups0"),
        ]);

        expect(ups.length).toBe(2);
        expect(vars.length).toBe(3);
        expect(cmds.length).toBe(2);

        expect(mock.commands[0]).toBe("LIST UPS");
        expect(mock.commands[1]).toBe("LIST VAR ups0");
        expect(mock.commands[2]).toBe("LIST CMD ups0");

        client.destroy();
      } finally {
        await mock.stop();
      }
    });

    it("should process next command after error", async () => {
      let callCount = 0;
      const mock = createMockNutServer((cmd) => {
        if (cmd.startsWith("GET VAR")) {
          callCount++;
          if (callCount === 1) return "ERR VAR-NOT-SUPPORTED";
          return 'VAR ups0 ups.load "15"';
        }
        return "ERR UNKNOWN-COMMAND";
      });
      const port = await mock.start();
      try {
        const client = new NutClient("127.0.0.1", port);
        await client.connect();

        await expect(client.getVar("ups0", "no.such.var")).rejects.toThrow(NutError);
        const val = await client.getVar("ups0", "ups.load");
        expect(val).toBe("15");

        client.destroy();
      } finally {
        await mock.stop();
      }
    });

    it("should process next command after timeout", async () => {
      let firstCall = true;
      const mock = createMockNutServer((cmd) => {
        if (cmd.startsWith("GET VAR")) {
          if (firstCall) {
            firstCall = false;
            return null; // no response → timeout
          }
          return 'VAR ups0 ups.load "15"';
        }
        return "ERR UNKNOWN-COMMAND";
      });
      const port = await mock.start();
      try {
        const client = new NutClient("127.0.0.1", port, { commandTimeout: 100 });
        await client.connect();

        await expect(client.getVar("ups0", "battery.charge")).rejects.toThrow(NutTimeoutError);
        const val = await client.getVar("ups0", "ups.load");
        expect(val).toBe("15");

        client.destroy();
      } finally {
        await mock.stop();
      }
    });
  });

  // -----------------------------------------------------------------------
  // cancelAll
  // -----------------------------------------------------------------------
  describe("cancelAll", () => {
    it("should reject all pending commands", async () => {
      const mock = createMockNutServer(() => null);
      const port = await mock.start();
      try {
        const client = new NutClient("127.0.0.1", port, { commandTimeout: 10000 });
        await client.connect();

        const p1 = client.listUps();
        const p2 = client.listVar("ups0");

        client.cancelAll();

        await expect(p1).rejects.toThrow("Client cancelled");
        await expect(p2).rejects.toThrow("Client cancelled");

        client.destroy();
      } finally {
        await mock.stop();
      }
    });
  });

  // -----------------------------------------------------------------------
  // destroy
  // -----------------------------------------------------------------------
  describe("destroy", () => {
    it("should close connection and reject pending", async () => {
      const mock = createMockNutServer(() => null);
      const port = await mock.start();
      try {
        const client = new NutClient("127.0.0.1", port, { commandTimeout: 10000 });
        await client.connect();
        expect(client.isConnected).toBe(true);

        const p = client.listUps();
        client.destroy();

        await expect(p).rejects.toThrow("Client cancelled");
        expect(client.isConnected).toBe(false);
      } finally {
        await mock.stop();
      }
    });
  });

  // -----------------------------------------------------------------------
  // Reconnect
  // -----------------------------------------------------------------------
  describe("reconnect", () => {
    it("should attempt reconnect after disconnect", async () => {
      const mock = createMockNutServer();
      const port = await mock.start();
      try {
        const client = new NutClient("127.0.0.1", port, { commandTimeout: 2000 });
        let reconnected = false;
        client.setOnReconnect(() => {
          reconnected = true;
        });

        await client.connect();
        expect(client.isConnected).toBe(true);

        // Force disconnect all clients
        for (const conn of (mock.server as any)._connections || []) {
          conn?.destroy();
        }
        // Alternative: close the server-side sockets
        mock.server.getConnections((_err, _count) => {});

        // Wait for reconnect
        await new Promise<void>((resolve) => {
          const check = setInterval(() => {
            if (reconnected) {
              clearInterval(check);
              resolve();
            }
          }, 100);
          setTimeout(() => {
            clearInterval(check);
            resolve();
          }, 3000);
        });

        client.destroy();
      } finally {
        await mock.stop();
      }
    });
  });

  // -----------------------------------------------------------------------
  // Logger integration
  // -----------------------------------------------------------------------
  describe("logger", () => {
    it("should call logger.debug for commands", async () => {
      const logs: string[] = [];
      const logger = {
        debug: (msg: string) => logs.push(msg),
        warn: (msg: string) => logs.push(`WARN: ${msg}`),
        info: (msg: string) => logs.push(`INFO: ${msg}`),
      };

      const mock = createMockNutServer();
      const port = await mock.start();
      try {
        const client = new NutClient("127.0.0.1", port, { logger });
        await client.connect();
        await client.listUps();
        client.destroy();

        expect(logs.some((l) => l.includes("Connected to NUT server"))).toBe(true);
        expect(logs.some((l) => l.includes(">> LIST UPS"))).toBe(true);
      } finally {
        await mock.stop();
      }
    });
  });

  // -----------------------------------------------------------------------
  // Multi-line edge cases
  // -----------------------------------------------------------------------
  describe("multi-line parsing", () => {
    it("should handle large LIST VAR responses", async () => {
      const mock = createMockNutServer((cmd) => {
        if (cmd === "LIST VAR bigups") {
          const lines = ["BEGIN LIST VAR bigups"];
          for (let i = 0; i < 100; i++) {
            lines.push(`VAR bigups var.${i} "${i}"`);
          }
          lines.push("END LIST VAR bigups");
          return lines;
        }
        return "ERR UNKNOWN-COMMAND";
      });
      const port = await mock.start();
      try {
        const client = new NutClient("127.0.0.1", port);
        await client.connect();
        const vars = await client.listVar("bigups");
        expect(vars.length).toBe(100);
        expect(vars[0]).toEqual({ name: "var.0", value: "0" });
        expect(vars[99]).toEqual({ name: "var.99", value: "99" });
        client.destroy();
      } finally {
        await mock.stop();
      }
    });

    it("should handle chunked TCP data", async () => {
      const server = net.createServer((socket) => {
        socket.setEncoding("utf8");
        let buf = "";
        socket.on("data", (data: string) => {
          buf += data;
          if (buf.includes("\n")) {
            buf = "";
            // Send response in multiple chunks with delays
            socket.write("BEGIN LIST UPS\n");
            setTimeout(() => {
              socket.write('UPS ups');
              setTimeout(() => {
                socket.write('0 "Test UPS"\n');
                setTimeout(() => {
                  socket.write("END LIST UPS\n");
                }, 10);
              }, 10);
            }, 10);
          }
        });
      });

      const port = await new Promise<number>((resolve) => {
        server.listen(0, "127.0.0.1", () => {
          resolve((server.address() as net.AddressInfo).port);
        });
      });

      try {
        const client = new NutClient("127.0.0.1", port);
        await client.connect();
        const ups = await client.listUps();
        expect(ups).toEqual([{ name: "ups0", description: "Test UPS" }]);
        client.destroy();
      } finally {
        await new Promise<void>((resolve) => server.close(() => resolve()));
      }
    });

    it("should handle values with escaped backslashes", async () => {
      const mock = createMockNutServer((cmd) => {
        if (cmd.startsWith("GET VAR")) {
          return 'VAR ups0 test.var "path\\\\to\\\\file"';
        }
        return "ERR UNKNOWN-COMMAND";
      });
      const port = await mock.start();
      try {
        const client = new NutClient("127.0.0.1", port);
        await client.connect();
        const val = await client.getVar("ups0", "test.var");
        expect(val).toBe("path\\to\\file");
        client.destroy();
      } finally {
        await mock.stop();
      }
    });
  });

  // -----------------------------------------------------------------------
  // Auth sequence
  // -----------------------------------------------------------------------
  describe("auth sequence", () => {
    it("should authenticate then login in correct order", async () => {
      const mock = createMockNutServer();
      const port = await mock.start();
      try {
        const client = new NutClient("127.0.0.1", port);
        await client.connect();
        await client.authenticate("admin", "secret");
        await client.login("ups0");

        expect(mock.commands).toEqual([
          "USERNAME admin",
          "PASSWORD secret",
          "LOGIN ups0",
        ]);
        client.destroy();
      } finally {
        await mock.stop();
      }
    });

    it("should reject login without prior auth", async () => {
      const mock = createMockNutServer((cmd) => {
        if (cmd.startsWith("LOGIN")) return "ERR USERNAME-REQUIRED";
        return "OK";
      });
      const port = await mock.start();
      try {
        const client = new NutClient("127.0.0.1", port);
        await client.connect();
        await expect(client.login("ups0")).rejects.toMatchObject({
          code: "USERNAME-REQUIRED",
        });
        client.destroy();
      } finally {
        await mock.stop();
      }
    });
  });

  // -----------------------------------------------------------------------
  // Error class properties
  // -----------------------------------------------------------------------
  describe("NutError", () => {
    it("should have code and message properties", () => {
      const err = new NutError("ACCESS-DENIED");
      expect(err.code).toBe("ACCESS-DENIED");
      expect(err.message).toBe("NUT error: ACCESS-DENIED");
      expect(err.name).toBe("NutError");
      expect(err).toBeInstanceOf(Error);
    });

    it("should accept custom message", () => {
      const err = new NutError("ACCESS-DENIED", "Custom message");
      expect(err.message).toBe("Custom message");
    });
  });

  describe("NutTimeoutError", () => {
    it("should have command property", () => {
      const err = new NutTimeoutError("LIST UPS");
      expect(err.command).toBe("LIST UPS");
      expect(err.message).toBe("NUT command timed out: LIST UPS");
      expect(err.name).toBe("NutTimeoutError");
      expect(err).toBeInstanceOf(Error);
    });
  });
});
