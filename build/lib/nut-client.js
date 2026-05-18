"use strict";
var __create = Object.create;
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __getProtoOf = Object.getPrototypeOf;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __export = (target, all) => {
  for (var name in all) __defProp(target, name, { get: all[name], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if ((from && typeof from === "object") || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, {
          get: () => from[key],
          enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable,
        });
  }
  return to;
};
var __toESM = (mod, isNodeMode, target) => (
  (target = mod != null ? __create(__getProtoOf(mod)) : {}),
  __copyProps(
    // If the importer is in node compatibility mode or this is not an ESM
    // file that has been converted to a CommonJS file using a Babel-
    // compatible transform (i.e. "__esModule" has not been set), then set
    // "default" to the CommonJS "module.exports" for node compatibility.
    isNodeMode || !mod || !mod.__esModule ? __defProp(target, "default", { value: mod, enumerable: true }) : target,
    mod,
  )
);
var __toCommonJS = mod => __copyProps(__defProp({}, "__esModule", { value: true }), mod);
var nut_client_exports = {};
__export(nut_client_exports, {
  NutClient: () => NutClient,
  NutError: () => NutError,
  NutTimeoutError: () => NutTimeoutError,
});
module.exports = __toCommonJS(nut_client_exports);
var net = __toESM(require("node:net"));
var import_types = require("./types");
class NutError extends Error {
  /**
   * @param code NUT error code
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
class NutClient {
  socket = null;
  buffer = "";
  queue = [];
  active = null;
  multiLineBuffer = [];
  multiLineExpectedEnd = "";
  connected = false;
  destroyed = false;
  host;
  port;
  localAddress;
  commandTimeout;
  log;
  reconnectDelay = 1e3;
  reconnectTimer = null;
  onReconnectHandler = null;
  /**
   * @param host NUT server hostname or IP
   * @param port NUT server port
   * @param options Connection options
   */
  constructor(host, port, options) {
    var _a;
    this.host = host;
    this.port = port;
    this.localAddress = options == null ? void 0 : options.localAddress;
    this.commandTimeout =
      (_a = options == null ? void 0 : options.commandTimeout) != null ? _a : import_types.NUT_DEFAULT_COMMAND_TIMEOUT;
    this.log = options == null ? void 0 : options.logger;
  }
  /**
   * Register a callback invoked after successful reconnect.
   *
   * @param handler Reconnect callback
   */
  setOnReconnect(handler) {
    this.onReconnectHandler = handler;
  }
  /** Establish TCP connection to the NUT server. */
  connect() {
    return new Promise((resolve, reject) => {
      if (this.destroyed) {
        reject(new Error("Client has been destroyed"));
        return;
      }
      const opts = {
        host: this.host,
        port: this.port,
      };
      if (this.localAddress) {
        opts.localAddress = this.localAddress;
      }
      this.socket = net.createConnection(opts, () => {
        var _a;
        this.connected = true;
        this.reconnectDelay = 1e3;
        this.buffer = "";
        (_a = this.log) == null ? void 0 : _a.debug(`Connected to NUT server ${this.host}:${this.port}`);
        resolve();
      });
      this.socket.setEncoding("utf8");
      this.socket.on("data", data => {
        this.onData(data);
      });
      this.socket.on("error", err => {
        var _a;
        (_a = this.log) == null ? void 0 : _a.debug(`Socket error: ${err.message}`);
        if (!this.connected) {
          reject(err);
        }
      });
      this.socket.on("close", () => {
        var _a;
        const wasConnected = this.connected;
        this.connected = false;
        this.rejectActive(new Error("Connection closed"));
        if (wasConnected && !this.destroyed) {
          (_a = this.log) == null ? void 0 : _a.warn(`Connection to NUT server ${this.host}:${this.port} lost`);
          this.scheduleReconnect();
        }
      });
    });
  }
  /** Synchronous teardown — destroys socket, no LOGOUT sent. */
  destroy() {
    this.destroyed = true;
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    this.cancelAll();
    if (this.socket) {
      this.socket.destroy();
      this.socket = null;
    }
    this.connected = false;
  }
  /** Reject all pending and queued commands. */
  cancelAll() {
    const err = new Error("Client cancelled");
    if (this.active) {
      clearTimeout(this.active.timer);
      this.active.reject(err);
      this.active = null;
    }
    for (const entry of this.queue) {
      clearTimeout(entry.timer);
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
  /** Discover all UPS devices on the NUT server. */
  async listUps() {
    const lines = await this.sendCommand("LIST UPS", true);
    const result = [];
    for (const line of lines) {
      const match = /^UPS\s+(\S+)\s+"((?:[^"\\]|\\.)*)"/.exec(line);
      if (match) {
        result.push({ name: match[1], description: unescapeNut(match[2]) });
      }
    }
    return result;
  }
  /**
   * List all variables for a UPS.
   *
   * @param ups UPS name
   */
  async listVar(ups) {
    const lines = await this.sendCommand(`LIST VAR ${ups}`, true);
    const result = [];
    for (const line of lines) {
      const match = /^VAR\s+\S+\s+(\S+)\s+"((?:[^"\\]|\\.)*)"/.exec(line);
      if (match) {
        result.push({ name: match[1], value: unescapeNut(match[2]) });
      }
    }
    return result;
  }
  /**
   * List writable variables for a UPS.
   *
   * @param ups UPS name
   */
  async listRw(ups) {
    const lines = await this.sendCommand(`LIST RW ${ups}`, true);
    const result = [];
    for (const line of lines) {
      const match = /^RW\s+\S+\s+(\S+)\s+"((?:[^"\\]|\\.)*)"/.exec(line);
      if (match) {
        result.push({ name: match[1], value: unescapeNut(match[2]) });
      }
    }
    return result;
  }
  /**
   * List available instant commands for a UPS.
   *
   * @param ups UPS name
   */
  async listCmd(ups) {
    const lines = await this.sendCommand(`LIST CMD ${ups}`, true);
    const result = [];
    for (const line of lines) {
      const match = /^CMD\s+\S+\s+(\S+)/.exec(line);
      if (match) {
        result.push({ name: match[1] });
      }
    }
    return result;
  }
  /**
   * List enum values for a variable.
   *
   * @param ups UPS name
   * @param varName Variable name
   */
  async listEnum(ups, varName) {
    const lines = await this.sendCommand(`LIST ENUM ${ups} ${varName}`, true);
    const result = [];
    for (const line of lines) {
      const match = /^ENUM\s+\S+\s+\S+\s+"((?:[^"\\]|\\.)*)"/.exec(line);
      if (match) {
        result.push(unescapeNut(match[1]));
      }
    }
    return result;
  }
  /**
   * List range constraints for a variable.
   *
   * @param ups UPS name
   * @param varName Variable name
   */
  async listRange(ups, varName) {
    const lines = await this.sendCommand(`LIST RANGE ${ups} ${varName}`, true);
    const result = [];
    for (const line of lines) {
      const match = /^RANGE\s+\S+\s+\S+\s+"((?:[^"\\]|\\.)*)"\s+"((?:[^"\\]|\\.)*)"/.exec(line);
      if (match) {
        result.push({ min: unescapeNut(match[1]), max: unescapeNut(match[2]) });
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
  sendCommand(command, multiLine) {
    return new Promise((resolve, reject) => {
      if (!this.connected || !this.socket) {
        reject(new Error("Not connected"));
        return;
      }
      const timer = setTimeout(() => {
        var _a;
        if (((_a = this.active) == null ? void 0 : _a.command) === command) {
          this.active = null;
        } else {
          this.queue = this.queue.filter(e => e.command !== command);
        }
        reject(new NutTimeoutError(command));
        this.processQueue();
      }, this.commandTimeout);
      const entry = { command, resolve, reject, timer, multiLine };
      this.queue.push(entry);
      if (!this.active) {
        this.processQueue();
      }
    });
  }
  processQueue() {
    var _a, _b;
    if (this.active || this.queue.length === 0) {
      return;
    }
    this.active = this.queue.shift();
    (_a = this.log) == null ? void 0 : _a.debug(`>> ${this.active.command}`);
    if (this.active.multiLine) {
      this.multiLineBuffer = [];
      const query = this.active.command.replace(/^LIST\s+/, "");
      this.multiLineExpectedEnd = `END LIST ${query}`;
    }
    (_b = this.socket) == null
      ? void 0
      : _b.write(`${this.active.command}
`);
  }
  onData(data) {
    this.buffer += data;
    const lines = this.buffer.split("\n");
    this.buffer = lines.pop();
    for (const line of lines) {
      this.processLine(line);
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
      clearTimeout(this.active.timer);
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
        clearTimeout(this.active.timer);
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
    clearTimeout(this.active.timer);
    const entry = this.active;
    this.active = null;
    entry.resolve([line]);
    this.processQueue();
  }
  rejectActive(err) {
    if (this.active) {
      clearTimeout(this.active.timer);
      this.active.reject(err);
      this.active = null;
    }
    this.multiLineBuffer = [];
    this.multiLineExpectedEnd = "";
  }
  scheduleReconnect() {
    var _a;
    if (this.destroyed || this.reconnectTimer) {
      return;
    }
    (_a = this.log) == null ? void 0 : _a.debug(`Reconnecting in ${this.reconnectDelay}ms`);
    this.reconnectTimer = setTimeout(() => {
      var _a2;
      this.reconnectTimer = null;
      if (this.destroyed) {
        return;
      }
      (_a2 = this.log) == null ? void 0 : _a2.debug(`Attempting reconnect to ${this.host}:${this.port}`);
      this.connect()
        .then(() => {
          var _a3, _b;
          (_a3 = this.log) == null ? void 0 : _a3.info(`Reconnected to NUT server ${this.host}:${this.port}`);
          (_b = this.onReconnectHandler) == null ? void 0 : _b.call(this);
        })
        .catch(err => {
          var _a3;
          (_a3 = this.log) == null ? void 0 : _a3.debug(`Reconnect failed: ${err.message}`);
          this.reconnectDelay = Math.min(this.reconnectDelay * 2, 6e4);
          this.scheduleReconnect();
        });
    }, this.reconnectDelay);
  }
}
function unescapeNut(s) {
  return s.replace(/\\"/g, '"').replace(/\\\\/g, "\\");
}
function escapeNut(s) {
  return s.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}
// Annotate the CommonJS export names for ESM import in node:
0 &&
  (module.exports = {
    NutClient,
    NutError,
    NutTimeoutError,
  });
//# sourceMappingURL=nut-client.js.map
