# <img src="https://cdn.jsdelivr.net/gh/krobipd/ioBroker.nut@main/admin/nut.svg" width="48" align="top" /> ioBroker.nut

**Release:** [![npm version](https://img.shields.io/npm/v/iobroker.nut)](https://www.npmjs.com/package/iobroker.nut) ![stable](https://iobroker.live/badges/nut-stable.svg) ![Installations](https://iobroker.live/badges/nut-installed.svg) [![npm downloads](https://img.shields.io/npm/dt/iobroker.nut)](https://www.npmjs.com/package/iobroker.nut)

**Build:** [![Test and Release](https://github.com/krobipd/ioBroker.nut/actions/workflows/test-and-release.yml/badge.svg)](https://github.com/krobipd/ioBroker.nut/actions/workflows/test-and-release.yml) ![Node](https://img.shields.io/badge/node-%3E%3D22-brightgreen) ![TypeScript](https://img.shields.io/badge/TypeScript-strict-blue) [![License](https://img.shields.io/badge/license-MIT-green)](LICENSE)

**Support:** [![Ko-fi](https://img.shields.io/badge/Ko--fi-Support-ff5e5b?logo=ko-fi)](https://ko-fi.com/krobipd) [![PayPal](https://img.shields.io/badge/Donate-PayPal-blue.svg)](https://paypal.me/krobipd)

Monitors uninterruptible power supplies via [Network UPS Tools (NUT)](https://networkupstools.org/). All UPS devices connected to a NUT server are automatically discovered and polled.

---

## Features

- Automatic discovery of all UPS devices on a NUT server via `LIST UPS`
- Dynamic state creation from `LIST VAR` — whatever your UPS reports appears as ioBroker states
- Proper data types: numeric values as numbers (not strings), with units (V, Hz, A, %, W, VA, s, °C)
- Parsed `ups.status` flags as individual booleans (online, onBattery, lowBattery, charging, ...) plus computed severity (0–4)
- Instant commands (INSTCMD) via button states — beeper control, load management, self-test
- Writable variables (SET VAR) — change UPS settings directly from ioBroker
- Persistent TCP connection with automatic reconnect and exponential backoff
- Network interface selector for multi-homed servers
- Connection test button in the admin UI

---

## Requirements

- **Node.js >= 22**
- **ioBroker js-controller >= 7.2.2**
- **ioBroker Admin >= 7.8.23**
- A running [NUT server](https://networkupstools.org/) (upsd) with at least one UPS configured

---

## Configuration

### Connection

| Option                | Description                                                            | Default |
| --------------------- | ---------------------------------------------------------------------- | ------- |
| **NUT Server Host**   | Hostname or IP address of the NUT server                               | —       |
| **Port**              | NUT server port                                                        | `3493`  |
| **Network Interface** | Bind outgoing connections to a specific local IP (optional)            | all     |
| **Poll Interval (s)** | How often to query the NUT server (5–300)                              | `15`    |
| **Username**          | NUT username (optional — required for commands and writable variables) | —       |
| **Password**          | NUT password                                                           | —       |
| **Use TLS (STARTTLS)** | Encrypt the connection via STARTTLS                                   | off     |
| **Require valid certificate** | Reject self-signed/invalid certificates (only shown when TLS is on) | off     |

Use the **Test Connection** button to verify the server is reachable and see discovered UPS devices.

**About TLS:** enabling STARTTLS encrypts the connection so your NUT username and password are no longer sent in clear text over the network. With the default settings it protects against passive eavesdropping, but **not** against an active man-in-the-middle, because most NUT servers use a self-signed certificate that cannot be verified. For full protection, configure a certificate the client can validate on the NUT server and enable **Require valid certificate**. The NUT server must be built with TLS support (`upsd` with `CERTFILE`/`CERTPATH`); otherwise the connection test reports a TLS error.

### Advanced

| Option                  | Description                                         | Default |
| ----------------------- | --------------------------------------------------- | ------- |
| **Command Timeout (s)** | Timeout for individual NUT protocol commands (1–30) | `5`     |
| **Enable Commands**     | Allow sending instant commands (INSTCMD) to the UPS | off     |
| **Enable SET VAR**      | Allow changing writable UPS variables               | off     |

Both command features require a NUT user with appropriate permissions configured on the NUT server.

---

## State Tree

States are organized by NUT domain. The exact set of states depends on what your UPS driver reports.

```
nut.0.
├── info.connection                    — Connection to NUT server (bool)
└── {ups_name}/                        — Device (e.g. "ups0")
    ├── info/
    │   └── reachable                  — UPS responds / data is fresh (bool)
    ├── battery/
    │   ├── battery.charge             — Battery level (%, number)
    │   ├── battery.charge.low         — Low battery threshold (%)
    │   ├── battery.runtime            — Remaining runtime (s)
    │   ├── battery.type               — Battery chemistry (string)
    │   └── ...
    ├── device/
    │   ├── device.mfr                 — Manufacturer (string)
    │   ├── device.model               — Model name (string)
    │   ├── device.serial              — Serial number (string)
    │   └── ...
    ├── driver/
    │   ├── driver.name                — NUT driver name
    │   ├── driver.version             — Driver version
    │   └── ...
    ├── input/
    │   ├── input.voltage              — Input voltage (V, number)
    │   ├── input.frequency            — Input frequency (Hz, number)
    │   └── ...
    ├── output/
    │   ├── output.voltage             — Output voltage (V, number)
    │   ├── output.frequency           — Output frequency (Hz, number)
    │   └── ...
    ├── ups/
    │   ├── ups.load                   — UPS load (%, number)
    │   ├── ups.power                  — Apparent power (VA, number)
    │   ├── ups.realpower              — Real power (W, number)
    │   ├── ups.status                 — Raw status string (e.g. "OL CHRG")
    │   └── ...
    ├── status/                        — Parsed status flags
    │   ├── raw                        — Original status string
    │   ├── display                    — Human-readable status (e.g. "Online, Charging")
    │   ├── severity                   — 0=OK, 1=Info, 2=Warning, 3=Critical, 4=Emergency
    │   ├── online                     — On line power (bool)
    │   ├── onBattery                  — Running on battery (bool)
    │   ├── lowBattery                 — Battery is low (bool)
    │   ├── charging                   — Battery is charging (bool)
    │   ├── discharging                — Battery is discharging (bool)
    │   ├── replaceBattery             — Battery needs replacement (bool)
    │   ├── overloaded                 — UPS is overloaded (bool)
    │   ├── forcedShutdown             — Forced shutdown in progress (bool)
    │   ├── alarm                      — Alarm active (bool)
    │   ├── ecoMode                    — ECO / high efficiency mode (bool)
    │   ├── testing                    — Self-test in progress (bool)
    │   ├── overheat                   — UPS overheated (bool)
    │   └── ...                        — (19 flags total)
    └── commands/                      — Instant commands (if enabled)
        ├── beeper.enable              — Button: enable beeper
        ├── beeper.disable             — Button: disable beeper
        ├── test.battery.start         — Button: start battery test
        └── ...                        — (from LIST CMD)
```

### Status Severity Levels

| Level | Meaning   | Typical Flags               |
| ----- | --------- | --------------------------- |
| 0     | OK        | OL, OL CHRG, OL HB          |
| 1     | Info      | TRIM, BOOST, CAL            |
| 2     | Warning   | OB (without LB), RB, BYPASS |
| 3     | Critical  | OB + LB                     |
| 4     | Emergency | FSD                         |

---

## Troubleshooting

### Connection failed

- Verify the NUT server is reachable from the ioBroker host: `nc -zv <host> 3493`
- Check firewall rules for TCP port 3493
- Use the Test Connection button in the admin UI

### Commands not working

- Ensure **Enable Commands** is checked in the Advanced tab
- A NUT username and password with `instcmds` permission must be configured
- Check the NUT server's `upsd.users` configuration

### Writable variables not working

- Ensure **Enable SET VAR** is checked in the Advanced tab
- The NUT user needs `actions = SET` permission on the NUT server

### States not updating

- Check `info.connection` — if `false`, the TCP connection is down
- Check the ioBroker log for NUT error codes (e.g. `DATA-STALE` means the UPS driver lost contact)
- Verify the poll interval is appropriate for your setup

---

## Changelog

<!--
    Placeholder for the next version (at the beginning of the line):
    ### **WORK IN PROGRESS**
-->
### **WORK IN PROGRESS**

- More robust connection handling: the adapter no longer drops and reconnects the NUT connection unnecessarily on slow servers or after a brief network hiccup.
- The admin "Test connection" button now reports the real outcome — a clear error on failure and the list of discovered UPS devices on success (it previously always showed "Ok").
- A connection attempt that stalls (wrong host, a firewall dropping traffic, or a stalled TLS handshake) now fails after the command timeout instead of hanging for up to a minute — including the connection test.
- Device readings are now typed correctly instead of dumped as plain text: yes/no fields become booleans, status/switch/alarm/contact fields carry their value list, more numeric fields get their unit (V/s/%), and opaque identifiers stay text.
- The overall status severity now carries readable labels (OK / Info / Warning / Critical / Emergency) instead of a bare 0–4 number.
- Three-phase and multi-sensor readings (e.g. `input.L1.voltage`, `input.L1-L2.voltage`) now get their proper translated name instead of a raw fallback.
- Writing to a three-phase reading (e.g. `input.L1-L2.voltage`) now sends the correct variable name to the server instead of a mangled one.
- The adapter no longer gets stuck connected-but-idle if writing a device object fails during startup — it keeps polling and recovers on its own.

### 0.4.5 (2026-06-21)

- With login credentials configured, a NUT server that has more than one UPS no longer leaves the adapter offline (yellow). Multi-UPS setups with authentication now connect and poll correctly.

### 0.4.4 (2026-06-21)

- The network interface setting now offers an "all interfaces" choice and uses it by default, so the adapter binds correctly on multi-homed servers without manual configuration.
- A reading from the NUT server that is not a clean number is no longer stored as a wrong number — non-numeric text stays text, and a numeric field with garbage is skipped and warned once.
- The device name now corrects itself once manufacturer and model become available after the first reading, instead of staying stuck on an earlier placeholder name.
- A UPS variable whose name contains no dot, such as a bare ALARM, is now created as a proper data point instead of an invalid object.

### 0.4.3 (2026-06-18)

- Raised the minimum ioBroker js-controller to 7.2.2, matching the current stable release.
- Internal code and test cleanup — no change to how the adapter behaves.

### 0.4.2 (2026-06-12)

- UPS devices whose NUT server provides no usable description now get a proper name built from manufacturer and model instead of staying at "Description unavailable"
- Number settings with stray characters (like a port of "34abc") no longer half-apply — they fall back to safe defaults
- A UPS that disappears from the NUT server and later returns now reports its first problem at full warning level again

### 0.4.1 (2026-06-10)

- Cleaned up the obsolete `info.online` state left behind by the 0.4.0 rename. It stayed in the object tree frozen at its last value; the adapter now removes it automatically on the next start.

[Older changelogs can be found there](CHANGELOG_OLD.md)

## Credits

**Original Author:** Apollon77 ([@Apollon77](https://github.com/Apollon77))

**Rewrite:** krobi

---

## Support

- [ioBroker Forum](https://forum.iobroker.net/)
- [GitHub Issues](https://github.com/krobipd/ioBroker.nut/issues)

### Support Development

This adapter is free and open source. If you find it useful, consider buying me a coffee:

[![Ko-fi](https://img.shields.io/badge/Ko--fi-Support-ff5e5b?style=for-the-badge&logo=ko-fi)](https://ko-fi.com/krobipd)
[![PayPal](https://img.shields.io/badge/Donate-PayPal-blue.svg?style=for-the-badge)](https://paypal.me/krobipd)

---

## License

MIT License

Copyright (c) 2016-2025 Ingo Fischer <ingo@fischer-ka.de>  
Copyright (c) 2026 krobi <krobi@power-dreams.com>

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.

_Developed with assistance from Claude.ai_
