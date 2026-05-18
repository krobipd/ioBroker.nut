import { detectType } from "./type-detector";

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
  });

  // -----------------------------------------------------------------------
  // Unit detection
  // -----------------------------------------------------------------------
  describe("unit detection", () => {
    it("should assign V for voltage", () => {
      expect(detectType("input.voltage", "221.0", false).unit).toBe("V");
    });

    it("should assign V for voltage subtypes", () => {
      expect(detectType("input.voltage.extended", "no", false).unit).toBe("V");
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

    it("should assign level for writable numbers", () => {
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
    });

    it("should handle ups.vendorid as string (0463)", () => {
      const r = detectType("ups.vendorid", "0463", false);
      expect(r.type).toBe("number");
      expect(r.parsedValue).toBe(463);
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

    it("should handle input.voltage.extended as string", () => {
      const r = detectType("input.voltage.extended", "no", false);
      expect(r.type).toBe("string");
    });

    it("should handle outlet.1.switchable as string", () => {
      const r = detectType("outlet.1.switchable", "no", false);
      expect(r.type).toBe("string");
    });

    it("should handle outlet.1.status as string", () => {
      const r = detectType("outlet.1.status", "on", false);
      expect(r.type).toBe("string");
    });
  });
});
