import * as net from "node:net";
import type { NutClientOptions, NutCommand, NutLogger, NutRange, NutVariable, UpsInfo } from "./types";
import { NUT_DEFAULT_COMMAND_TIMEOUT } from "./types";

/** NUT protocol error with error code. */
export class NutError extends Error {
  /**
   * @param code NUT error code
   * @param message Optional custom message
   */
  constructor(
    public readonly code: string,
    message?: string,
  ) {
    super(message ?? `NUT error: ${code}`);
    this.name = "NutError";
  }
}

/** NUT command timeout error. */
export class NutTimeoutError extends Error {
  /**
   * @param command The command that timed out
   */
  constructor(public readonly command: string) {
    super(`NUT command timed out: ${command}`);
    this.name = "NutTimeoutError";
  }
}

interface QueueEntry {
  command: string;
  resolve: (lines: string[]) => void;
  reject: (err: Error) => void;
  timer: ReturnType<typeof setTimeout>;
  multiLine: boolean;
}

/** Persistent TCP client for the NUT protocol (port 3493). */
export class NutClient {
  private socket: net.Socket | null = null;
  private buffer = "";
  private queue: QueueEntry[] = [];
  private active: QueueEntry | null = null;
  private multiLineBuffer: string[] = [];
  private multiLineExpectedEnd = "";
  private connected = false;
  private destroyed = false;

  private readonly host: string;
  private readonly port: number;
  private readonly localAddress?: string;
  private readonly commandTimeout: number;
  private readonly log?: NutLogger;

  private reconnectDelay = 1000;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private onReconnectHandler: (() => void) | null = null;

  /**
   * @param host NUT server hostname or IP
   * @param port NUT server port
   * @param options Connection options
   */
  constructor(host: string, port: number, options?: NutClientOptions) {
    this.host = host;
    this.port = port;
    this.localAddress = options?.localAddress;
    this.commandTimeout = options?.commandTimeout ?? NUT_DEFAULT_COMMAND_TIMEOUT;
    this.log = options?.logger;
  }

  /**
   * Register a callback invoked after successful reconnect.
   *
   * @param handler Reconnect callback
   */
  setOnReconnect(handler: () => void): void {
    this.onReconnectHandler = handler;
  }

  /** Establish TCP connection to the NUT server. */
  connect(): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      if (this.destroyed) {
        reject(new Error("Client has been destroyed"));
        return;
      }

      const opts: net.NetConnectOpts = {
        host: this.host,
        port: this.port,
      };
      if (this.localAddress) {
        opts.localAddress = this.localAddress;
      }

      this.socket = net.createConnection(opts, () => {
        this.connected = true;
        this.reconnectDelay = 1000;
        this.buffer = "";
        this.log?.debug(`Connected to NUT server ${this.host}:${this.port}`);
        resolve();
      });

      this.socket.setEncoding("utf8");

      this.socket.on("data", (data: string) => {
        this.onData(data);
      });

      this.socket.on("error", (err: Error) => {
        this.log?.debug(`Socket error: ${err.message}`);
        if (!this.connected) {
          reject(err);
        }
      });

      this.socket.on("close", () => {
        const wasConnected = this.connected;
        this.connected = false;
        this.rejectActive(new Error("Connection closed"));
        if (wasConnected && !this.destroyed) {
          this.log?.warn(`Connection to NUT server ${this.host}:${this.port} lost`);
          this.scheduleReconnect();
        }
      });
    });
  }

  /** Synchronous teardown — destroys socket, no LOGOUT sent. */
  destroy(): void {
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
  cancelAll(): void {
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
  get isConnected(): boolean {
    return this.connected;
  }

  /** Discover all UPS devices on the NUT server. */
  async listUps(): Promise<UpsInfo[]> {
    const lines = await this.sendCommand("LIST UPS", true);
    const result: UpsInfo[] = [];
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
  async listVar(ups: string): Promise<NutVariable[]> {
    const lines = await this.sendCommand(`LIST VAR ${ups}`, true);
    const result: NutVariable[] = [];
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
  async listRw(ups: string): Promise<NutVariable[]> {
    const lines = await this.sendCommand(`LIST RW ${ups}`, true);
    const result: NutVariable[] = [];
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
  async listCmd(ups: string): Promise<NutCommand[]> {
    const lines = await this.sendCommand(`LIST CMD ${ups}`, true);
    const result: NutCommand[] = [];
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
  async listEnum(ups: string, varName: string): Promise<string[]> {
    const lines = await this.sendCommand(`LIST ENUM ${ups} ${varName}`, true);
    const result: string[] = [];
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
  async listRange(ups: string, varName: string): Promise<NutRange[]> {
    const lines = await this.sendCommand(`LIST RANGE ${ups} ${varName}`, true);
    const result: NutRange[] = [];
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
  async getVar(ups: string, varName: string): Promise<string> {
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
  async setVar(ups: string, varName: string, value: string): Promise<void> {
    await this.sendCommand(`SET VAR ${ups} ${varName} "${escapeNut(value)}"`, false);
  }

  /**
   * Execute an instant command.
   *
   * @param ups UPS name
   * @param cmd Command name
   */
  async instCmd(ups: string, cmd: string): Promise<void> {
    await this.sendCommand(`INSTCMD ${ups} ${cmd}`, false);
  }

  /**
   * Authenticate with the NUT server.
   *
   * @param username NUT username
   * @param password NUT password
   */
  async authenticate(username: string, password: string): Promise<void> {
    await this.sendCommand(`USERNAME ${username}`, false);
    await this.sendCommand(`PASSWORD ${password}`, false);
  }

  /**
   * Register as monitoring client for a UPS.
   *
   * @param ups UPS name
   */
  async login(ups: string): Promise<void> {
    await this.sendCommand(`LOGIN ${ups}`, false);
  }

  private sendCommand(command: string, multiLine: boolean): Promise<string[]> {
    return new Promise<string[]>((resolve, reject) => {
      if (!this.connected || !this.socket) {
        reject(new Error("Not connected"));
        return;
      }

      const timer = setTimeout(() => {
        if (this.active?.command === command) {
          this.active = null;
        } else {
          this.queue = this.queue.filter(e => e.command !== command);
        }
        reject(new NutTimeoutError(command));
        this.processQueue();
      }, this.commandTimeout);

      const entry: QueueEntry = { command, resolve, reject, timer, multiLine };
      this.queue.push(entry);

      if (!this.active) {
        this.processQueue();
      }
    });
  }

  private processQueue(): void {
    if (this.active || this.queue.length === 0) {
      return;
    }

    this.active = this.queue.shift()!;
    this.log?.debug(`>> ${this.active.command}`);

    if (this.active.multiLine) {
      this.multiLineBuffer = [];
      const query = this.active.command.replace(/^LIST\s+/, "");
      this.multiLineExpectedEnd = `END LIST ${query}`;
    }

    this.socket?.write(`${this.active.command}\n`);
  }

  private onData(data: string): void {
    this.buffer += data;
    const lines = this.buffer.split("\n");
    this.buffer = lines.pop()!;

    for (const line of lines) {
      this.processLine(line);
    }
  }

  private processLine(line: string): void {
    if (!this.active) {
      this.log?.debug(`<< (no active command) ${line}`);
      return;
    }

    if (line.startsWith("ERR ")) {
      const code = line.slice(4).trim();
      clearTimeout(this.active.timer);
      const entry = this.active;
      this.active = null;
      this.multiLineBuffer = [];
      this.multiLineExpectedEnd = "";
      entry.reject(new NutError(code));
      this.processQueue();
      return;
    }

    if (this.active.multiLine) {
      if (line.startsWith("BEGIN LIST ")) {
        return;
      }
      if (line === this.multiLineExpectedEnd) {
        clearTimeout(this.active.timer);
        const entry = this.active;
        const result = [...this.multiLineBuffer];
        this.active = null;
        this.multiLineBuffer = [];
        this.multiLineExpectedEnd = "";
        entry.resolve(result);
        this.processQueue();
        return;
      }
      this.multiLineBuffer.push(line);
      return;
    }

    // Single-line response
    clearTimeout(this.active.timer);
    const entry = this.active;
    this.active = null;
    entry.resolve([line]);
    this.processQueue();
  }

  private rejectActive(err: Error): void {
    if (this.active) {
      clearTimeout(this.active.timer);
      this.active.reject(err);
      this.active = null;
    }
    this.multiLineBuffer = [];
    this.multiLineExpectedEnd = "";
  }

  private scheduleReconnect(): void {
    if (this.destroyed || this.reconnectTimer) {
      return;
    }

    this.log?.debug(`Reconnecting in ${this.reconnectDelay}ms`);

    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      if (this.destroyed) {
        return;
      }

      this.log?.debug(`Attempting reconnect to ${this.host}:${this.port}`);
      this.connect()
        .then(() => {
          this.log?.info(`Reconnected to NUT server ${this.host}:${this.port}`);
          this.onReconnectHandler?.();
        })
        .catch((err: Error) => {
          this.log?.debug(`Reconnect failed: ${err.message}`);
          this.reconnectDelay = Math.min(this.reconnectDelay * 2, 60000);
          this.scheduleReconnect();
        });
    }, this.reconnectDelay);
  }
}

function unescapeNut(s: string): string {
  return s.replace(/\\"/g, '"').replace(/\\\\/g, "\\");
}

function escapeNut(s: string): string {
  return s.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}
