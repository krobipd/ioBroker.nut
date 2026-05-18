/** Adapter configuration as stored in ioBroker native config. */
export interface AdapterConfig {
  /** NUT server hostname or IP */
  host: string;
  /** NUT server port */
  port: number;
  /** Local network interface for outgoing connections */
  networkInterface: string;
  /** Poll interval in seconds */
  pollInterval: number;
  /** NUT username (optional, for SET/INSTCMD) */
  username: string;
  /** NUT password (optional) */
  password: string;
  /** Per-command timeout in seconds */
  commandTimeout: number;
  /** Enable instant commands (INSTCMD) */
  enableCommands: boolean;
  /** Enable writable variables (SET VAR) */
  enableSetVar: boolean;
}

/** UPS device discovered via LIST UPS. */
export interface UpsInfo {
  /** UPS identifier */
  name: string;
  /** UPS description */
  description: string;
}

/** NUT variable from LIST VAR / LIST RW. */
export interface NutVariable {
  /** Variable name (e.g. battery.charge) */
  name: string;
  /** Raw string value */
  value: string;
}

/** NUT instant command from LIST CMD. */
export interface NutCommand {
  /** Command name (e.g. beeper.enable) */
  name: string;
}

/** NUT range constraint from LIST RANGE. */
export interface NutRange {
  /** Minimum value */
  min: string;
  /** Maximum value */
  max: string;
}

/** Logger interface for the NUT client. */
export interface NutLogger {
  /** Debug-level log */
  debug(message: string): void;
  /** Warning-level log */
  warn(message: string): void;
  /** Info-level log */
  info(message: string): void;
}

/** Options for NutClient constructor. */
export interface NutClientOptions {
  /** Local address to bind to (network interface selection) */
  localAddress?: string;
  /** Per-command timeout in milliseconds */
  commandTimeout?: number;
  /** Optional logger */
  logger?: NutLogger;
}

/** Default NUT TCP port. */
export const NUT_DEFAULT_PORT = 3493;
/** Default per-command timeout in milliseconds. */
export const NUT_DEFAULT_COMMAND_TIMEOUT = 5000;

/** All known NUT error codes. */
export const NUT_ERRORS = [
  "ACCESS-DENIED",
  "UNKNOWN-UPS",
  "VAR-NOT-SUPPORTED",
  "CMD-NOT-SUPPORTED",
  "INVALID-ARGUMENT",
  "INSTCMD-FAILED",
  "SET-FAILED",
  "READONLY",
  "TOO-LONG",
  "FEATURE-NOT-SUPPORTED",
  "FEATURE-NOT-CONFIGURED",
  "ALREADY-SSL-MODE",
  "DRIVER-NOT-CONNECTED",
  "DATA-STALE",
  "ALREADY-LOGGED-IN",
  "INVALID-PASSWORD",
  "ALREADY-SET-PASSWORD",
  "INVALID-USERNAME",
  "ALREADY-SET-USERNAME",
  "USERNAME-REQUIRED",
  "PASSWORD-REQUIRED",
  "UNKNOWN-COMMAND",
  "INVALID-VALUE",
] as const;

/** Union type of all known NUT error codes. */
export type NutErrorCode = (typeof NUT_ERRORS)[number];
