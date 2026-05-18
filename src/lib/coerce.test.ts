import { coerceCommandTimeoutMs, coerceHost, coercePollIntervalSec, coercePort, errText } from "./coerce";

describe("coerce", () => {
  // -----------------------------------------------------------------------
  // errText
  // -----------------------------------------------------------------------
  describe("errText", () => {
    it("should extract message from Error", () => {
      expect(errText(new Error("boom"))).toBe("boom");
    });

    it("should return 'null' for null", () => {
      expect(errText(null)).toBe("null");
    });

    it("should return 'undefined' for undefined", () => {
      expect(errText(undefined)).toBe("undefined");
    });

    it("should return strings as-is", () => {
      expect(errText("something")).toBe("something");
    });

    it("should stringify numbers", () => {
      expect(errText(42)).toBe("42");
    });

    it("should stringify booleans", () => {
      expect(errText(true)).toBe("true");
      expect(errText(false)).toBe("false");
    });

    it("should stringify bigints", () => {
      expect(errText(BigInt(99))).toBe("99");
    });

    it("should JSON.stringify plain objects", () => {
      expect(errText({ code: "ECONNREFUSED" })).toBe('{"code":"ECONNREFUSED"}');
    });

    it("should handle circular objects gracefully", () => {
      const obj: Record<string, unknown> = {};
      obj.self = obj;
      expect(typeof errText(obj)).toBe("string");
    });
  });

  // -----------------------------------------------------------------------
  // coerceHost
  // -----------------------------------------------------------------------
  describe("coerceHost", () => {
    it("should return trimmed host string", () => {
      expect(coerceHost("  192.168.1.100  ")).toBe("192.168.1.100");
    });

    it("should return hostname as-is", () => {
      expect(coerceHost("nas.local")).toBe("nas.local");
    });

    it("should return null for empty string", () => {
      expect(coerceHost("")).toBeNull();
    });

    it("should return null for whitespace-only string", () => {
      expect(coerceHost("   ")).toBeNull();
    });

    it("should return null for non-string types", () => {
      expect(coerceHost(42)).toBeNull();
      expect(coerceHost(null)).toBeNull();
      expect(coerceHost(undefined)).toBeNull();
      expect(coerceHost(true)).toBeNull();
      expect(coerceHost({})).toBeNull();
    });
  });

  // -----------------------------------------------------------------------
  // coercePort
  // -----------------------------------------------------------------------
  describe("coercePort", () => {
    it("should return valid port as-is", () => {
      expect(coercePort(3493)).toBe(3493);
      expect(coercePort(8080)).toBe(8080);
    });

    it("should return default 3493 for NaN", () => {
      expect(coercePort(NaN)).toBe(3493);
    });

    it("should return default 3493 for non-number types", () => {
      expect(coercePort(null)).toBe(3493);
      expect(coercePort(undefined)).toBe(3493);
      expect(coercePort("abc")).toBe(3493);
    });

    it("should parse numeric strings", () => {
      expect(coercePort("3493")).toBe(3493);
      expect(coercePort("9999")).toBe(9999);
    });

    it("should clamp to minimum 1", () => {
      expect(coercePort(0)).toBe(1);
      expect(coercePort(-5)).toBe(1);
    });

    it("should clamp to maximum 65535", () => {
      expect(coercePort(70000)).toBe(65535);
      expect(coercePort(99999)).toBe(65535);
    });

    it("should floor fractional values", () => {
      expect(coercePort(3493.7)).toBe(3493);
      expect(coercePort(1.9)).toBe(1);
    });

    it("should return default for Infinity", () => {
      expect(coercePort(Infinity)).toBe(3493);
      expect(coercePort(-Infinity)).toBe(3493);
    });
  });

  // -----------------------------------------------------------------------
  // coercePollIntervalSec
  // -----------------------------------------------------------------------
  describe("coercePollIntervalSec", () => {
    it("should return valid interval as-is", () => {
      expect(coercePollIntervalSec(15)).toBe(15);
      expect(coercePollIntervalSec(60)).toBe(60);
    });

    it("should return default 15 for NaN", () => {
      expect(coercePollIntervalSec(NaN)).toBe(15);
    });

    it("should return default 15 for non-number types", () => {
      expect(coercePollIntervalSec(null)).toBe(15);
      expect(coercePollIntervalSec(undefined)).toBe(15);
      expect(coercePollIntervalSec("abc")).toBe(15);
    });

    it("should parse numeric strings", () => {
      expect(coercePollIntervalSec("30")).toBe(30);
    });

    it("should clamp to minimum 5", () => {
      expect(coercePollIntervalSec(1)).toBe(5);
      expect(coercePollIntervalSec(0)).toBe(5);
      expect(coercePollIntervalSec(-10)).toBe(5);
    });

    it("should clamp to maximum 300", () => {
      expect(coercePollIntervalSec(500)).toBe(300);
      expect(coercePollIntervalSec(9999)).toBe(300);
    });

    it("should floor fractional values", () => {
      expect(coercePollIntervalSec(15.9)).toBe(15);
    });

    it("should return default for Infinity", () => {
      expect(coercePollIntervalSec(Infinity)).toBe(15);
    });
  });

  // -----------------------------------------------------------------------
  // coerceCommandTimeoutMs
  // -----------------------------------------------------------------------
  describe("coerceCommandTimeoutMs", () => {
    it("should convert seconds to milliseconds", () => {
      expect(coerceCommandTimeoutMs(5)).toBe(5000);
      expect(coerceCommandTimeoutMs(10)).toBe(10000);
    });

    it("should return default 5000ms for NaN", () => {
      expect(coerceCommandTimeoutMs(NaN)).toBe(5000);
    });

    it("should return default 5000ms for non-number types", () => {
      expect(coerceCommandTimeoutMs(null)).toBe(5000);
      expect(coerceCommandTimeoutMs(undefined)).toBe(5000);
      expect(coerceCommandTimeoutMs("abc")).toBe(5000);
    });

    it("should parse numeric strings", () => {
      expect(coerceCommandTimeoutMs("10")).toBe(10000);
    });

    it("should clamp to minimum 1s = 1000ms", () => {
      expect(coerceCommandTimeoutMs(0)).toBe(1000);
      expect(coerceCommandTimeoutMs(-5)).toBe(1000);
    });

    it("should clamp to maximum 30s = 30000ms", () => {
      expect(coerceCommandTimeoutMs(60)).toBe(30000);
      expect(coerceCommandTimeoutMs(999)).toBe(30000);
    });

    it("should floor fractional values before converting", () => {
      expect(coerceCommandTimeoutMs(5.9)).toBe(5000);
    });

    it("should return default for Infinity", () => {
      expect(coerceCommandTimeoutMs(Infinity)).toBe(5000);
    });
  });
});
