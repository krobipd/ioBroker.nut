import { detectStates, detectType } from "./type-detector";

describe("type-detector", () => {
  // -----------------------------------------------------------------------
  // Known-string detection
  // -----------------------------------------------------------------------
  describe("known-string variables", () => {
    it("should detect *.model as string", () => {
      const r = detectType("device.model", "Ellipse PRO 1600 ", false);
      expect(r.type).toBe("string");
      expect(r.parsedValue).toBe("Ellipse PRO 1600 ");
    });

    it("should detect *.mfr as string", () => {
      const r = detectType("device.mfr", "EATON", false);
      expect(r.type).toBe("string");
    });

    it("should detect *.serial as string", () => {
      const r = detectType("device.serial", "G364T29133", false);
      expect(r.type).toBe("string");
    });

    it("should detect *.firmware as string", () => {
      const r = detectType("ups.firmware", "01.18.0022", false);
      expect(r.type).toBe("string");
      expect(r.parsedValue).toBe("01.18.0022");
    });

    it("should detect *.status as string even when value looks numeric", () => {
      const r = detectType("ups.beeper.status", "enabled", false);
      expect(r.type).toBe("string");
    });

    it("should detect *.alarm as string", () => {
      const r = detectType("ups.alarm", "High temperature!", false);
      expect(r.type).toBe("string");
    });

    it("should detect *.type as string", () => {
      const r = detectType("battery.type", "PbAc", false);
      expect(r.type).toBe("string");
    });

    it("should detect *.desc as string", () => {
      const r = detectType("outlet.desc", "Main Outlet", false);
      expect(r.type).toBe("string");
    });

    it("should detect *.name as string", () => {
      const r = detectType("driver.name", "usbhid-ups", false);
      expect(r.type).toBe("string");
    });

    it("should detect *.id as string even with numeric value", () => {
      const r = detectType("outlet.id", "1", false);
      expect(r.type).toBe("string");
      expect(r.parsedValue).toBe("1");
    });

    it("should detect driver.flag.* as string", () => {
      const r = detectType("driver.flag.ignorelb", "enabled", false);
      expect(r.type).toBe("string");
    });

    it("should detect driver.parameter.port as string", () => {
      const r = detectType("driver.parameter.port", "auto", false);
      expect(r.type).toBe("string");
    });

    it("should detect driver.parameter.synchronous as string", () => {
      const r = detectType("driver.parameter.synchronous", "auto", false);
      expect(r.type).toBe("string");
    });

    it("should detect *.version as string", () => {
      const r = detectType("driver.version", "2.8.0", false);
      expect(r.type).toBe("string");
    });

    it("should detect *.version.* as string", () => {
      const r = detectType("driver.version.data", "MGE HID 1.46", false);
      expect(r.type).toBe("string");
    });

    it("should detect driver.version.internal as string", () => {
      const r = detectType("driver.version.internal", "0.47", false);
      expect(r.type).toBe("string");
      expect(r.parsedValue).toBe("0.47");
    });

    it("should detect *.location as string", () => {
      const r = detectType("ups.location", "Server Room", false);
      expect(r.type).toBe("string");
    });

    it("should detect *.contact as string", () => {
      const r = detectType("ups.contact", "admin@example.com", false);
      expect(r.type).toBe("string");
    });

    it("should detect ups.status as string", () => {
      const r = detectType("ups.status", "OL", false);
      expect(r.type).toBe("string");
      expect(r.role).toBe("text");
    });
  });

  // -----------------------------------------------------------------------
  // parseFloat heuristic
  // -----------------------------------------------------------------------
  describe("parseFloat heuristic", () => {
    it("should detect integer values as number", () => {
      const r = detectType("battery.charge", "100", false);
      expect(r.type).toBe("number");
      expect(r.parsedValue).toBe(100);
    });

    it("should detect float values as number", () => {
      const r = detectType("input.voltage", "221.0", false);
      expect(r.type).toBe("number");
      expect(r.parsedValue).toBe(221.0);
    });

    it("should detect negative values as number", () => {
      const r = detectType("ups.timer.shutdown", "-1", false);
      expect(r.type).toBe("number");
      expect(r.parsedValue).toBe(-1);
    });

    it("should detect non-numeric strings as string", () => {
      const r = detectType("some.unknown.var", "enabled", false);
      expect(r.type).toBe("string");
      expect(r.parsedValue).toBe("enabled");
    });

    it("should handle empty string as string", () => {
      const r = detectType("some.var", "", false);
      expect(r.type).toBe("string");
      expect(r.parsedValue).toBe("");
    });

    it("should handle whitespace-only as string", () => {
      const r = detectType("some.var", "  ", false);
      expect(r.type).toBe("string");
    });

    it("should handle value with trailing space", () => {
      const r = detectType("ups.load", "15 ", false);
      expect(r.type).toBe("number");
      expect(r.parsedValue).toBe(15);
    });

    // Strict decimal: garbage suffixes and non-finite tokens are NOT numbers
    // (krobi 2026-06-21 via test-lab: a number field never holds letters; a
    // non-finite value must not silently become null on setState).
    it("should NOT parse garbage-suffix as number (12abc)", () => {
      const r = detectType("battery.charge", "12abc", false);
      expect(r.type).toBe("string");
      expect(r.parsedValue).toBe("12abc");
      expect(r.expectedNumeric).toBe(true); // charge is a numeric quantity (%)
    });

    it("should NOT parse Infinity as number", () => {
      const r = detectType("input.voltage", "Infinity", false);
      expect(r.type).toBe("string");
      expect(r.parsedValue).toBe("Infinity");
      expect(r.expectedNumeric).toBe(true); // voltage is a numeric quantity (V)
    });

    it("flags garbage in a numeric field but not in a genuine text field", () => {
      // numeric quantity (has a unit) + garbage → expectedNumeric (discard+warn)
      expect(detectType("ups.load", "n/a", false).expectedNumeric).toBe(true);
      // no unit → a genuine text value, keep it as string
      expect(detectType("some.unknown.var", "enabled", false).expectedNumeric).toBe(false);
    });

    it("types yes/no readings as real booleans, even with a unit substring in the name", () => {
      // input.frequency.extended = "no": the "frequency" substring must NOT make it a numeric
      // field — it is a yes/no flag, so it becomes a real boolean state (not text, not discarded).
      const ext = detectType("input.frequency.extended", "no", false);
      expect(ext.type).toBe("boolean");
      expect(ext.parsedValue).toBe(false);
      expect(ext.role).toBe("indicator");
      expect(ext.expectedNumeric).toBeFalsy();

      // input.voltage.extended = "yes" (the twin) and ambient.n.present = "yes" → boolean true.
      expect(detectType("input.voltage.extended", "yes", false).type).toBe("boolean");
      expect(detectType("input.voltage.extended", "yes", false).parsedValue).toBe(true);
      expect(detectType("ambient.1.present", "yes", false).parsedValue).toBe(true);
    });

    it("treats battery.charge.approx as a numeric percent — a bound like <85 is not stored", () => {
      // A rough approximation is a percent: a clean number is stored as a number…
      const num = detectType("battery.charge.approx", "85", false);
      expect(num.type).toBe("number");
      expect(num.parsedValue).toBe(85);
      expect(num.unit).toBe("%");
      // …but a non-numeric bound ("<85") does not belong in a number field → flagged for discard.
      expect(detectType("battery.charge.approx", "<85", false).expectedNumeric).toBe(true);
    });

    it("should NOT parse -Infinity as number", () => {
      const r = detectType("output.voltage", "-Infinity", false);
      expect(r.type).toBe("string");
    });

    it("should NOT parse locale comma as number (230,4)", () => {
      const r = detectType("battery.voltage", "230,4", false);
      expect(r.type).toBe("string");
      expect(r.parsedValue).toBe("230,4");
    });

    it("should NOT parse scientific notation as number (1e3)", () => {
      const r = detectType("ups.realpower", "1e3", false);
      expect(r.type).toBe("string");
    });
  });

  // -----------------------------------------------------------------------
  // Unit detection
  // -----------------------------------------------------------------------
  describe("unit detection", () => {
    it("should assign V for voltage", () => {
      expect(detectType("input.voltage", "221.0", false).unit).toBe("V");
    });

    it("should not assign V for input.voltage.extended (boolean string, not a voltage)", () => {
      expect(detectType("input.voltage.extended", "no", false).unit).toBeUndefined();
    });

    it("should not assign V for input.voltage.extended=yes (it is a boolean)", () => {
      const r = detectType("input.voltage.extended", "yes", false);
      expect(r.unit).toBeUndefined();
      expect(r.type).toBe("boolean");
    });

    it("should assign Hz for frequency", () => {
      expect(detectType("input.frequency", "50.0", false).unit).toBe("Hz");
    });

    it("should assign A for current", () => {
      expect(detectType("output.current", "2.5", false).unit).toBe("A");
    });

    it("should assign % for charge", () => {
      expect(detectType("battery.charge", "100", false).unit).toBe("%");
    });

    it("should assign % for charge.low", () => {
      expect(detectType("battery.charge.low", "15", false).unit).toBe("%");
    });

    it("should assign % for load", () => {
      expect(detectType("ups.load", "15", false).unit).toBe("%");
    });

    it("should assign °C for temperature", () => {
      expect(detectType("ups.temperature", "32.5", false).unit).toBe("°C");
    });

    it("should assign s for runtime", () => {
      expect(detectType("battery.runtime", "2050", false).unit).toBe("s");
    });

    it("should assign s for delay", () => {
      expect(detectType("ups.delay.shutdown", "20", false).unit).toBe("s");
    });

    it("should assign s for timer", () => {
      expect(detectType("ups.timer.shutdown", "-1", false).unit).toBe("s");
    });

    it("should assign VA for power", () => {
      expect(detectType("ups.power", "159", false).unit).toBe("VA");
    });

    it("should assign VA for power.nominal", () => {
      expect(detectType("ups.power.nominal", "1600", false).unit).toBe("VA");
    });

    it("should assign W for realpower", () => {
      expect(detectType("ups.realpower", "147", false).unit).toBe("W");
    });

    it("should assign Ah for capacity", () => {
      expect(detectType("battery.capacity", "9", false).unit).toBe("Ah");
    });

    it("should assign % for efficiency", () => {
      expect(detectType("ups.efficiency", "95", false).unit).toBe("%");
    });

    it("should assign % for ambient.humidity", () => {
      expect(detectType("ambient.humidity", "45", false).unit).toBe("%");
    });

    it("should assign % for ambient.1.humidity", () => {
      expect(detectType("ambient.1.humidity", "55", false).unit).toBe("%");
    });

    it("should assign % for *.percent suffix", () => {
      expect(detectType("battery.charge.percent", "100", false).unit).toBe("%");
    });

    it("should have no unit for string variables", () => {
      expect(detectType("device.mfr", "EATON", false).unit).toBeUndefined();
    });

    it("should have no unit for unknown numeric variables", () => {
      expect(detectType("ups.productid", "ffff", false).unit).toBeUndefined();
    });
  });

  // -----------------------------------------------------------------------
  // Role detection
  // -----------------------------------------------------------------------
  describe("role detection", () => {
    it("should assign value.battery for battery.charge", () => {
      expect(detectType("battery.charge", "100", false).role).toBe("value.battery");
    });

    it("should assign value.voltage for voltage vars", () => {
      expect(detectType("input.voltage", "221.0", false).role).toBe("value.voltage");
    });

    it("should assign value.temperature for temperature vars", () => {
      expect(detectType("ups.temperature", "32.5", false).role).toBe("value.temperature");
    });

    it("should assign text for ups.status", () => {
      expect(detectType("ups.status", "OL", false).role).toBe("text");
    });

    it("should assign value for read-only numbers", () => {
      expect(detectType("ups.load", "15", false).role).toBe("value");
    });

    it("should assign text for read-only strings", () => {
      expect(detectType("device.mfr", "EATON", false).role).toBe("text");
    });

    it("should assign value.current for current vars", () => {
      expect(detectType("output.current", "2.5", false).role).toBe("value.current");
    });

    it("should assign value.power for power vars", () => {
      expect(detectType("ups.power", "159", false).role).toBe("value.power");
    });

    it("should assign value.power for realpower vars", () => {
      expect(detectType("ups.realpower", "147", false).role).toBe("value.power");
    });

    it("should assign value.interval for battery.runtime", () => {
      expect(detectType("battery.runtime", "2050", false).role).toBe("value.interval");
    });

    it("should assign value.interval for ups.timer.*", () => {
      expect(detectType("ups.timer.shutdown", "-1", false).role).toBe("value.interval");
    });

    it("should assign level for writable delay", () => {
      expect(detectType("ups.delay.shutdown", "20", true).role).toBe("level");
    });

    it("should assign text for writable strings", () => {
      expect(detectType("outlet.desc", "Main Outlet", true).role).toBe("text");
    });

    it("should assign level for writable voltage", () => {
      expect(detectType("input.transfer.high", "285", true).role).toBe("level");
    });
  });

  // -----------------------------------------------------------------------
  // Write flag
  // -----------------------------------------------------------------------
  describe("write flag", () => {
    it("should be false for read-only variables", () => {
      expect(detectType("battery.charge", "100", false).write).toBe(false);
    });

    it("should be true for writable variables", () => {
      expect(detectType("ups.delay.shutdown", "20", true).write).toBe(true);
    });
  });

  // -----------------------------------------------------------------------
  // read flag
  // -----------------------------------------------------------------------
  describe("read flag", () => {
    it("should always be true", () => {
      expect(detectType("battery.charge", "100", false).read).toBe(true);
      expect(detectType("ups.delay.shutdown", "20", true).read).toBe(true);
    });
  });

  // -----------------------------------------------------------------------
  // Edge cases from krobi's Eaton PRO 1600
  // -----------------------------------------------------------------------
  describe("krobi Eaton PRO 1600 edge cases", () => {
    it("should handle ups.productid as string (ffff)", () => {
      const r = detectType("ups.productid", "ffff", false);
      expect(r.type).toBe("string");
      expect(r.parsedValue).toBe("ffff");
    });

    it("should handle ups.productid preserving leading zeros (0001)", () => {
      const r = detectType("ups.productid", "0001", false);
      expect(r.type).toBe("string");
      expect(r.parsedValue).toBe("0001");
    });

    it("should handle ups.vendorid as string preserving leading zeros (0463)", () => {
      const r = detectType("ups.vendorid", "0463", false);
      expect(r.type).toBe("string");
      expect(r.parsedValue).toBe("0463");
    });

    it("should handle driver.version.usb as string", () => {
      const r = detectType("driver.version.usb", "libusb-1.0.26 (API: 0x1000109)", false);
      expect(r.type).toBe("string");
    });

    it("should handle device.model with trailing space", () => {
      const r = detectType("device.model", "Ellipse PRO 1600 ", false);
      expect(r.type).toBe("string");
      expect(r.parsedValue).toBe("Ellipse PRO 1600 ");
    });

    it("should handle driver.parameter.pollfreq as number", () => {
      const r = detectType("driver.parameter.pollfreq", "30", false);
      expect(r.type).toBe("number");
      expect(r.parsedValue).toBe(30);
    });

    it("should handle driver.parameter.pollinterval as number", () => {
      const r = detectType("driver.parameter.pollinterval", "2", false);
      expect(r.type).toBe("number");
      expect(r.parsedValue).toBe(2);
    });

    it("should handle input.voltage.extended as a boolean (yes/no)", () => {
      const r = detectType("input.voltage.extended", "no", false);
      expect(r.type).toBe("boolean");
    });

    it("should handle outlet.1.switchable as a boolean (yes/no)", () => {
      const r = detectType("outlet.1.switchable", "no", false);
      expect(r.type).toBe("boolean");
    });

    it("should handle outlet.1.status as string", () => {
      const r = detectType("outlet.1.status", "on", false);
      expect(r.type).toBe("string");
    });
  });

  // -----------------------------------------------------------------------
  // detectStates (enum values)
  // -----------------------------------------------------------------------
  describe("detectStates", () => {
    it("should return enum states for battery.charger.status", () => {
      const s = detectStates("battery.charger.status");
      expect(s).toEqual({
        charging: "charging",
        discharging: "discharging",
        floating: "floating",
        resting: "resting",
      });
    });

    it("should return enum states for ups.beeper.status", () => {
      const s = detectStates("ups.beeper.status");
      expect(s).toEqual({ enabled: "enabled", disabled: "disabled", muted: "muted" });
    });

    it("should return on/off for outlet.status", () => {
      expect(detectStates("outlet.status")).toEqual({ on: "on", off: "off" });
    });

    it("should return on/off for outlet.1.status", () => {
      expect(detectStates("outlet.1.status")).toEqual({ on: "on", off: "off" });
    });

    it("should return on/off for outlet.2.switch", () => {
      expect(detectStates("outlet.2.switch")).toEqual({ on: "on", off: "off" });
    });

    it("should return undefined for unknown variables", () => {
      expect(detectStates("battery.charge")).toBeUndefined();
    });

    it("should return undefined for ups.status (not an enum)", () => {
      expect(detectStates("ups.status")).toBeUndefined();
    });
  });

  // -----------------------------------------------------------------------
  // J/K/L/M — type/role/unit edge fixes (v0.3.0)
  // -----------------------------------------------------------------------
  describe("string states: no unit (J) + no value.* role (K)", () => {
    it("battery.charger.status → string, no unit (not %), text role", () => {
      const r = detectType("battery.charger.status", "floating", false);
      expect(r.type).toBe("string");
      expect(r.unit).toBeUndefined();
      expect(r.role).toBe("text");
    });

    it("input.voltage.status → string, no unit (not V), text role (not value.voltage)", () => {
      const r = detectType("input.voltage.status", "good", false);
      expect(r.type).toBe("string");
      expect(r.unit).toBeUndefined();
      expect(r.role).toBe("text");
    });

    it("ups.beeper.status string has no unit", () => {
      expect(detectType("ups.beeper.status", "enabled", false).unit).toBeUndefined();
    });
  });

  describe("powerfactor is not value.power (L)", () => {
    it("output.powerfactor → value role, no VA unit", () => {
      const r = detectType("output.powerfactor", "0.98", false);
      expect(r.type).toBe("number");
      expect(r.role).toBe("value");
      expect(r.unit).toBeUndefined();
    });

    it("ups.realpower still value.power / W", () => {
      const r = detectType("ups.realpower", "147", false);
      expect(r.role).toBe("value.power");
      expect(r.unit).toBe("W");
    });
  });

  // -----------------------------------------------------------------------
  // Catalog coverage — every representative nut-2.8.5 variable maps to its
  // correct datapoint (type / unit / common.states) in one verified pass.
  // Bare text is only correct for genuinely opaque fields.
  // -----------------------------------------------------------------------
  describe("nut-2.8.5 catalog coverage", () => {
    const THR = ["good", "warning-low", "warning-high", "critical-low", "critical-high"];
    const FREQ = [...THR, "out-of-range"];
    const ONOFF = ["on", "off"];
    const ENDIS = ["enabled", "disabled"];
    const CONTACTS = ["open", "closed", "active", "inactive"];
    const CHARGER = ["charging", "discharging", "floating", "resting"];
    const BEEPER = ["enabled", "disabled", "muted"];

    interface Row {
      name: string;
      value: string;
      rw?: boolean;
      type: "number" | "string" | "boolean";
      unit?: string;
      states?: string[];
    }
    const CATALOG: Row[] = [
      // Numbers + units
      { name: "battery.charge", value: "100", type: "number", unit: "%" },
      { name: "battery.voltage", value: "24.8", type: "number", unit: "V" },
      { name: "battery.runtime", value: "1080", type: "number", unit: "s" },
      { name: "battery.capacity", value: "7.2", type: "number", unit: "Ah" },
      { name: "battery.temperature", value: "50", type: "number", unit: "°C" },
      { name: "battery.energysave.delay", value: "3", type: "number", unit: "min" },
      { name: "input.voltage", value: "121", type: "number", unit: "V" },
      { name: "input.frequency", value: "50", type: "number", unit: "Hz" },
      { name: "input.current", value: "4.25", type: "number", unit: "A" },
      { name: "input.transfer.low", value: "91", rw: true, type: "number", unit: "V" },
      { name: "input.transfer.high", value: "132", rw: true, type: "number", unit: "V" },
      { name: "input.transfer.boost.low", value: "190", type: "number", unit: "V" },
      { name: "input.transfer.low.min", value: "85", type: "number", unit: "V" },
      { name: "input.transfer.hysteresis", value: "10", type: "number", unit: "V" },
      { name: "input.transfer.frequency.bypass.range", value: "10", type: "number", unit: "%" },
      { name: "input.transfer.delay", value: "60", type: "number", unit: "s" },
      { name: "input.phase.shift", value: "181", type: "number", unit: "°" },
      { name: "output.inverter.latency", value: "0.01", type: "number", unit: "s" },
      { name: "ups.power", value: "500", type: "number", unit: "VA" },
      { name: "ups.realpower", value: "300", type: "number", unit: "W" },
      { name: "ups.load", value: "23", type: "number", unit: "%" },
      { name: "ups.load.high", value: "100", type: "number", unit: "%" },
      { name: "ups.temperature", value: "42", type: "number", unit: "°C" },
      { name: "ups.delay.shutdown", value: "20", rw: true, type: "number", unit: "s" },
      { name: "ups.test.interval", value: "1209600", type: "number", unit: "s" },
      { name: "ups.efficiency", value: "95", type: "number", unit: "%" },
      { name: "device.uptime", value: "1782", type: "number", unit: "s" },
      { name: "ambient.1.temperature", value: "25", type: "number", unit: "°C" },
      { name: "ambient.1.humidity", value: "38", type: "number", unit: "%" },
      { name: "outlet.1.current", value: "0.19", type: "number", unit: "A" },
      { name: "outlet.1.voltage", value: "247", type: "number", unit: "V" },
      { name: "outlet.1.realpower", value: "28", type: "number", unit: "W" },
      { name: "output.powerfactor", value: "0.85", type: "number" },
      // Booleans (yes/no)
      { name: "input.voltage.extended", value: "no", type: "boolean" },
      { name: "input.frequency.extended", value: "no", type: "boolean" },
      { name: "outlet.switchable", value: "yes", type: "boolean" },
      { name: "outlet.1.switchable", value: "yes", type: "boolean" },
      { name: "ambient.1.present", value: "yes", type: "boolean" },
      { name: "battery.protection", value: "yes", type: "boolean" },
      { name: "ups.start.auto", value: "yes", type: "boolean" },
      // Enums (string + common.states)
      { name: "input.voltage.status", value: "critical-low", type: "string", states: THR },
      { name: "input.current.status", value: "critical-high", type: "string", states: THR },
      { name: "input.frequency.status", value: "out-of-range", type: "string", states: FREQ },
      { name: "outlet.1.voltage.status", value: "good", type: "string", states: THR },
      { name: "ambient.1.temperature.status", value: "warning-low", type: "string", states: THR },
      { name: "ambient.1.humidity.status", value: "warning-low", type: "string", states: THR },
      { name: "outlet.1.status", value: "on", type: "string", states: ONOFF },
      { name: "outlet.1.switch", value: "on", rw: true, type: "string", states: ONOFF },
      { name: "outlet.group.1.status", value: "on", type: "string", states: ONOFF },
      { name: "battery.charger.status", value: "charging", type: "string", states: CHARGER },
      { name: "ups.beeper.status", value: "enabled", type: "string", states: BEEPER },
      { name: "ups.watchdog.status", value: "disabled", type: "string", states: ENDIS },
      { name: "ups.shutdown", value: "enabled", type: "string", states: ENDIS },
      { name: "ambient.1.temperature.alarm", value: "enabled", type: "string", states: ENDIS },
      { name: "input.transfer.bypass.forced", value: "enabled", type: "string", states: ENDIS },
      { name: "ambient.1.contacts.1.status", value: "open", type: "string", states: CONTACTS },
      // Opaque strings (correct as text, no states)
      { name: "device.model", value: "SMART-UPS 700", type: "string" },
      { name: "device.serial", value: "WS9643050926", type: "string" },
      { name: "device.part", value: "0123456789", type: "string" },
      { name: "ambient.1.address", value: "1", type: "string" },
      { name: "input.feed.color", value: "3831236", type: "string" },
      { name: "outlet.1.groupid", value: "1", type: "string" },
      { name: "ups.status", value: "OL", type: "string" },
      { name: "ups.alarm", value: "OVERHEAT", type: "string" },
      { name: "input.sensitivity", value: "H", type: "string" },
      { name: "input.transfer.reason", value: "T", type: "string" },
      { name: "ups.vendorid", value: "0463", type: "string" },
      { name: "battery.type", value: "PbAc", type: "string" },
    ];

    it.each(CATALOG)("$name ($value) → $type", ({ name, value, rw, type, unit, states }) => {
      const d = detectType(name, value, rw ?? false);
      expect(d.type).toBe(type);
      expect(d.unit).toBe(unit);
      const detected = detectStates(name);
      if (states) {
        expect(detected).toBeDefined();
        expect(Object.keys(detected as Record<string, string>)).toEqual(states);
      } else {
        expect(detected).toBeUndefined();
      }
    });
  });

  describe("voltage/frequency status enums (M)", () => {
    it("input.voltage.status → good/warning/critical enum", () => {
      expect(detectStates("input.voltage.status")).toEqual({
        good: "good",
        "warning-low": "warning-low",
        "warning-high": "warning-high",
        "critical-low": "critical-low",
        "critical-high": "critical-high",
      });
    });

    it("three-phase input.L1.voltage.status → same enum", () => {
      expect(detectStates("input.L1.voltage.status")?.good).toBe("good");
    });

    it("output.frequency.status → same enum", () => {
      expect(detectStates("output.frequency.status")?.["critical-low"]).toBe("critical-low");
    });
  });
});
