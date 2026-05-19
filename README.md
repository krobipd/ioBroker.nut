# ioBroker.nut

[![npm version](https://img.shields.io/npm/v/iobroker.nut)](https://www.npmjs.com/package/iobroker.nut)
![Node](https://img.shields.io/badge/node-%3E%3D22-brightgreen)
![TypeScript](https://img.shields.io/badge/TypeScript-strict-blue)
[![License](https://img.shields.io/badge/license-MIT-green)](LICENSE)
[![npm downloads](https://img.shields.io/npm/dt/iobroker.nut)](https://www.npmjs.com/package/iobroker.nut)
![Installations](https://iobroker.live/badges/nut-installed.svg)
[![Ko-fi](https://img.shields.io/badge/Ko--fi-Support-ff5e5b?logo=ko-fi)](https://ko-fi.com/krobipd)
[![PayPal](https://img.shields.io/badge/Donate-PayPal-blue.svg)](https://paypal.me/krobipd)

<img src="https://cdn.jsdelivr.net/gh/krobipd/ioBroker.nut@main/admin/nut.svg" width="100" />

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
- Multi-language admin UI (11 languages)

---

## Requirements

- **Node.js >= 22**
- **ioBroker js-controller >= 7.0.7**
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

Use the **Test Connection** button to verify the server is reachable and see discovered UPS devices.

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
    │   └── online                     — UPS reachable (bool)
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
    │   ├── highEfficiency             — ECO / high efficiency mode (bool)
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

- Replaced PNG icon with SVG for transparent background and dark-mode compatibility

### 0.2.1 (2026-05-19)

- Fixed existing states not being updated on adapter upgrade (e.g. vendorid type change from number to string)
- Removed redundant info.description and legacy info.name states — device name via manufacturer + model is sufficient
- Added translations for 4 additional driver variables (port, synchronous mode, USB library, ignore low battery flag)

### 0.2.0 (2026-05-18)

- Fixed `ups.vendorid` and `ups.productid` parsed as numbers — leading zeros are now preserved
- Fixed `input.voltage.extended` incorrectly tagged with unit "V" — now correctly detected as string
- Fixed missing unit "%" for humidity and percent-suffix variables
- Added human-readable status display (e.g. "Online, Charging" instead of "OL CHRG")
- Added HE (High Efficiency / ECO mode) status flag recognition
- Added ENUM/RANGE metadata for writable variables (dropdowns and min/max in admin)
- Added dropdown values for known enum variables (battery charger status, beeper status, outlet switches)
- Device name now shows manufacturer + model when NUT server description is unavailable
- Specific ioBroker roles for status flags (indicator.lowbat, indicator.alarm, indicator.maintenance)
- Specific ioBroker roles for variable types (value.voltage, value.current, value.power, value.temperature, value.interval)
- State names, status flags, and command buttons translated to 11 languages

### 0.1.3 (2026-05-18)

- Fixed connection test now verifies LOGIN per UPS (not just USERNAME/PASSWORD) — catches ACCESS-DENIED before the adapter starts
- Fixed auth failure now fully disconnects from NUT server — no further connection attempts until adapter restart

### 0.1.2 (2026-05-18)

- Fixed authentication failure no longer stops the adapter — stays alive with yellow status so the connection test button remains usable
- Fixed admin UI layout (host, port and poll interval on one row; username and password paired; test button on separate row)

### 0.1.1 (2026-05-18)

- Fixed upgrade path from previous adapter version (orphaned root-level objects are now cleaned up automatically)
- Fixed NUT variable dots converted to dashes in state IDs (matching previous adapter behavior)
- Fixed authentication failure now stops the adapter instead of continuing without permissions
- Fixed connection test now also verifies authentication credentials
- Added per-UPS online indicator (info.online) with device status integration
- Fixed command buttons only created after successful authentication
- Fixed state names now human-readable instead of raw NUT variable names
- Fixed log message order (auth result before "started" message)
- Fixed admin UI layout (network interface and poll interval on separate rows)

### 0.1.0 (2026-05-18)

- Initial release — complete rewrite of the NUT adapter
- Multi-UPS support: automatic discovery of all UPS devices on a NUT server
- Persistent TCP connection with reconnect and exponential backoff
- Dynamic state creation with proper data types and units
- Parsed ups.status flags as individual boolean states with severity level
- Instant commands (INSTCMD) and writable variables (SET VAR) with safety gates
- Network interface selector for multi-homed servers
- Connection test button in admin UI
- 11-language admin UI and state names

Older entries are in [CHANGELOG_OLD.md](CHANGELOG_OLD.md).

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

---

*Developed with assistance from Claude.ai*
