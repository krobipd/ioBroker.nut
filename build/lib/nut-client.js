"use strict";
var __create = Object.create;
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __getProtoOf = Object.getPrototypeOf;
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
var __toESM = (mod, isNodeMode, target) => (target = mod != null ? __create(__getProtoOf(mod)) : {}, __copyProps(
  // If the importer is in node compatibility mode or this is not an ESM
  // file that has been converted to a CommonJS file using a Babel-
  // compatible transform (i.e. "__esModule" has not been set), then set
  // "default" to the CommonJS "module.exports" for node compatibility.
  isNodeMode || !mod || !mod.__esModule ? __defProp(target, "default", { value: mod, enumerable: true }) : target,
  mod
));
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);
var nut_client_exports = {};
__export(nut_client_exports, {
  NutClient: () => NutClient,
  NutError: () => NutError,
  NutTimeoutError: () => NutTimeoutError,
  isTlsConfigError: () => isTlsConfigError
});
module.exports = __toCommonJS(nut_client_exports);
var net = __toESM(require("node:net"));
var tls = __toESM(require("node:tls"));
var import_coerce = require("./coerce");
var import_types = require("./types");
const RECONNECT_BASE_MS = 1e3;
const RECONNECT_MAX_MS = 6e4;
class NutError extends Error {
  /**
   * @param code NUT error code (a server may send codes outside the documented set, so this is `string`)
   * @param message Optional custom message
   */
  constructor(code, message) {
    super(message != null ? message : `NUT error: ${code}`);
    this.code = code;
    this.name = "NutError";
  }
}
class NutTimeoutError extends Error {
  /**
   * @param command The command that timed out
   */
  constructor(command) {
    super(`NUT command timed out: ${command}`);
    this.command = command;
    this.name = "NutTimeoutError";
  }
}
const TLS_FATAL_ERROR_CODES = /* @__PURE__ */ new Set([
  // NUT-level: the server cannot/does not start TLS
  "FEATURE-NOT-CONFIGURED",
  "FEATURE-NOT-SUPPORTED",
  "ALREADY-SSL-MODE",
  // Node certificate-verification failures (only reachable with tlsRejectUnauthorized=true)
  "DEPTH_ZERO_SELF_SIGNED_CERT",
  "SELF_SIGNED_CERT_IN_CHAIN",
  "UNABLE_TO_VERIFY_LEAF_SIGNATURE",
  "CERT_HAS_EXPIRED",
  "ERR_TLS_CERT_ALTNAME_INVALID"
]);
function isTlsConfigError(err) {
  if (err instanceof NutError) {
    return TLS_FATAL_ERROR_CODES.has(err.code);
  }
  const code = err == null ? void 0 : err.code;
  if (typeof code !== "string") {
    return false;
  }
  return TLS_FATAL_ERROR_CODES.has(code) || code.startsWith("ERR_TLS_") || code.startsWith("ERR_SSL_");
}
class NutClient {
  socket = null;
  buffer = "";
  queue = [];
  active = null;
  multiLineBuffer = [];
  multiLineExpectedEnd = "";
  connected = false;
  destroyed = false;
  tlsActive = false;
  host;
  port;
  localAddress;
  commandTimeout;
  useTls;
  tlsRejectUnauthorized;
  log;
  // Injected managed timers (adapter.setTimeout/clearTimeout in production → auto-cleared on
  // unload; global timers as fallback for standalone use/tests).
  setTimer;
  clearTimer;
  reconnectAttempt = 0;
  reconnectTimer = null;
  // Persistent mode (set by start()) owns the unified retry loop: it retries the initial
  // connect, reconnects on drops, and stops yellow on a fatal TLS-config error. A plain
  // connect() (e.g. the connection test) leaves this false — one-shot, never retries.
  persistent = false;
  onConnectHandler = null;
  onFatalHandler = null;
  /**
   * @param host NUT server hostname or IP
   * @param port NUT server port
   * @param options Connection options
   */
  constructor(host, port, options) {
    var _a, _b, _c, _d, _e;
    this.host = host;
    this.port = port;
    this.localAddress = options == null ? void 0 : options.localAddress;
    this.commandTimeout = (_a = options == null ? void 0 : options.commandTimeout) != null ? _a : import_types.NUT_DEFAULT_COMMAND_TIMEOUT;
    this.useTls = (_b = options == null ? void 0 : options.useTls) != null ? _b : false;
    this.tlsRejectUnauthorized = (_c = options == null ? void 0 : options.tlsRejectUnauthorized) != null ? _c : false;
    this.log = options == null ? void 0 : options.logger;
    this.setTimer = (_d = options == null ? void 0 : options.setTimer) != null ? _d : ((cb, ms) => globalThis.setTimeout(cb, ms));
    this.clearTimer = (_e = options == null ? void 0 : options.clearTimer) != null ? _e : ((h) => globalThis.clearTimeout(h));
  }
  /**
   * Register a callback invoked after every successful (re)connection in persistent mode.
   * Runs the post-connect setup (discover/auth/poll); must be idempotent.
   *
   * @param handler Connect callback
   */
  setOnConnect(handler) {
    this.onConnectHandler = handler;
  }
  /**
   * Register a callback invoked when the persistent connection fails fatally (TLS
   * misconfiguration) — the retry loop stops and the caller should go yellow.
   *
   * @param handler Fatal-error callback
   */
  setOnFatal(handler) {
    this.onFatalHandler = handler;
  }
  /**
   * Start the persistent runtime connection: connect now and keep retrying with exponential
   * backoff, reconnecting automatically on later drops. A fatal TLS-config error stops the
   * loop (onFatal). Use connect() directly for a one-shot (e.g. the connection test).
   */
  start() {
    this.persistent = true;
    this.reconnectAttempt = 0;
    this.attemptConnect();
  }
  /** One iteration of the persistent loop: connect, then fire onConnect or handle the failure. */
  attemptConnect() {
    if (this.destroyed) {
      return;
    }
    this.connect().then(() => {
      var _a;
      this.reconnectAttempt = 0;
      (_a = this.onConnectHandler) == null ? void 0 : _a.call(this);
    }).catch((err) => this.handleConnectFailure(err));
  }
  /**
   * Decide a failed persistent connect: a TLS-config error stops the loop (onFatal, yellow);
   * any other error schedules a backed-off retry.
   *
   * @param err The connect/STARTTLS failure
   */
  handleConnectFailure(err) {
    var _a, _b, _c;
    if (this.destroyed) {
      return;
    }
    this.connected = false;
    const sock = this.socket;
    this.socket = null;
    sock == null ? void 0 : sock.destroy();
    const msg = err instanceof Error ? err.message : String(err);
    if (this.useTls && isTlsConfigError(err)) {
      (_a = this.log) == null ? void 0 : _a.warn(`TLS connection to NUT server ${this.host}:${this.port} failed \u2014 not retrying: ${msg}`);
      (_b = this.onFatalHandler) == null ? void 0 : _b.call(this, err);
      return;
    }
    (_c = this.log) == null ? void 0 : _c.debug(`Connect attempt failed: ${msg}`);
    this.scheduleReconnect();
  }
  /** Establish TCP connection (and STARTTLS upgrade if configured) to the NUT server. */
  connect() {
    return new Promise((resolve, reject) => {
      if (this.destroyed) {
        reject(new Error("Client has been destroyed"));
        return;
      }
      let settled = false;
      const deadline = this.setTimer(() => {
        if (settled) {
          return;
        }
        settled = true;
        const sock = this.socket;
        this.socket = null;
        this.connected = false;
        sock == null ? void 0 : sock.destroy();
        reject(new Error(`Connect to NUT server ${this.host}:${this.port} timed out`));
      }, this.commandTimeout);
      const settle = (err) => {
        if (settled) {
          return;
        }
        settled = true;
        this.clearTimer(deadline);
        if (err) {
          reject(err);
        } else {
          resolve();
        }
      };
      const opts = { host: this.host, port: this.port };
      if (this.localAddress) {
        opts.localAddress = this.localAddress;
      }
      const socket = net.createConnection(opts, () => {
        var _a;
        this.connected = true;
        this.tlsActive = false;
        this.buffer = "";
        (_a = this.log) == null ? void 0 : _a.debug(`Connected to NUT server ${this.host}:${this.port}`);
        if (this.useTls) {
          this.startTls().then(() => settle()).catch(settle);
        } else {
          settle();
        }
      });
      this.socket = socket;
      socket.setKeepAlive(true, 3e4);
      this.wireSocket(socket, settle);
    });
  }
  /**
   * Attach data/error/close handlers to the current socket.
   *
   * @param socket The socket (plaintext or TLS) to wire up
   * @param rejectConnect Optional connect() rejector, called if the socket errors before connecting
   */
  wireSocket(socket, rejectConnect) {
    socket.setEncoding("utf8");
    socket.on("data", (data) => this.onData(data));
    socket.on("error", (err) => {
      var _a;
      (_a = this.log) == null ? void 0 : _a.debug(`Socket error: ${err.message}`);
      if (!this.connected && rejectConnect) {
        rejectConnect(err);
      }
    });
    socket.on("close", () => {
      var _a;
      const wasConnected = this.connected;
      this.connected = false;
      this.rejectAll(new Error("Connection closed"));
      if (wasConnected && !this.destroyed && this.persistent) {
        (_a = this.log) == null ? void 0 : _a.warn(`Connection to NUT server ${this.host}:${this.port} lost`);
        this.scheduleReconnect();
      }
    });
  }
  /** Upgrade the plaintext socket to TLS via STARTTLS. */
  async startTls() {
    const plain = this.socket;
    await this.sendCommand("STARTTLS", false);
    plain.removeAllListeners("data");
    plain.removeAllListeners("error");
    plain.removeAllListeners("close");
    this.buffer = "";
    const servername = net.isIP(this.host) === 0 ? this.host : void 0;
    await new Promise((resolve, reject) => {
      const tlsSocket = tls.connect(
        { socket: plain, rejectUnauthorized: this.tlsRejectUnauthorized, servername },
        () => {
          var _a;
          this.tlsActive = true;
          (_a = this.log) == null ? void 0 : _a.debug(`STARTTLS established with ${this.host}:${this.port}`);
          resolve();
        }
      );
      tlsSocket.once("error", (err) => reject(err));
      this.socket = tlsSocket;
      this.wireSocket(tlsSocket);
    });
  }
  /** Synchronous teardown — destroys socket, no LOGOUT sent. */
  destroy() {
    this.destroyed = true;
    if (this.reconnectTimer) {
      this.clearTimer(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    this.cancelAll();
    if (this.socket) {
      this.socket.destroy();
      this.socket = null;
    }
    this.connected = false;
  }
  /**
   * Synchronous graceful teardown for onUnload — sends a best-effort LOGOUT and half-closes
   * so the write flushes (vs. destroy()'s hard reset). Any server reply is ignored.
   */
  shutdown() {
    this.destroyed = true;
    if (this.reconnectTimer) {
      this.clearTimer(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    this.cancelAll();
    const sock = this.socket;
    this.socket = null;
    this.connected = false;
    if (sock) {
      try {
        sock.end("LOGOUT\n");
      } catch {
        sock.destroy();
      }
    }
  }
  /** Reject all pending and queued commands. */
  cancelAll() {
    this.rejectAll(new Error("Client cancelled"));
  }
  /**
   * Reject the active command AND every queued command (clearing their timers), then reset the
   * multi-line parse state. Used by cancelAll (destroy/resync) and by the socket-close handler —
   * a queued entry left behind with a live timer would fire later and tear down a
   * subsequently-reconnected socket.
   *
   * @param err Rejection reason handed to every pending command
   */
  rejectAll(err) {
    if (this.active) {
      this.clearTimer(this.active.timer);
      this.active.reject(err);
      this.active = null;
    }
    for (const entry of this.queue) {
      this.clearTimer(entry.timer);
      entry.reject(err);
    }
    this.queue = [];
    this.multiLineBuffer = [];
    this.multiLineExpectedEnd = "";
  }
  /** Whether the TCP connection is currently established. */
  get isConnected() {
    return this.connected;
  }
  /** Whether the connection is TLS-encrypted. */
  get isTls() {
    return this.tlsActive;
  }
  /** Discover all UPS devices on the NUT server. */
  listUps() {
    return this.parseList("LIST UPS", /^UPS\s+(\S+)\s+"((?:[^"\\]|\\.)*)"/, (m) => ({
      name: m[1],
      description: unescapeNut(m[2])
    }));
  }
  /**
   * List all variables for a UPS.
   *
   * @param ups UPS name
   */
  listVar(ups) {
    return this.parseList(`LIST VAR ${ups}`, /^VAR\s+\S+\s+(\S+)\s+"((?:[^"\\]|\\.)*)"/, (m) => ({
      name: m[1],
      value: unescapeNut(m[2])
    }));
  }
  /**
   * List writable variables for a UPS.
   *
   * @param ups UPS name
   */
  listRw(ups) {
    return this.parseList(`LIST RW ${ups}`, /^RW\s+\S+\s+(\S+)\s+"((?:[^"\\]|\\.)*)"/, (m) => ({
      name: m[1],
      value: unescapeNut(m[2])
    }));
  }
  /**
   * List available instant commands for a UPS.
   *
   * @param ups UPS name
   */
  listCmd(ups) {
    return this.parseList(`LIST CMD ${ups}`, /^CMD\s+\S+\s+(\S+)/, (m) => ({ name: m[1] }));
  }
  /**
   * List enum values for a variable.
   *
   * @param ups UPS name
   * @param varName Variable name
   */
  listEnum(ups, varName) {
    return this.parseList(
      `LIST ENUM ${ups} ${varName}`,
      /^ENUM\s+\S+\s+\S+\s+"((?:[^"\\]|\\.)*)"/,
      (m) => unescapeNut(m[1])
    );
  }
  /**
   * List range constraints for a variable.
   *
   * @param ups UPS name
   * @param varName Variable name
   */
  listRange(ups, varName) {
    return this.parseList(
      `LIST RANGE ${ups} ${varName}`,
      /^RANGE\s+\S+\s+\S+\s+"((?:[^"\\]|\\.)*)"\s+"((?:[^"\\]|\\.)*)"/,
      (m) => ({ min: unescapeNut(m[1]), max: unescapeNut(m[2]) })
    );
  }
  /**
   * Generic LIST/multi-line parser — runs a regex per response line and maps matches.
   *
   * @param command The LIST command to send
   * @param lineRegex Regex applied to each response line
   * @param map Maps a matched line to a result item
   */
  async parseList(command, lineRegex, map) {
    const lines = await this.sendCommand(command, true);
    const result = [];
    for (const line of lines) {
      const match = lineRegex.exec(line);
      if (match) {
        result.push(map(match));
      }
    }
    return result;
  }
  /**
   * Get a single variable value.
   *
   * @param ups UPS name
   * @param varName Variable name
   */
  async getVar(ups, varName) {
    const lines = await this.sendCommand(`GET VAR ${ups} ${varName}`, false);
    const match = /^VAR\s+\S+\s+\S+\s+"((?:[^"\\]|\\.)*)"/.exec(lines[0]);
    if (!match) {
      throw new Error(`Unexpected GET VAR response: ${lines[0]}`);
    }
    return unescapeNut(match[1]);
  }
  /**
   * Set a writable variable.
   *
   * @param ups UPS name
   * @param varName Variable name
   * @param value New value
   */
  async setVar(ups, varName, value) {
    await this.sendCommand(`SET VAR ${ups} ${varName} "${escapeNut(value)}"`, false);
  }
  /**
   * Execute an instant command.
   *
   * @param ups UPS name
   * @param cmd Command name
   */
  async instCmd(ups, cmd) {
    await this.sendCommand(`INSTCMD ${ups} ${cmd}`, false);
  }
  /**
   * Authenticate with the NUT server.
   *
   * @param username NUT username
   * @param password NUT password
   */
  async authenticate(username, password) {
    await this.sendCommand(`USERNAME ${username}`, false);
    await this.sendCommand(`PASSWORD ${password}`, false);
  }
  /**
   * Register as monitoring client for a UPS.
   *
   * @param ups UPS name
   */
  async login(ups) {
    await this.sendCommand(`LOGIN ${ups}`, false);
  }
  /** Best-effort LOGOUT (graceful lifecycle; ignores errors). */
  async logout() {
    try {
      await this.sendCommand("LOGOUT", false);
    } catch {
    }
  }
  sendCommand(command, multiLine) {
    return new Promise((resolve, reject) => {
      if (!this.connected || !this.socket) {
        reject(new Error("Not connected"));
        return;
      }
      const entry = { command, resolve, reject, timer: null, multiLine };
      this.queue.push(entry);
      if (!this.active) {
        this.processQueue();
      }
    });
  }
  /**
   * Drop the desynced connection and reconnect on a clean stream (resync).
   *
   * @param command The command that timed out
   */
  resyncAfterTimeout(command) {
    var _a, _b;
    if (((_a = this.active) == null ? void 0 : _a.command) === command) {
      this.active = null;
    }
    this.connected = false;
    this.cancelAll();
    (_b = this.socket) == null ? void 0 : _b.destroy();
    this.scheduleReconnect();
  }
  processQueue() {
    var _a, _b;
    if (this.active || this.queue.length === 0) {
      return;
    }
    const entry = this.queue.shift();
    this.active = entry;
    entry.timer = this.setTimer(() => {
      entry.reject(new NutTimeoutError(entry.command));
      this.resyncAfterTimeout(entry.command);
    }, this.commandTimeout);
    (_a = this.log) == null ? void 0 : _a.debug(`>> ${entry.command}`);
    if (entry.multiLine) {
      this.multiLineBuffer = [];
      const query = entry.command.replace(/^LIST\s+/, "");
      this.multiLineExpectedEnd = `END LIST ${query}`;
    }
    (_b = this.socket) == null ? void 0 : _b.write(`${entry.command}
`);
  }
  onData(data) {
    this.buffer += data;
    const lines = this.buffer.split("\n");
    this.buffer = lines.pop();
    for (const line of lines) {
      this.processLine(line.endsWith("\r") ? line.slice(0, -1) : line);
    }
  }
  processLine(line) {
    var _a;
    if (!this.active) {
      (_a = this.log) == null ? void 0 : _a.debug(`<< (no active command) ${line}`);
      return;
    }
    if (line.startsWith("ERR ")) {
      const code = line.slice(4).trim();
      this.clearTimer(this.active.timer);
      const entry2 = this.active;
      this.active = null;
      this.multiLineBuffer = [];
      this.multiLineExpectedEnd = "";
      entry2.reject(new NutError(code));
      this.processQueue();
      return;
    }
    if (this.active.multiLine) {
      if (line.startsWith("BEGIN LIST ")) {
        return;
      }
      if (line === this.multiLineExpectedEnd) {
        this.clearTimer(this.active.timer);
        const entry2 = this.active;
        const result = [...this.multiLineBuffer];
        this.active = null;
        this.multiLineBuffer = [];
        this.multiLineExpectedEnd = "";
        entry2.resolve(result);
        this.processQueue();
        return;
      }
      this.multiLineBuffer.push(line);
      return;
    }
    this.clearTimer(this.active.timer);
    const entry = this.active;
    this.active = null;
    entry.resolve([line]);
    this.processQueue();
  }
  scheduleReconnect() {
    var _a;
    if (this.destroyed || this.reconnectTimer || !this.persistent) {
      return;
    }
    this.reconnectAttempt += 1;
    const delay = (0, import_coerce.computeReconnectDelay)(this.reconnectAttempt, RECONNECT_BASE_MS, RECONNECT_MAX_MS);
    (_a = this.log) == null ? void 0 : _a.debug(`Reconnecting in ${delay}ms (attempt ${this.reconnectAttempt})`);
    this.reconnectTimer = this.setTimer(() => {
      var _a2;
      this.reconnectTimer = null;
      (_a2 = this.log) == null ? void 0 : _a2.debug(`Attempting reconnect to ${this.host}:${this.port}`);
      this.attemptConnect();
    }, delay);
  }
}
function unescapeNut(s) {
  return s.replace(/\\"/g, '"').replace(/\\\\/g, "\\");
}
function escapeNut(s) {
  return s.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  NutClient,
  NutError,
  NutTimeoutError,
  isTlsConfigError
});
//# sourceMappingURL=nut-client.js.map
