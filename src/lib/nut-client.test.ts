import * as net from "node:net";
import * as tls from "node:tls";
import { isTlsConfigError, MAX_LINE_BYTES, NutClient, NutError, NutTimeoutError } from "./nut-client";

// Throwaway self-signed cert+key (CN=localhost, 10y) for the STARTTLS handshake test only.
// The client connects with tlsRejectUnauthorized:false, so a self-signed cert is accepted.
const TEST_TLS_CERT = `-----BEGIN CERTIFICATE-----
MIIDCTCCAfGgAwIBAgIUHImzJF8XL41TIaeDxN27q+o+mgMwDQYJKoZIhvcNAQEL
BQAwFDESMBAGA1UEAwwJbG9jYWxob3N0MB4XDTI2MDUzMTIxMzc1MVoXDTM2MDUy
ODIxMzc1MVowFDESMBAGA1UEAwwJbG9jYWxob3N0MIIBIjANBgkqhkiG9w0BAQEF
AAOCAQ8AMIIBCgKCAQEAq4As7vWgFqRuj86ZFrSUXLVrst2HJn1hRgFzlKH1Z7YC
XzvUHeuykDFj0PbhIGKdoPg9xfMQxGMjCtnYFrZwjLyBfP4nfqxewNiUAGPtWwE/
Y5QPTfxwtZNfqiwktLu8OkimxQKBCw+n/wzD1knbSuEPyP7aXQcMRD0a9Hoif/JL
Ed4PIE4KVqSpMYP7L+Fw3Sqj4n6vNXLvtmG0FJAj2rbn0PMzM/3Qhz7IfQx9DZAb
b1aAtXilZOHC/BVlbW91/Vdw7X3srZqFKhMjEWD6lSwQ2FRXHFFkvJNykvbthr29
jYL894rI7qp7YtSEMsLyqam22AeZ4Oa4U1F4SwR4gQIDAQABo1MwUTAdBgNVHQ4E
FgQU1+raIiaMpli0/urIg3QONDTdDLUwHwYDVR0jBBgwFoAU1+raIiaMpli0/urI
g3QONDTdDLUwDwYDVR0TAQH/BAUwAwEB/zANBgkqhkiG9w0BAQsFAAOCAQEANFnS
tgPFc0SAp7rdGWi5kffxFIWbyrI2CfnsWFcHVUexgdNCHSh4QrrZRIVHIUUzj04Y
79Vh8aORPYup8/3B6N6/QJGTVWs6JdJWE1cJBLyLOLnnXgkTEh+WLJi16aamEyXW
vXzb8yw+RWJML89E6Ikh61f1bByuFcgJJh3yFXTxIFaC4T+Fv0aW3N2lCLBT7QXW
WMYXCdZb2Guhq8OmnuDGgB4TIbBYhWUlyB3YsY0Up71YylY8cZJErAm2Qh1VvNZR
YelM6JJpkeP8g739vT3X+UiwXOW6rX8SKMESGtsw2fU7OttQM/GA785RgNkHUmD5
5KFDgEWZVJU1/aPb6w==
-----END CERTIFICATE-----`;

const TEST_TLS_KEY = `-----BEGIN PRIVATE KEY-----
MIIEvgIBADANBgkqhkiG9w0BAQEFAASCBKgwggSkAgEAAoIBAQCrgCzu9aAWpG6P
zpkWtJRctWuy3YcmfWFGAXOUofVntgJfO9Qd67KQMWPQ9uEgYp2g+D3F8xDEYyMK
2dgWtnCMvIF8/id+rF7A2JQAY+1bAT9jlA9N/HC1k1+qLCS0u7w6SKbFAoELD6f/
DMPWSdtK4Q/I/tpdBwxEPRr0eiJ/8ksR3g8gTgpWpKkxg/sv4XDdKqPifq81cu+2
YbQUkCPatufQ8zMz/dCHPsh9DH0NkBtvVoC1eKVk4cL8FWVtb3X9V3DtfeytmoUq
EyMRYPqVLBDYVFccUWS8k3KS9u2Gvb2Ngvz3isjuqnti1IQywvKpqbbYB5ng5rhT
UXhLBHiBAgMBAAECggEAGkogeTQNaZMkwKYwqP6fBJQp8YYMbu3G4Mqdq2HlYtPP
isY61qhYG8r6bGC/820ykSeknojLX/N7fnEU8yxd1fEan2y9ZKlrMAAzNdkbnDj1
fOAINZH2PBtejZFNQihKKxwSdn5TBj1M6SfNiHaTZ2fXOd45XovTSU2dqW7khXzA
WYpkxecb5cGug+eWzuLrqvuaUQaI/cTwU4NTZEZutz0afPtsDKFP+huwb0yjlHF8
EWfSjMi3ejCfJatoNCUVJ08drTjR+b2vxljGTpG70dPtv5HgcCqSzUi0j4Pg4wtw
loHiE7FwVrtM6UevUOk0wwjpKGbuEA/AMZ4RgsxdjQKBgQDXmIkwcQkN+t4Gwwvk
ZvKEXgoTi1fjQN4pWTDmgkqo6ip/kBveCndYMV2U+q7S+KGW/Vw9tgR1BPg0lb8M
z267GSMnxSIEmnz0lPwKV2BW9yy8vzyN5RXtSWx5xs9v1J0E/Q+QBNFFsE5R+i0z
BHPjckCBY+595fGlVAPhDi6QtQKBgQDLpB9hl3P63WbNTZNKycf3czN2xa8jdA0N
9RRXhdPumUbXcUQQbd2T+rAGpFAFksRrqqi2ryCZ0nid/mgv2C17WRwFUMlY6hdq
s8uBmjGBBGkAQwVF5HWpieHS2vYANF8ZDcKTzNNwn+IMNEdpoOoJlcrdPTUSCuAs
HqIRMtZEHQKBgQC/wJJcPFzySysIVpgQKCQQ6NcLdQbRP9OYcRSWIFIpFESCOnke
rq5hCV8Tbzbou2x1L5jH5kjmj2n20y0eRqxUylHDQIk2EPWMT6ovxHESSDtJEMnZ
5mPvLTvGv7Wl4DNbyXv6+t3qnpm6PcnPs2kjZW3L50aqQUcAZc4hcAyodQKBgQCm
1ResgULQRDBjg+lmvPbpH+UKqhu4xOupAp6esZIWCFbETBQCDbAY+qjZWCYC2uG2
f0LnH4Rq4MZWUcWTZNymEDPnmu7JvEZg8VmJHQTveOh5AW9BelB3C/IJJ7+gHUfH
o8FECusyepnbe70BqYXzQlfHdsySsnxDSPlnc6mcdQKBgBuD3hyhtSYeFZYFIp15
5QyOYYHA4SylTa/FTWPArsi4Jni3CCUf4ObZ3HUvc5m1ig1WrfsaXG3QuiM2q9Ng
LueAgxoAfWdMelYH3sDF7+1lZoTM9iW5mUKYR32S/lFzN/s0DfeyRigKgRrHUHRk
BkE/t6kWa7tRIMX2uf2qvl8M
-----END PRIVATE KEY-----`;

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
  disconnectAll: () => void;
  port: number;
  commands: string[];
} {
  const commands: string[] = [];
  const connections = new Set<net.Socket>();
  let port = 0;

  const defaultHandler: MockHandler = (cmd: string): string | string[] | null => {
    if (cmd === "LIST UPS") {
      return ["BEGIN LIST UPS", 'UPS ups0 "Main UPS"', 'UPS ups1 "Backup UPS"', "END LIST UPS"];
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
      return [`BEGIN LIST RW ${ups}`, `RW ${ups} ups.delay.shutdown "20"`, `END LIST RW ${ups}`];
    }
    if (cmd.startsWith("LIST CMD ")) {
      const ups = cmd.split(" ")[2];
      return [`BEGIN LIST CMD ${ups}`, `CMD ${ups} beeper.enable`, `CMD ${ups} load.off`, `END LIST CMD ${ups}`];
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

  const server = net.createServer(socket => {
    let buf = "";
    connections.add(socket);
    socket.on("close", () => connections.delete(socket));
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
    get port() {
      return port;
    },
    commands,
    start: () =>
      new Promise<number>(resolve => {
        server.listen(0, "127.0.0.1", () => {
          const addr = server.address() as net.AddressInfo;
          port = addr.port;
          resolve(port);
        });
      }),
    stop: () =>
      new Promise<void>(resolve => {
        server.close(() => resolve());
      }),
    disconnectAll: () => {
      for (const conn of connections) {
        conn.destroy();
      }
    },
  };
}

// A mock server that answers STARTTLS with "OK STARTTLS" and then completes a REAL TLS
// handshake on its side — so the client's plaintext→TLS upgrade is exercised end to end
// (a mock that only checks the STARTTLS line was sent would never trip the upgrade trap).
function createStartTlsMockServer(handler: MockHandler): {
  start: () => Promise<number>;
  stop: () => Promise<void>;
  commands: string[];
  /** Server-names the client offered via SNI (empty when it offered none). */
  sniNames: string[];
} {
  const commands: string[] = [];
  const connections = new Set<net.Socket | tls.TLSSocket>();
  const sniNames: string[] = [];
  let port = 0;

  const respond = (sock: net.Socket | tls.TLSSocket, cmd: string): void => {
    commands.push(cmd);
    const r = handler(cmd);
    if (r === null) return;
    if (Array.isArray(r)) {
      for (const line of r) sock.write(line + "\n");
    } else {
      sock.write(r + "\n");
    }
  };

  const server = net.createServer(socket => {
    connections.add(socket);
    socket.setEncoding("utf8");
    let buf = "";

    const onPlain = (data: string): void => {
      buf += data;
      const lines = buf.split("\n");
      buf = lines.pop()!;
      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed) continue;
        if (trimmed === "STARTTLS") {
          commands.push("STARTTLS");
          socket.removeListener("data", onPlain);
          socket.write("OK STARTTLS\n");
          // Upgrade THIS side to a TLS server socket — drives a genuine handshake.
          const tlsSocket = new tls.TLSSocket(socket, {
            isServer: true,
            secureContext: tls.createSecureContext({ cert: TEST_TLS_CERT, key: TEST_TLS_KEY }),
            // Record the SNI the client offered — RFC 6066 forbids an IP literal there.
            SNICallback: (name, cb) => {
              sniNames.push(name);
              cb(null, tls.createSecureContext({ cert: TEST_TLS_CERT, key: TEST_TLS_KEY }));
            },
          });
          connections.add(tlsSocket);
          tlsSocket.setEncoding("utf8");
          let tbuf = "";
          tlsSocket.on("data", (tdata: string) => {
            tbuf += tdata;
            const tlines = tbuf.split("\n");
            tbuf = tlines.pop()!;
            for (const tline of tlines) {
              const t = tline.trim();
              if (t) respond(tlsSocket, t);
            }
          });
          tlsSocket.on("error", () => {});
          return; // anything buffered after STARTTLS would be a protocol violation — ignore
        }
        respond(socket, trimmed);
      }
    };

    socket.on("data", onPlain);
    socket.on("error", () => {});
  });

  return {
    commands,
    sniNames,
    start: () =>
      new Promise<number>(resolve => {
        server.listen(0, "127.0.0.1", () => {
          port = (server.address() as net.AddressInfo).port;
          resolve(port);
        });
      }),
    stop: () =>
      new Promise<void>(resolve => {
        for (const c of connections) c.destroy();
        server.close(() => resolve());
      }),
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

/** A promise plus its resolver — for awaiting individual onConnect fires. */
function deferred(): { promise: Promise<void>; resolve: () => void } {
  let resolve: () => void = () => {};
  const promise = new Promise<void>(r => {
    resolve = r;
  });
  return { promise, resolve };
}

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

    it("start() after destroy opens no socket at all", async () => {
      const mock = createMockNutServer();
      const port = await mock.start();
      try {
        const client = new NutClient("127.0.0.1", port);
        client.destroy();
        // A reconnect timer that fires during teardown, or a late start() from
        // onReady racing onUnload, must not resurrect the connection.
        client.start();
        await new Promise(r => setTimeout(r, 150));
        expect(client.isConnected).toBe(false);
        expect(mock.commands, "no NUT traffic after destroy").toEqual([]);
      } finally {
        await mock.stop();
      }
    });
  });

  describe("connect-phase timeout", () => {
    it("times out the connect/STARTTLS phase instead of hanging for the OS timeout", { timeout: 10000 }, async () => {
      // Server accepts TCP and answers STARTTLS with OK, then never upgrades to TLS — the
      // client's tls.connect() would otherwise hang until the OS connect timeout (~1-2 min).
      const server = net.createServer(sock => {
        sock.setEncoding("utf8");
        sock.on("data", (d: string) => {
          if (d.includes("STARTTLS")) sock.write("OK STARTTLS\n");
          // …then nothing: no TLS handshake follows.
        });
        sock.on("error", () => {});
      });
      const port = await new Promise<number>(r =>
        server.listen(0, "127.0.0.1", () => r((server.address() as net.AddressInfo).port)),
      );
      try {
        const client = new NutClient("127.0.0.1", port, { useTls: true, commandTimeout: 300 });
        const start = Date.now();
        await expect(client.connect()).rejects.toThrow(/timed out/i);
        expect(Date.now() - start).toBeLessThan(3000);
        client.destroy();
      } finally {
        await new Promise<void>(r => server.close(() => r()));
      }
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
      const mock = createMockNutServer(cmd => {
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
      const mock = createMockNutServer(cmd => {
        if (cmd === "LIST UPS") {
          return ["BEGIN LIST UPS", 'UPS ups0 "Main \\"backup\\" UPS"', "END LIST UPS"];
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
      const mock = createMockNutServer(cmd => {
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
      const mock = createMockNutServer(cmd => {
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
      const mock = createMockNutServer(cmd => {
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

    it("refuses a value containing a line break at the wire (defense in depth)", async () => {
      // A SET VAR value goes out quoted and escapeNut neutralises quotes/backslashes, so upsd
      // reads a newline inside the quotes literally — it cannot be smuggled into a second command.
      // The client still refuses it up front rather than send a malformed line.
      const mock = createMockNutServer();
      const port = await mock.start();
      try {
        const client = new NutClient("127.0.0.1", port);
        await client.connect();
        mock.commands.length = 0;
        await expect(client.setVar("ups0", "outlet.desc", "x\nINSTCMD ups0 load.off")).rejects.toThrow();
        expect(mock.commands.some(c => c.includes("INSTCMD"))).toBe(false);
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
      const mock = createMockNutServer(cmd => {
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

    it("refuses a password with a line break — the one unquoted path onto the wire", async () => {
      // USERNAME/PASSWORD are sent without quotes, so a newline in the value (a pasted credential
      // with a trailing newline) would split into a bogus second command line. Refuse it instead.
      const mock = createMockNutServer();
      const port = await mock.start();
      try {
        const client = new NutClient("127.0.0.1", port);
        await client.connect();
        mock.commands.length = 0;
        await expect(client.authenticate("admin", "secret\nLOGOUT")).rejects.toThrow();
        expect(mock.commands.some(c => c === "LOGOUT")).toBe(false);
        client.destroy();
      } finally {
        await mock.stop();
      }
    });

    it("should reject on INVALID-PASSWORD", async () => {
      const mock = createMockNutServer(cmd => {
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
      const mock = createMockNutServer(cmd => {
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
      const mock = createMockNutServer(cmd => {
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
      const mock = createMockNutServer(cmd => {
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
      const mock = createMockNutServer(cmd => {
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

        const [ups, vars, cmds] = await Promise.all([client.listUps(), client.listVar("ups0"), client.listCmd("ups0")]);

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
      const mock = createMockNutServer(cmd => {
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

    it("desyncs and reconnects after a command timeout (resync)", { timeout: 10000 }, async () => {
      let respond = false;
      const mock = createMockNutServer(cmd => {
        if (cmd.startsWith("GET VAR")) {
          return respond ? 'VAR ups0 ups.load "15"' : null; // no response → timeout
        }
        return "ERR UNKNOWN-COMMAND";
      });
      const port = await mock.start();
      try {
        const client = new NutClient("127.0.0.1", port, { commandTimeout: 80 });
        const first = deferred();
        const reconnected = deferred();
        let n = 0;
        client.setOnConnect(() => {
          n += 1;
          (n === 1 ? first : reconnected).resolve();
        });
        client.start();
        await first.promise;

        // A timeout desyncs the stream (no request IDs) → drop the connection to resync.
        await expect(client.getVar("ups0", "battery.charge")).rejects.toThrow(NutTimeoutError);
        expect(client.isConnected).toBe(false);

        // …then it reconnects and commands work again on a clean stream.
        respond = true;
        await reconnected.promise;
        expect(client.isConnected).toBe(true);
        const val = await client.getVar("ups0", "ups.load");
        expect(val).toBe("15");

        client.destroy();
      } finally {
        await mock.stop();
      }
    });
    it("does not time out a queued command for the time it waits behind an active one", { timeout: 10000 }, async () => {
      // Every response is delayed by DELAY ms. Two commands go out via Promise.all (as poll()
      // does): LIST VAR is active from t=0 (done ~DELAY); LIST RW waits in the queue and only
      // becomes active at ~DELAY (done ~2·DELAY). With the timeout armed at ENQUEUE it fires at
      // commandTimeout from t=0 and kills LIST RW even though it barely had any *active* time.
      const DELAY = 200;
      const server = net.createServer(sock => {
        sock.setEncoding("utf8");
        let buf = "";
        sock.on("data", (d: string) => {
          buf += d;
          const lines = buf.split("\n");
          buf = lines.pop() ?? "";
          for (const line of lines) {
            const cmd = line.trim();
            setTimeout(() => {
              if (cmd.startsWith("LIST VAR")) {
                sock.write('BEGIN LIST VAR ups0\nVAR ups0 battery.charge "100"\nEND LIST VAR ups0\n');
              } else if (cmd.startsWith("LIST RW")) {
                sock.write("BEGIN LIST RW ups0\nEND LIST RW ups0\n");
              } else {
                sock.write("ERR UNKNOWN-COMMAND\n");
              }
            }, DELAY);
          }
        });
        sock.on("error", () => {});
      });
      const port = await new Promise<number>(r =>
        server.listen(0, "127.0.0.1", () => r((server.address() as net.AddressInfo).port)),
      );
      try {
        const client = new NutClient("127.0.0.1", port, { commandTimeout: 300 });
        await client.connect();
        // LIST RW needs > commandTimeout of wall-clock (queue-wait + run) but < commandTimeout
        // of *active* time. It must NOT be timed out and drop the connection.
        const [vars, rw] = await Promise.all([client.listVar("ups0"), client.listRw("ups0")]);
        expect(vars.length).toBeGreaterThan(0);
        expect(Array.isArray(rw)).toBe(true);
        expect(client.isConnected).toBe(true);
        client.destroy();
      } finally {
        await new Promise<void>(r => server.close(() => r()));
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
  // Receive-buffer bound
  // -----------------------------------------------------------------------
  describe("receive-buffer bound", () => {
    it("drops the connection when bytes stream in without a line break past the cap", { timeout: 15000 }, async () => {
      // The leak case: between commands nothing bounds the line buffer — the command timeout only
      // covers an ACTIVE command, so a server that keeps sending bytes with NO line break would
      // grow it without limit. A raw server (the shared mock always appends "\n", which would make
      // it one complete line instead) streams > cap bytes and never terminates the line.
      const server = net.createServer(socket => {
        socket.setEncoding("utf8");
        socket.on("data", (d: string) => {
          if (d.includes("GET VAR")) {
            socket.write("x".repeat(MAX_LINE_BYTES + 64)); // no trailing "\n": an unterminated line
          }
        });
      });
      await new Promise<void>(resolve => server.listen(0, "127.0.0.1", () => resolve()));
      const port = (server.address() as net.AddressInfo).port;
      try {
        const client = new NutClient("127.0.0.1", port, { commandTimeout: 10000 });
        await client.connect();
        await expect(client.getVar("ups0", "ups.status")).rejects.toThrow(/line/i);
        expect(client.isConnected).toBe(false);
        client.destroy();
      } finally {
        await new Promise<void>(resolve => server.close(() => resolve()));
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
  // Socket close drains the whole queue (not just the active command)
  // -----------------------------------------------------------------------
  describe("socket close", () => {
    it("rejects queued commands too when the connection drops (no orphaned queue entry)", { timeout: 10000 }, async () => {
      const mock = createMockNutServer(() => null); // never responds → commands stay pending
      const port = await mock.start();
      try {
        // High commandTimeout so the only way a queued command can settle is the close-drain,
        // not its own timer firing.
        const client = new NutClient("127.0.0.1", port, { commandTimeout: 10000 });
        await client.connect();

        const active = client.listUps(); // becomes active (mock hangs)
        const queued = client.listVar("ups0"); // waits in the queue behind it

        // Drop the connection from underneath both commands.
        // @ts-expect-error accessing private socket for a deterministic disconnect
        client.socket!.destroy();

        await expect(active).rejects.toThrow(); // active — handled even before the fix
        await expect(queued).rejects.toThrow(); // queued — was orphaned (never settled) before the fix

        client.destroy();
      } finally {
        await mock.stop();
      }
    });
  });

  // -----------------------------------------------------------------------
  // Reconnect
  // -----------------------------------------------------------------------
  describe("reconnect", () => {
    it("reconnects on drop and re-fires onConnect (idempotent re-entry)", { timeout: 10000 }, async () => {
      const mock = createMockNutServer();
      const port = await mock.start();
      try {
        const client = new NutClient("127.0.0.1", port, { commandTimeout: 2000 });
        const first = deferred();
        const reconnected = deferred();
        let n = 0;
        client.setOnConnect(() => {
          n += 1;
          (n === 1 ? first : reconnected).resolve();
        });
        client.start();
        await first.promise;
        expect(client.isConnected).toBe(true);

        // Destroy socket directly — going through TCP (mock.disconnectAll) has timing variance
        // @ts-expect-error accessing private socket for a deterministic disconnect
        client.socket!.destroy();

        await reconnected.promise;
        expect(client.isConnected).toBe(true);
        expect(n).toBe(2); // onConnect ran again on reconnect — initial == reconnect, one path
        client.destroy();
      } finally {
        await mock.stop();
      }
    });

    it("retries the initial connect with backoff until the server appears", { timeout: 10000 }, async () => {
      const probe = createMockNutServer();
      const port = await probe.start();
      await probe.stop(); // port now free → the initial connect fails (ECONNREFUSED)

      const client = new NutClient("127.0.0.1", port, { commandTimeout: 2000 });
      const connected = deferred();
      client.setOnConnect(() => connected.resolve());
      client.start();

      // Bring a server up on the same port; the backed-off retry must find it.
      const reup = net.createServer(s => {
        s.setEncoding("utf8");
        s.on("error", () => {});
      });
      await new Promise<void>(r => reup.listen(port, "127.0.0.1", () => r()));
      try {
        await connected.promise; // a retry succeeded after the initial failure
        expect(client.isConnected).toBe(true);
        client.destroy();
      } finally {
        await new Promise<void>(r => reup.close(() => r()));
      }
    });

    it("stops on a fatal TLS-config error (onFatal, no retry)", { timeout: 10000 }, async () => {
      const mock = createMockNutServer(cmd => {
        if (cmd === "STARTTLS") return "ERR FEATURE-NOT-CONFIGURED";
        return "ERR UNKNOWN-COMMAND";
      });
      const port = await mock.start();
      try {
        const client = new NutClient("127.0.0.1", port, { useTls: true });
        const fatal = deferred();
        let connectCount = 0;
        let fatalErr: unknown;
        client.setOnConnect(() => {
          connectCount += 1;
        });
        client.setOnFatal(err => {
          fatalErr = err;
          fatal.resolve();
        });
        client.start();

        await fatal.promise;
        expect((fatalErr as NutError).code).toBe("FEATURE-NOT-CONFIGURED");
        expect(client.isConnected).toBe(false);
        // No retry must be scheduled — onConnect never fires.
        await new Promise(r => setTimeout(r, 200));
        expect(connectCount).toBe(0);
        client.destroy();
      } finally {
        await mock.stop();
      }
    });

    it("stops the retry loop on destroy() during backoff", { timeout: 10000 }, async () => {
      const probe = createMockNutServer();
      const port = await probe.start();
      await probe.stop(); // port closed → initial connect fails, retry scheduled (~1s)

      const client = new NutClient("127.0.0.1", port, { commandTimeout: 2000 });
      let connectCount = 0;
      client.setOnConnect(() => {
        connectCount += 1;
      });
      client.start();

      await new Promise(r => setTimeout(r, 100)); // let the first attempt fail + arm the retry
      client.destroy();
      await new Promise(r => setTimeout(r, 1300)); // past the backoff window — retry must not fire
      expect(connectCount).toBe(0);
      expect(client.isConnected).toBe(false);
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

        expect(logs.some(l => l.includes("Connected to NUT server"))).toBe(true);
        expect(logs.some(l => l.includes(">> LIST UPS"))).toBe(true);
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
      const mock = createMockNutServer(cmd => {
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
      const server = net.createServer(socket => {
        socket.setEncoding("utf8");
        let buf = "";
        socket.on("data", (data: string) => {
          buf += data;
          if (buf.includes("\n")) {
            buf = "";
            // Send response in multiple chunks with delays
            socket.write("BEGIN LIST UPS\n");
            setTimeout(() => {
              socket.write("UPS ups");
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

      const port = await new Promise<number>(resolve => {
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
        await new Promise<void>(resolve => server.close(() => resolve()));
      }
    });

    it("should handle values with escaped backslashes", async () => {
      const mock = createMockNutServer(cmd => {
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

        expect(mock.commands).toEqual(["USERNAME admin", "PASSWORD secret", "LOGIN ups0"]);
        client.destroy();
      } finally {
        await mock.stop();
      }
    });

    it("should reject login without prior auth", async () => {
      const mock = createMockNutServer(cmd => {
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

  // -----------------------------------------------------------------------
  // STARTTLS
  // -----------------------------------------------------------------------
  describe("STARTTLS", () => {
    it(
      "upgrades to TLS and runs commands over the encrypted channel",
      { timeout: 10000 },
      async () => {
        const mock = createStartTlsMockServer(cmd => {
          if (cmd === "LIST UPS") {
            return ["BEGIN LIST UPS", 'UPS ups0 "Secure UPS"', "END LIST UPS"];
          }
          if (cmd.startsWith("GET VAR")) {
            return 'VAR ups0 battery.charge "88"';
          }
          return "ERR UNKNOWN-COMMAND";
        });
        const port = await mock.start();
        try {
          const client = new NutClient("127.0.0.1", port, { useTls: true, tlsRejectUnauthorized: false });
          await client.connect();
          expect(client.isTls).toBe(true);

          // Commands after the upgrade must travel over TLS and still parse correctly.
          const ups = await client.listUps();
          expect(ups).toEqual([{ name: "ups0", description: "Secure UPS" }]);
          const charge = await client.getVar("ups0", "battery.charge");
          expect(charge).toBe("88");
          expect(mock.commands).toContain("STARTTLS");

          client.destroy();
        } finally {
          await mock.stop();
        }
      },
    );

    it("offers no server-name for an IP address (RFC 6066)", { timeout: 10000 }, async () => {
      const mock = createStartTlsMockServer(() => "ERR UNKNOWN-COMMAND");
      const port = await mock.start();
      try {
        // Connecting by IP: an IP literal as server-name is forbidden — Node warns
        // and drops it, and a strict server can reject the handshake outright.
        const client = new NutClient("127.0.0.1", port, { useTls: true, tlsRejectUnauthorized: false });
        await client.connect();
        expect(client.isTls).toBe(true);
        expect(mock.sniNames, "no SNI for an IP host").toEqual([]);
        client.destroy();
      } finally {
        await mock.stop();
      }
    });

    it("rejects connect when the server has no TLS support", async () => {
      const mock = createMockNutServer(cmd => {
        if (cmd === "STARTTLS") return "ERR FEATURE-NOT-CONFIGURED";
        return "ERR UNKNOWN-COMMAND";
      });
      const port = await mock.start();
      try {
        const client = new NutClient("127.0.0.1", port, { useTls: true });
        await expect(client.connect()).rejects.toMatchObject({ code: "FEATURE-NOT-CONFIGURED" });
        client.destroy();
      } finally {
        await mock.stop();
      }
    });
  });

  // -----------------------------------------------------------------------
  // CRLF tolerance
  // -----------------------------------------------------------------------
  describe("CRLF tolerance", () => {
    it("parses responses terminated with CRLF", async () => {
      const server = net.createServer(socket => {
        socket.setEncoding("utf8");
        let buf = "";
        socket.on("data", (data: string) => {
          buf += data;
          const lines = buf.split("\n");
          buf = lines.pop()!;
          for (const line of lines) {
            if (line.replace(/\r$/, "").trim() === "LIST UPS") {
              socket.write("BEGIN LIST UPS\r\n");
              socket.write('UPS ups0 "CRLF UPS"\r\n');
              socket.write("END LIST UPS\r\n");
            }
          }
        });
      });
      const port = await new Promise<number>(resolve => {
        server.listen(0, "127.0.0.1", () => resolve((server.address() as net.AddressInfo).port));
      });
      try {
        const client = new NutClient("127.0.0.1", port);
        await client.connect();
        const ups = await client.listUps();
        expect(ups).toEqual([{ name: "ups0", description: "CRLF UPS" }]);
        client.destroy();
      } finally {
        await new Promise<void>(resolve => server.close(() => resolve()));
      }
    });
  });

  // -----------------------------------------------------------------------
  // LOGOUT
  // -----------------------------------------------------------------------
  describe("logout", () => {
    it("sends LOGOUT", async () => {
      const mock = createMockNutServer(cmd => {
        if (cmd === "LOGOUT") return "OK Goodbye";
        return "ERR UNKNOWN-COMMAND";
      });
      const port = await mock.start();
      try {
        const client = new NutClient("127.0.0.1", port);
        await client.connect();
        await client.logout();
        expect(mock.commands).toContain("LOGOUT");
        client.destroy();
      } finally {
        await mock.stop();
      }
    });

    it("swallows errors during logout", async () => {
      const mock = createMockNutServer(cmd => {
        if (cmd === "LOGOUT") return "ERR UNKNOWN-COMMAND";
        return "ERR UNKNOWN-COMMAND";
      });
      const port = await mock.start();
      try {
        const client = new NutClient("127.0.0.1", port);
        await client.connect();
        await expect(client.logout()).resolves.toBeUndefined();
        client.destroy();
      } finally {
        await mock.stop();
      }
    });
  });

  // -----------------------------------------------------------------------
  // shutdown (graceful onUnload teardown)
  // -----------------------------------------------------------------------
  describe("shutdown", () => {
    it("sends a best-effort LOGOUT and closes", async () => {
      let resolveLogout: () => void = () => {};
      const gotLogout = new Promise<void>(r => (resolveLogout = r));
      const mock = createMockNutServer(cmd => {
        if (cmd === "LOGOUT") {
          resolveLogout();
          return "OK Goodbye";
        }
        return "ERR UNKNOWN-COMMAND";
      });
      const port = await mock.start();
      try {
        const client = new NutClient("127.0.0.1", port);
        await client.connect();
        client.shutdown();
        // The half-close must flush the LOGOUT — the server still receives it.
        await gotLogout;
        expect(mock.commands).toContain("LOGOUT");
        expect(client.isConnected).toBe(false);
      } finally {
        await mock.stop();
      }
    });
  });
});

// ---------------------------------------------------------------------------
// isTlsConfigError — fatal (go yellow) vs. transient (retry) classification
// ---------------------------------------------------------------------------
describe("isTlsConfigError", () => {
  it("treats NUT no-TLS / SSL-mode errors as fatal", () => {
    expect(isTlsConfigError(new NutError("FEATURE-NOT-CONFIGURED"))).toBe(true);
    expect(isTlsConfigError(new NutError("FEATURE-NOT-SUPPORTED"))).toBe(true);
    expect(isTlsConfigError(new NutError("ALREADY-SSL-MODE"))).toBe(true);
  });

  it("treats certificate-verification errors as fatal", () => {
    expect(isTlsConfigError({ code: "DEPTH_ZERO_SELF_SIGNED_CERT" })).toBe(true);
    expect(isTlsConfigError({ code: "SELF_SIGNED_CERT_IN_CHAIN" })).toBe(true);
    expect(isTlsConfigError({ code: "UNABLE_TO_VERIFY_LEAF_SIGNATURE" })).toBe(true);
    expect(isTlsConfigError({ code: "CERT_HAS_EXPIRED" })).toBe(true);
    expect(isTlsConfigError({ code: "ERR_TLS_CERT_ALTNAME_INVALID" })).toBe(true);
    expect(isTlsConfigError({ code: "ERR_SSL_WRONG_VERSION_NUMBER" })).toBe(true);
  });

  it("does NOT treat transient network errors (or other NUT errors) as fatal", () => {
    expect(isTlsConfigError(Object.assign(new Error("connect ECONNREFUSED"), { code: "ECONNREFUSED" }))).toBe(false);
    expect(isTlsConfigError(Object.assign(new Error("timeout"), { code: "ETIMEDOUT" }))).toBe(false);
    expect(isTlsConfigError(new NutError("ACCESS-DENIED"))).toBe(false);
  });

  it("handles errors without a string code", () => {
    expect(isTlsConfigError(null)).toBe(false);
    expect(isTlsConfigError(undefined)).toBe(false);
    expect(isTlsConfigError("boom")).toBe(false);
    expect(isTlsConfigError(new Error("no code"))).toBe(false);
    expect(isTlsConfigError({ code: 42 })).toBe(false);
  });
});

describe("NutClient credential redaction", () => {
  it("should not log plaintext username or password at debug level", async () => {
    const debugLogs: string[] = [];
    const logger = {
      debug: (m: string) => debugLogs.push(m),
      info: () => {},
      warn: () => {},
      error: () => {},
    };
    const mock = createMockNutServer(cmd =>
      cmd.startsWith("USERNAME") || cmd.startsWith("PASSWORD") ? "OK" : "ERR UNKNOWN-COMMAND",
    );
    const port = await mock.start();
    const client = new NutClient("127.0.0.1", port, { logger });
    try {
      await client.connect();
      await client.authenticate("secretuser", "s3cr3t-pw");
      expect(debugLogs.some(l => l.includes("s3cr3t-pw"))).toBe(false);
      expect(debugLogs.some(l => l.includes("secretuser"))).toBe(false);
      expect(debugLogs).toContain(">> USERNAME ***");
      expect(debugLogs).toContain(">> PASSWORD ***");
    } finally {
      client.destroy();
      await mock.stop();
    }
  });
});
