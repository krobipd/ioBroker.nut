import { ALL_FLAG_KEYS, getDisplayString, parseStatus, STATUS_FLAGS } from "./status-parser";

describe("status-parser", () => {
  // -----------------------------------------------------------------------
  // Individual flags
  // -----------------------------------------------------------------------
  describe("flag parsing", () => {
    it("should parse OL as online", () => {
      const r = parseStatus("OL");
      expect(r.flags.online).toBe(true);
      expect(r.flags.onBattery).toBe(false);
    });

    it("should parse OB as onBattery", () => {
      const r = parseStatus("OB");
      expect(r.flags.onBattery).toBe(true);
      expect(r.flags.online).toBe(false);
    });

    it("should parse LB as lowBattery", () => {
      const r = parseStatus("LB");
      expect(r.flags.lowBattery).toBe(true);
    });

    it("should parse HB as highBattery", () => {
      const r = parseStatus("HB");
      expect(r.flags.highBattery).toBe(true);
    });

    it("should parse RB as replaceBattery", () => {
      const r = parseStatus("RB");
      expect(r.flags.replaceBattery).toBe(true);
    });

    it("should parse CHRG as charging", () => {
      const r = parseStatus("CHRG");
      expect(r.flags.charging).toBe(true);
    });

    it("should parse DISCHRG as discharging", () => {
      const r = parseStatus("DISCHRG");
      expect(r.flags.discharging).toBe(true);
    });

    it("should parse BYPASS as bypass", () => {
      const r = parseStatus("BYPASS");
      expect(r.flags.bypass).toBe(true);
    });

    it("should parse CAL as calibrating", () => {
      const r = parseStatus("CAL");
      expect(r.flags.calibrating).toBe(true);
    });

    it("should parse OFF as off", () => {
      const r = parseStatus("OFF");
      expect(r.flags.off).toBe(true);
    });

    it("should parse OVER as overloaded", () => {
      const r = parseStatus("OVER");
      expect(r.flags.overloaded).toBe(true);
    });

    it("should parse TRIM as trimming", () => {
      const r = parseStatus("TRIM");
      expect(r.flags.trimming).toBe(true);
    });

    it("should parse BOOST as boosting", () => {
      const r = parseStatus("BOOST");
      expect(r.flags.boosting).toBe(true);
    });

    it("should parse FSD as forcedShutdown", () => {
      const r = parseStatus("FSD");
      expect(r.flags.forcedShutdown).toBe(true);
    });

    it("should parse ALARM as alarm", () => {
      const r = parseStatus("ALARM");
      expect(r.flags.alarm).toBe(true);
    });

    it("should parse COMM as commEstablished", () => {
      const r = parseStatus("COMM");
      expect(r.flags.commEstablished).toBe(true);
    });

    it("should parse NOCOMM as commLost", () => {
      const r = parseStatus("NOCOMM");
      expect(r.flags.commLost).toBe(true);
    });

    it("should parse TEST as testing", () => {
      const r = parseStatus("TEST");
      expect(r.flags.testing).toBe(true);
    });

    it("should parse HE as highEfficiency", () => {
      const r = parseStatus("HE");
      expect(r.flags.highEfficiency).toBe(true);
    });
  });

  // -----------------------------------------------------------------------
  // Flag combinations
  // -----------------------------------------------------------------------
  describe("flag combinations", () => {
    it("should parse OL CHRG", () => {
      const r = parseStatus("OL CHRG");
      expect(r.flags.online).toBe(true);
      expect(r.flags.charging).toBe(true);
      expect(r.flags.onBattery).toBe(false);
    });

    it("should parse OB LB", () => {
      const r = parseStatus("OB LB");
      expect(r.flags.onBattery).toBe(true);
      expect(r.flags.lowBattery).toBe(true);
    });

    it("should parse OB LB FSD", () => {
      const r = parseStatus("OB LB FSD");
      expect(r.flags.onBattery).toBe(true);
      expect(r.flags.lowBattery).toBe(true);
      expect(r.flags.forcedShutdown).toBe(true);
    });

    it("should parse OL TRIM", () => {
      const r = parseStatus("OL TRIM");
      expect(r.flags.online).toBe(true);
      expect(r.flags.trimming).toBe(true);
    });

    it("should parse OL HB", () => {
      const r = parseStatus("OL HB");
      expect(r.flags.online).toBe(true);
      expect(r.flags.highBattery).toBe(true);
    });

    it("should parse OL HE", () => {
      const r = parseStatus("OL HE");
      expect(r.flags.online).toBe(true);
      expect(r.flags.highEfficiency).toBe(true);
    });
  });

  // -----------------------------------------------------------------------
  // Raw value
  // -----------------------------------------------------------------------
  describe("raw value", () => {
    it("should preserve the raw status string", () => {
      expect(parseStatus("OL CHRG").raw).toBe("OL CHRG");
    });

    it("should preserve single flag", () => {
      expect(parseStatus("OL").raw).toBe("OL");
    });
  });

  // -----------------------------------------------------------------------
  // Severity computation
  // -----------------------------------------------------------------------
  describe("severity", () => {
    it("should be 0 for OL (OK)", () => {
      expect(parseStatus("OL").severity).toBe(0);
    });

    it("should be 0 for OL CHRG (OK)", () => {
      expect(parseStatus("OL CHRG").severity).toBe(0);
    });

    it("should be 0 for OL HB (OK)", () => {
      expect(parseStatus("OL HB").severity).toBe(0);
    });

    it("should be 0 for HE (OK — informational)", () => {
      expect(parseStatus("HE").severity).toBe(0);
    });

    it("should be 0 for OL HE (OK — informational)", () => {
      expect(parseStatus("OL HE").severity).toBe(0);
    });

    it("should be 1 for TRIM (Info)", () => {
      expect(parseStatus("TRIM").severity).toBe(1);
    });

    it("should be 1 for OL TRIM (Info)", () => {
      expect(parseStatus("OL TRIM").severity).toBe(1);
    });

    it("should be 1 for BOOST (Info)", () => {
      expect(parseStatus("BOOST").severity).toBe(1);
    });

    it("should be 1 for CAL (Info)", () => {
      expect(parseStatus("CAL").severity).toBe(1);
    });

    it("should be 2 for OB without LB (Warning)", () => {
      expect(parseStatus("OB").severity).toBe(2);
    });

    it("should be 2 for RB (Warning)", () => {
      expect(parseStatus("RB").severity).toBe(2);
    });

    it("should be 2 for BYPASS (Warning)", () => {
      expect(parseStatus("BYPASS").severity).toBe(2);
    });

    it("should be 3 for OB LB (Critical)", () => {
      expect(parseStatus("OB LB").severity).toBe(3);
    });

    it("should be 4 for FSD (Emergency)", () => {
      expect(parseStatus("FSD").severity).toBe(4);
    });

    it("should be 4 for OB LB FSD (Emergency — highest wins)", () => {
      expect(parseStatus("OB LB FSD").severity).toBe(4);
    });
  });

  // -----------------------------------------------------------------------
  // Edge cases
  // -----------------------------------------------------------------------
  describe("edge cases", () => {
    it("should handle empty string", () => {
      const r = parseStatus("");
      expect(r.severity).toBe(0);
      expect(Object.values(r.flags).every(v => v === false)).toBe(true);
    });

    it("should handle whitespace-only string", () => {
      const r = parseStatus("   ");
      expect(r.severity).toBe(0);
    });

    it("should ignore unknown flags", () => {
      const r = parseStatus("OL UNKNOWN_FLAG CHRG");
      expect(r.flags.online).toBe(true);
      expect(r.flags.charging).toBe(true);
    });

    it("should handle leading/trailing whitespace", () => {
      const r = parseStatus("  OL  ");
      expect(r.flags.online).toBe(true);
    });

    it("should handle TICK/TOCK (unknown but not crashing)", () => {
      const r = parseStatus("OL TICK");
      expect(r.flags.online).toBe(true);
    });
  });

  // -----------------------------------------------------------------------
  // Constants
  // -----------------------------------------------------------------------
  describe("constants", () => {
    it("should have 19 status flags", () => {
      expect(Object.keys(STATUS_FLAGS).length).toBe(19);
    });

    it("should have matching ALL_FLAG_KEYS", () => {
      expect(ALL_FLAG_KEYS.length).toBe(Object.keys(STATUS_FLAGS).length);
    });

    it("should have unique flag key names", () => {
      const unique = new Set(ALL_FLAG_KEYS);
      expect(unique.size).toBe(ALL_FLAG_KEYS.length);
    });
  });

  // -----------------------------------------------------------------------
  // Display string
  // -----------------------------------------------------------------------
  describe("getDisplayString", () => {
    it("should convert OL to Online", () => {
      expect(getDisplayString("OL")).toBe("Online");
    });

    it("should convert OL CHRG to Online, Charging", () => {
      expect(getDisplayString("OL CHRG")).toBe("Online, Charging");
    });

    it("should convert OB LB to On Battery, Low Battery", () => {
      expect(getDisplayString("OB LB")).toBe("On Battery, Low Battery");
    });

    it("should convert OB LB FSD to three labels", () => {
      expect(getDisplayString("OB LB FSD")).toBe("On Battery, Low Battery, Forced Shutdown");
    });

    it("should pass through unknown tokens", () => {
      expect(getDisplayString("OL UNKNOWN")).toBe("Online, UNKNOWN");
    });

    it("should handle empty string", () => {
      expect(getDisplayString("")).toBe("");
    });

    it("should handle OL HE", () => {
      expect(getDisplayString("OL HE")).toBe("Online, High Efficiency");
    });
  });

  // -----------------------------------------------------------------------
  // Default-false initialization
  // -----------------------------------------------------------------------
  describe("default-false initialization", () => {
    it("should set all flags to false when none are active", () => {
      const r = parseStatus("");
      for (const key of ALL_FLAG_KEYS) {
        expect(r.flags[key]).toBe(false);
      }
    });

    it("should have all flags present even for single-flag input", () => {
      const r = parseStatus("OL");
      for (const key of ALL_FLAG_KEYS) {
        expect(key in r.flags).toBe(true);
      }
    });
  });
});
