import * as net from "node:net";
import * as tls from "node:tls";
import { computeReconnectDelay } from "./coerce";
import type { NutClientOptions, NutCommand, NutLogger, NutRange, NutVariable, UpsInfo } from "./types";
import { NUT_DEFAULT_COMMAND_TIMEOUT } from "./types";

/** Reconnect backoff bounds (exponential: 1s, 2s, 4s … capped at 60s). */
const RECONNECT_BASE_MS = 1000;
const RECONNECT_MAX_MS = 60000;

/** NUT protocol error with error code (see types.ts:NUT_ERRORS for the documented set). */
export class NutError extends Error {
  /**
   * @param code NUT error code (a server may send codes outside the documented set, so this is `string`)
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

// Errors from connect()/STARTTLS that signal a TLS *configuration* problem (server offers
// no TLS, or its certificate was rejected) rather than a transient network failure.
const TLS_FATAL_ERROR_CODES = new Set<string>([
  // NUT-level: the server cannot/does not start TLS
  "FEATURE-NOT-CONFIGURED",
  "FEATURE-NOT-SUPPORTED",
  "ALREADY-SSL-MODE",
  // Node certificate-verification failures (only reachable with tlsRejectUnauthorized=true)
  "DEPTH_ZERO_SELF_SIGNED_CERT",
  "SELF_SIGNED_CERT_IN_CHAIN",
  "UNABLE_TO_VERIFY_LEAF_SIGNATURE",
  "CERT_HAS_EXPIRED",
  "ERR_TLS_CERT_ALTNAME_INVALID",
]);

/**
 * Whether a failed TLS connect is a configuration problem (won't fix itself → go yellow,
 * no retry) as opposed to a transient network error (ECONNREFUSED/ETIMEDOUT → retry).
 *
 * @param err Caught value from a failed connect()/STARTTLS
 */
export function isTlsConfigError(err: unknown): boolean {
  if (err instanceof NutError) {
    return TLS_FATAL_ERROR_CODES.has(err.code);
  }
  const code = (err as { code?: unknown } | null)?.code;
  if (typeof code !== "string") {
    return false;
  }
  // Explicit set above, plus the whole OpenSSL/TLS-layer code family.
  return TLS_FATAL_ERROR_CODES.has(code) || code.startsWith("ERR_TLS_") || code.startsWith("ERR_SSL_");
}

interface QueueEntry {
  command: string;
  resolve: (lines: string[]) => void;
  reject: (err: Error) => void;
  timer: unknown;
  multiLine: boolean;
}

/** Persistent TCP client for the NUT protocol (port 3493), with optional STARTTLS. */
export class NutClient {
  private socket: net.Socket | tls.TLSSocket | null = null;
  private buffer = "";
  private queue: QueueEntry[] = [];
  private active: QueueEntry | null = null;
  private multiLineBuffer: string[] = [];
  private multiLineExpectedEnd = "";
  private connected = false;
  private destroyed = false;
  private tlsActive = false;

  private readonly host: string;
  private readonly port: number;
  private readonly localAddress?: string;
  private readonly commandTimeout: number;
  private readonly useTls: boolean;
  private readonly tlsRejectUnauthorized: boolean;
  private readonly log?: NutLogger;
  // Injected managed timers (adapter.setTimeout/clearTimeout in production → auto-cleared on
  // unload; global timers as fallback for standalone use/tests).
  private readonly setTimer: (cb: () => void, ms: number) => unknown;
  private readonly clearTimer: (handle: unknown) => void;

  private reconnectAttempt = 0;
  private reconnectTimer: unknown = null;
  // Persistent mode (set by start()) owns the unified retry loop: it retries the initial
  // connect, reconnects on drops, and stops yellow on a fatal TLS-config error. A plain
  // connect() (e.g. the connection test) leaves this false — one-shot, never retries.
  private persistent = false;
  private onConnectHandler: (() => void) | null = null;
  private onFatalHandler: ((err: unknown) => void) | null = null;

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
    this.useTls = options?.useTls ?? false;
    this.tlsRejectUnauthorized = options?.tlsRejectUnauthorized ?? false;
    this.log = options?.logger;
    this.setTimer = options?.setTimer ?? ((cb, ms) => globalThis.setTimeout(cb, ms));
    this.clearTimer = options?.clearTimer ?? (h => globalThis.clearTimeout(h as ReturnType<typeof setTimeout>));
  }

  /**
   * Register a callback invoked after every successful (re)connection in persistent mode.
   * Runs the post-connect setup (discover/auth/poll); must be idempotent.
   *
   * @param handler Connect callback
   */
  setOnConnect(handler: () => void): void {
    this.onConnectHandler = handler;
  }

  /**
   * Register a callback invoked when the persistent connection fails fatally (TLS
   * misconfiguration) — the retry loop stops and the caller should go yellow.
   *
   * @param handler Fatal-error callback
   */
  setOnFatal(handler: (err: unknown) => void): void {
    this.onFatalHandler = handler;
  }

  /**
   * Start the persistent runtime connection: connect now and keep retrying with exponential
   * backoff, reconnecting automatically on later drops. A fatal TLS-config error stops the
   * loop (onFatal). Use connect() directly for a one-shot (e.g. the connection test).
   */
  start(): void {
    this.persistent = true;
    this.reconnectAttempt = 0;
    this.attemptConnect();
  }

  /** One iteration of the persistent loop: connect, then fire onConnect or handle the failure. */
  private attemptConnect(): void {
    // Shortcut, deliberately without its own test: connect() rejects on a
    // destroyed client and handleConnectFailure bails on it too, so removing
    // this check changes nothing observable (equivalent mutant, 2026-08-22 test
    // audit). It stays because it keeps a torn-down client from even entering
    // the loop.
    if (this.destroyed) {
      return;
    }
    this.connect()
      .then(() => {
        this.reconnectAttempt = 0;
        this.onConnectHandler?.();
      })
      .catch((err: unknown) => this.handleConnectFailure(err));
  }

  /**
   * Decide a failed persistent connect: a TLS-config error stops the loop (onFatal, yellow);
   * any other error schedules a backed-off retry.
   *
   * @param err The connect/STARTTLS failure
   */
  private handleConnectFailure(err: unknown): void {
    if (this.destroyed) {
      return;
    }
    // Tear down the failed socket so the next attempt starts clean. Clearing `connected`
    // first means the close handler sees wasConnected=false and won't double-schedule.
    this.connected = false;
    const sock = this.socket;
    this.socket = null;
    sock?.destroy();

    const msg = err instanceof Error ? err.message : String(err);
    if (this.useTls && isTlsConfigError(err)) {
      this.log?.warn(`TLS connection to NUT server ${this.host}:${this.port} failed — not retrying: ${msg}`);
      this.onFatalHandler?.(err);
      return;
    }
    this.log?.debug(`Connect attempt failed: ${msg}`);
    this.scheduleReconnect();
  }

  /** Establish TCP connection (and STARTTLS upgrade if configured) to the NUT server. */
  connect(): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      if (this.destroyed) {
        reject(new Error("Client has been destroyed"));
        return;
      }

      // Bound the connect phase (TCP connect + optional STARTTLS handshake). net/tls have no
      // built-in deadline here, and the per-command timeout only applies once connected, so a
      // blackholed SYN or a stalled TLS handshake would otherwise hang for the OS timeout
      // (~1-2 min) — freezing reconnect attempts and the admin connection test.
      let settled = false;
      const deadline = this.setTimer(() => {
        if (settled) {
          return;
        }
        settled = true;
        const sock = this.socket;
        this.socket = null;
        this.connected = false;
        sock?.destroy();
        reject(new Error(`Connect to NUT server ${this.host}:${this.port} timed out`));
      }, this.commandTimeout);
      const settle = (err?: Error): void => {
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

      const opts: net.NetConnectOpts = { host: this.host, port: this.port };
      if (this.localAddress) {
        opts.localAddress = this.localAddress;
      }

      const socket = net.createConnection(opts, () => {
        this.connected = true;
        this.tlsActive = false;
        this.buffer = "";
        this.log?.debug(`Connected to NUT server ${this.host}:${this.port}`);
        if (this.useTls) {
          this.startTls()
            .then(() => settle())
            .catch(settle);
        } else {
          settle();
        }
      });
      this.socket = socket;
      // Detect a dead peer (NAT/firewall idle-drop leaves a half-open socket otherwise).
      socket.setKeepAlive(true, 30000);
      this.wireSocket(socket, settle);
    });
  }

  /**
   * Attach data/error/close handlers to the current socket.
   *
   * @param socket The socket (plaintext or TLS) to wire up
   * @param rejectConnect Optional connect() rejector, called if the socket errors before connecting
   */
  private wireSocket(socket: net.Socket | tls.TLSSocket, rejectConnect?: (err: Error) => void): void {
    socket.setEncoding("utf8");
    socket.on("data", (data: string) => this.onData(data));
    socket.on("error", (err: Error) => {
      this.log?.debug(`Socket error: ${err.message}`);
      if (!this.connected && rejectConnect) {
        rejectConnect(err);
      }
    });
    socket.on("close", () => {
      const wasConnected = this.connected;
      this.connected = false;
      // Drain the WHOLE queue, not just the active command: a queued entry left behind would keep
      // a live command timer that fires later and tears down a subsequently-reconnected socket.
      this.rejectAll(new Error("Connection closed"));
      // Only the persistent runtime connection auto-reconnects on a drop; a one-shot
      // connect() (e.g. the connection test) must not.
      if (wasConnected && !this.destroyed && this.persistent) {
        this.log?.warn(`Connection to NUT server ${this.host}:${this.port} lost`);
        this.scheduleReconnect();
      }
    });
  }

  /** Upgrade the plaintext socket to TLS via STARTTLS. */
  private async startTls(): Promise<void> {
    const plain = this.socket as net.Socket;
    await this.sendCommand("STARTTLS", false); // throws NutError on FEATURE-NOT-CONFIGURED/-SUPPORTED
    // After "OK STARTTLS" the server begins TLS immediately — nothing plaintext may follow.
    plain.removeAllListeners("data");
    plain.removeAllListeners("error");
    plain.removeAllListeners("close");
    this.buffer = "";

    // SNI must be a hostname — RFC 6066 forbids an IP literal (Node warns + ignores it).
    const servername = net.isIP(this.host) === 0 ? this.host : undefined;
    await new Promise<void>((resolve, reject) => {
      const tlsSocket = tls.connect(
        { socket: plain, rejectUnauthorized: this.tlsRejectUnauthorized, servername },
        () => {
          this.tlsActive = true;
          this.log?.debug(`STARTTLS established with ${this.host}:${this.port}`);
          resolve();
        },
      );
      tlsSocket.once("error", (err: Error) => reject(err));
      this.socket = tlsSocket;
      this.wireSocket(tlsSocket);
    });
  }

  /** Synchronous teardown — destroys socket, no LOGOUT sent. */
  destroy(): void {
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
  shutdown(): void {
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
  cancelAll(): void {
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
  private rejectAll(err: Error): void {
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
  get isConnected(): boolean {
    return this.connected;
  }

  /** Whether the connection is TLS-encrypted. */
  get isTls(): boolean {
    return this.tlsActive;
  }

  /** Discover all UPS devices on the NUT server. */
  listUps(): Promise<UpsInfo[]> {
    return this.parseList("LIST UPS", /^UPS\s+(\S+)\s+"((?:[^"\\]|\\.)*)"/, m => ({
      name: m[1],
      description: unescapeNut(m[2]),
    }));
  }

  /**
   * List all variables for a UPS.
   *
   * @param ups UPS name
   */
  listVar(ups: string): Promise<NutVariable[]> {
    return this.parseList(`LIST VAR ${ups}`, /^VAR\s+\S+\s+(\S+)\s+"((?:[^"\\]|\\.)*)"/, m => ({
      name: m[1],
      value: unescapeNut(m[2]),
    }));
  }

  /**
   * List writable variables for a UPS.
   *
   * @param ups UPS name
   */
  listRw(ups: string): Promise<NutVariable[]> {
    return this.parseList(`LIST RW ${ups}`, /^RW\s+\S+\s+(\S+)\s+"((?:[^"\\]|\\.)*)"/, m => ({
      name: m[1],
      value: unescapeNut(m[2]),
    }));
  }

  /**
   * List available instant commands for a UPS.
   *
   * @param ups UPS name
   */
  listCmd(ups: string): Promise<NutCommand[]> {
    return this.parseList(`LIST CMD ${ups}`, /^CMD\s+\S+\s+(\S+)/, m => ({ name: m[1] }));
  }

  /**
   * List enum values for a variable.
   *
   * @param ups UPS name
   * @param varName Variable name
   */
  listEnum(ups: string, varName: string): Promise<string[]> {
    return this.parseList(`LIST ENUM ${ups} ${varName}`, /^ENUM\s+\S+\s+\S+\s+"((?:[^"\\]|\\.)*)"/, m =>
      unescapeNut(m[1]),
    );
  }

  /**
   * List range constraints for a variable.
   *
   * @param ups UPS name
   * @param varName Variable name
   */
  listRange(ups: string, varName: string): Promise<NutRange[]> {
    return this.parseList(
      `LIST RANGE ${ups} ${varName}`,
      /^RANGE\s+\S+\s+\S+\s+"((?:[^"\\]|\\.)*)"\s+"((?:[^"\\]|\\.)*)"/,
      m => ({ min: unescapeNut(m[1]), max: unescapeNut(m[2]) }),
    );
  }

  /**
   * Generic LIST/multi-line parser — runs a regex per response line and maps matches.
   *
   * @param command The LIST command to send
   * @param lineRegex Regex applied to each response line
   * @param map Maps a matched line to a result item
   */
  private async parseList<T>(command: string, lineRegex: RegExp, map: (m: RegExpExecArray) => T): Promise<T[]> {
    const lines = await this.sendCommand(command, true);
    const result: T[] = [];
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

  /** Best-effort LOGOUT (graceful lifecycle; ignores errors). */
  async logout(): Promise<void> {
    try {
      await this.sendCommand("LOGOUT", false);
    } catch {
      // Ignore — we are shutting down anyway.
    }
  }

  private sendCommand(command: string, multiLine: boolean): Promise<string[]> {
    return new Promise<string[]>((resolve, reject) => {
      // A NUT command is exactly one protocol line. A newline embedded in an argument (e.g. a
      // SET VAR value the user supplied — escapeNut only handles quotes/backslashes) would split
      // into a second line the server executes as its own command: that bypasses the
      // enableCommands safety gate (…"\nINSTCMD ups load.off"…). Reject before anything reaches
      // the wire; a real NUT variable value never contains a line break.
      if (/[\r\n]/.test(command)) {
        reject(new Error("NUT command must not contain line breaks"));
        return;
      }
      if (!this.connected || !this.socket) {
        reject(new Error("Not connected"));
        return;
      }

      // The command timeout is armed when the command becomes ACTIVE (processQueue), not here:
      // otherwise the time a command waits in the queue behind a slower one eats into its budget,
      // and a queued command can spuriously time out — dropping an otherwise-healthy connection.
      const entry: QueueEntry = { command, resolve, reject, timer: null, multiLine };
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
  private resyncAfterTimeout(command: string): void {
    // Only the active command carries a live timer (armed in processQueue), so a fired timeout
    // always refers to the active command — already rejected in its timer callback. Null it so
    // the cancelAll() below doesn't reject it a second time.
    if (this.active?.command === command) {
      this.active = null;
    }
    // Drop the socket — reflect it synchronously so callers see the desync immediately and the
    // async 'close' handler sees wasConnected=false (no double-schedule). cancelAll() drains the
    // rest of the queue; scheduleReconnect() brings the connection back on a clean stream.
    this.connected = false;
    this.cancelAll();
    this.socket?.destroy();
    this.scheduleReconnect();
  }

  private processQueue(): void {
    if (this.active || this.queue.length === 0) {
      return;
    }

    const entry = this.queue.shift()!;
    this.active = entry;

    // Arm the command timeout now that the command is active (see sendCommand): the full budget
    // applies to active time only, never to queue-wait. A fired timer therefore always refers to
    // the active command.
    entry.timer = this.setTimer(() => {
      entry.reject(new NutTimeoutError(entry.command));
      // A timed-out command desyncs the stream (NUT has no request IDs — a late reply would be
      // mis-attributed to the next command). Drop the connection and reconnect to resync.
      this.resyncAfterTimeout(entry.command);
    }, this.commandTimeout);

    this.log?.debug(`>> ${redactForLog(entry.command)}`);

    if (entry.multiLine) {
      this.multiLineBuffer = [];
      const query = entry.command.replace(/^LIST\s+/, "");
      this.multiLineExpectedEnd = `END LIST ${query}`;
    }

    this.socket?.write(`${entry.command}\n`);
  }

  private onData(data: string): void {
    this.buffer += data;
    const lines = this.buffer.split("\n");
    this.buffer = lines.pop()!;

    for (const line of lines) {
      // NUT uses LF; tolerate CRLF from non-conformant servers.
      this.processLine(line.endsWith("\r") ? line.slice(0, -1) : line);
    }
  }

  private processLine(line: string): void {
    if (!this.active) {
      this.log?.debug(`<< (no active command) ${line}`);
      return;
    }

    if (line.startsWith("ERR ")) {
      const code = line.slice(4).trim();
      this.clearTimer(this.active.timer);
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
        this.clearTimer(this.active.timer);
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
    this.clearTimer(this.active.timer);
    const entry = this.active;
    this.active = null;
    entry.resolve([line]);
    this.processQueue();
  }

  private scheduleReconnect(): void {
    // Only the persistent runtime loop reconnects; guard against double-scheduling.
    if (this.destroyed || this.reconnectTimer || !this.persistent) {
      return;
    }

    this.reconnectAttempt += 1;
    const delay = computeReconnectDelay(this.reconnectAttempt, RECONNECT_BASE_MS, RECONNECT_MAX_MS);
    this.log?.debug(`Reconnecting in ${delay}ms (attempt ${this.reconnectAttempt})`);

    this.reconnectTimer = this.setTimer(() => {
      this.reconnectTimer = null;
      this.log?.debug(`Attempting reconnect to ${this.host}:${this.port}`);
      this.attemptConnect();
    }, delay);
  }
}

function unescapeNut(s: string): string {
  return s.replace(/\\"/g, '"').replace(/\\\\/g, "\\");
}

function escapeNut(s: string): string {
  return s.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

/**
 * Redact NUT credential commands before they are logged. USERNAME/PASSWORD carry values declared
 * protected/encrypted in io-package.json — they must never reach the log file, even at debug level.
 * The wire write still uses the unredacted command; only the log line is masked.
 *
 * @param command The raw NUT command about to be sent
 */
function redactForLog(command: string): string {
  if (command.startsWith("PASSWORD ")) {
    return "PASSWORD ***";
  }
  if (command.startsWith("USERNAME ")) {
    return "USERNAME ***";
  }
  return command;
}
