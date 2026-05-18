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
  try {
    return JSON.stringify(err);
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
 * Coerce NUT port to a valid integer in [1, 65535], default 3493.
 *
 * @param raw Raw port value from admin config
 */
export function coercePort(raw: unknown): number {
  const n = typeof raw === "number" ? raw : typeof raw === "string" ? parseFloat(raw) : NaN;
  if (!Number.isFinite(n)) {
    return 3493;
  }
  return Math.max(1, Math.min(65535, Math.floor(n)));
}

/**
 * Coerce poll interval to seconds, clamped to [5, 300], default 15.
 * Matches admin/jsonConfig min/max.
 *
 * @param raw Raw pollInterval from admin config (seconds)
 */
export function coercePollIntervalSec(raw: unknown): number {
  const n = typeof raw === "number" ? raw : typeof raw === "string" ? parseFloat(raw) : NaN;
  if (!Number.isFinite(n)) {
    return 15;
  }
  return Math.max(5, Math.min(300, Math.floor(n)));
}

/**
 * Coerce command timeout from seconds to milliseconds,
 * clamped to [1s, 30s] → [1000, 30000], default 5000ms.
 *
 * @param raw Raw commandTimeout from admin config (seconds)
 */
export function coerceCommandTimeoutMs(raw: unknown): number {
  const n = typeof raw === "number" ? raw : typeof raw === "string" ? parseFloat(raw) : NaN;
  if (!Number.isFinite(n)) {
    return 5000;
  }
  return Math.max(1, Math.min(30, Math.floor(n))) * 1000;
}
