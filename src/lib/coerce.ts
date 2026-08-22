import { NUT_DEFAULT_COMMAND_TIMEOUT, NUT_DEFAULT_PORT } from "./types";

// Strict decimal-only number parsing (fleet line, hassemu E8 origin): a plain
// float parse would half-accept garbage suffixes ("34abc" → 34) and allow
// hex/exponential notation. Only `-?\d+(\.\d+)?` counts as a number.
const DECIMAL_NUMBER_RE = /^-?\d+(\.\d+)?$/;

/**
 * Strict decimal parse: returns the number only for a plain finite decimal
 * (`-?\d+(\.\d+)?`), otherwise NaN. Rejects garbage suffixes ("12abc"),
 * non-finite tokens ("Infinity") and hex/exponential notation. Shared by the
 * config validators and the device-value type detector.
 *
 * @param raw Raw value (string from NUT/admin config, or already a number)
 */
export function parseDecimal(raw: unknown): number {
  if (typeof raw === "number") {
    return Number.isFinite(raw) ? raw : NaN;
  }
  if (typeof raw === "string" && DECIMAL_NUMBER_RE.test(raw.trim())) {
    return Number(raw.trim());
  }
  return NaN;
}

/**
 * Extract a log-friendly message from a thrown / rejected value.
 *
 * @param err Caught value of unknown shape
 */
export function errText(err: unknown): string {
  if (err instanceof Error) {
    return err.message;
  }
  if (err === null) {
    return "null";
  }
  if (err === undefined) {
    return "undefined";
  }
  if (typeof err === "string") {
    return err;
  }
  if (typeof err === "number" || typeof err === "boolean" || typeof err === "bigint") {
    return String(err);
  }
  if (typeof err === "symbol") {
    // JSON.stringify(Symbol()) returns undefined (it does NOT throw), so the
    // catch below would never run and the declared `string` return would be a
    // lie. String(symbol) is the only safe conversion — `${symbol}` throws.
    return String(err);
  }
  // Plain objects would otherwise stringify to "[object Object]". Prefer JSON so
  // the log is at least diagnosable; circular structures fall back to the tag.
  try {
    // A function, or an object whose toJSON drops everything, also yields
    // undefined here — fall back rather than returning a non-string.
    return JSON.stringify(err) ?? Object.prototype.toString.call(err);
  } catch {
    return Object.prototype.toString.call(err);
  }
}

/**
 * Validate and return the NUT server host. Returns null if the host
 * is missing or not a non-empty string after trimming.
 *
 * @param raw Raw host value from admin config
 */
export function coerceHost(raw: unknown): string | null {
  if (typeof raw !== "string") {
    return null;
  }
  const trimmed = raw.trim();
  return trimmed.length > 0 ? trimmed : null;
}

/**
 * Resolve the outgoing source-bind address from the admin `networkInterface`.
 * Empty or the "all interfaces" sentinel `0.0.0.0` mean "let the OS choose the
 * source" → undefined (no explicit bind).
 *
 * @param raw Raw networkInterface value from admin config
 */
export function localAddressOf(raw: unknown): string | undefined {
  if (typeof raw !== "string") {
    return undefined;
  }
  const trimmed = raw.trim();
  return trimmed.length > 0 && trimmed !== "0.0.0.0" ? trimmed : undefined;
}

/**
 * Coerce NUT port to a valid integer in [1, 65535], default NUT_DEFAULT_PORT.
 *
 * @param raw Raw port value from admin config
 */
export function coercePort(raw: unknown): number {
  const n = parseDecimal(raw);
  if (!Number.isFinite(n)) {
    return NUT_DEFAULT_PORT;
  }
  return Math.max(1, Math.min(65535, Math.floor(n)));
}

/**
 * Coerce poll interval to seconds, clamped to [2, 300], default 15.
 * Matches admin/jsonConfig min/max.
 *
 * The lower bound is where NUT itself stops producing new data: ups.conf's
 * `pollinterval` — how often the driver refreshes the UPS status — defaults to
 * 2 seconds, and `pollfreq` (the full variable set, usbhid-ups/snmp-ups/nutdrv_qx)
 * to 30. Polling faster than the driver only re-reads unchanged values.
 *
 * @param raw Raw pollInterval from admin config (seconds)
 */
export function coercePollIntervalSec(raw: unknown): number {
  const n = parseDecimal(raw);
  if (!Number.isFinite(n)) {
    return 15;
  }
  return Math.max(2, Math.min(300, Math.floor(n)));
}

/**
 * Coerce command timeout from seconds to milliseconds,
 * clamped to [1s, 30s] → [1000, 30000], default 5000ms.
 *
 * @param raw Raw commandTimeout from admin config (seconds)
 */
export function coerceCommandTimeoutMs(raw: unknown): number {
  const n = parseDecimal(raw);
  if (!Number.isFinite(n)) {
    return NUT_DEFAULT_COMMAND_TIMEOUT;
  }
  return Math.max(1, Math.min(30, Math.floor(n))) * 1000;
}

/**
 * Exponential reconnect backoff: attempt 1 → baseMs, doubling each attempt, capped at maxMs.
 *
 * @param attempt 1-based attempt counter (values < 1 are treated as 1)
 * @param baseMs Delay for the first attempt
 * @param maxMs Upper bound for the delay
 */
export function computeReconnectDelay(attempt: number, baseMs: number, maxMs: number): number {
  const a = Math.max(1, Math.floor(attempt));
  return Math.min(baseMs * 2 ** (a - 1), maxMs);
}
