# Older changes
## 0.4.1 (2026-06-10)

- Cleaned up the obsolete `info.online` state left behind by the 0.4.0 rename. It stayed in the object tree frozen at its last value; the adapter now removes it automatically on the next start.

## 0.4.0 (2026-06-10)

- Fixed the connection indicator — it no longer shows green while the connection to the NUT server is actually down.
- Renamed each UPS's `info.online` state to `info.reachable` (does the UPS respond) — distinct from the `status.online` flag (on mains power). Update references in scripts or visualizations.

## 0.3.0 (2026-06-01)

- Added optional TLS encryption via STARTTLS, so your username and password are no longer sent in clear text over the network.
- Charging and discharging are now also detected from the battery charger status, so they work on UPS models that don't report them directly.
- Added status flags for waiting, ECO mode, self-test and overheating, plus clearer labels for more instant commands.
- The adapter now keeps trying to reach the NUT server when it is unavailable and comes back on its own once it returns, instead of staying idle.

## 0.2.9 (2026-05-23)

- Reduced unnecessary state-change events by skipping writes when the value has not changed.
- Fixed duplicate error messages that could appear when running in compact mode.

## 0.2.8 (2026-05-23)

- Changelog rewritten in user-centric style across all versions.

## 0.2.7 (2026-05-23)

- Internal cleanup. No user-facing changes.

## 0.2.6 (2026-05-23)

- Internal cleanup. No user-facing changes.

## 0.2.5 (2026-05-22)

- User-modified state names are no longer overwritten on adapter restart

## 0.2.4 (2026-05-21)

- Improved error handling and stability.

## 0.2.3 (2026-05-19)

- Improved debug logging for easier diagnosis of connection and command issues.

## 0.1.0 (2026-05-18)

- Initial release — complete rewrite of the NUT adapter
- Multi-UPS support: automatic discovery of all UPS devices on a NUT server
- Persistent connection with automatic reconnect
- Dynamic state creation with proper data types and units
- ups.status parsed into individual status flags with severity level
- Instant commands (INSTCMD) and writable variables (SET VAR) with safety checks
- Network interface selector for multi-homed servers
- Connection test button in admin UI
- 11-language admin UI and state names

## 0.2.2 (2026-05-19)

- Replaced PNG icon with SVG for transparent background and dark-mode compatibility

## 0.2.1 (2026-05-19)

- Fixed existing states not being updated on adapter upgrade
- Removed redundant info states. Device name shows manufacturer and model.
- Added translations for 4 additional driver variables (port, synchronous mode, USB library, ignore low battery flag)

## 0.2.0 (2026-05-18)

- Fixed vendor and product IDs: leading zeros are now preserved
- Fixed incorrect unit on extended voltage measurement
- Fixed missing unit "%" for humidity and percent-suffix variables
- Added human-readable status display (e.g. "Online, Charging" instead of "OL CHRG")
- Added HE (High Efficiency / ECO mode) status flag recognition
- Writable variables now show dropdown menus and value ranges in admin
- Added dropdown values for known enum variables (battery charger status, beeper status, outlet switches)
- Device name now shows manufacturer + model when NUT server description is unavailable
- Status flags and variables now display with correct icons and categories in admin and vis
- State names, status flags, and command buttons translated to 11 languages

## 0.1.3 (2026-05-18)

- Fixed connection test now verifies LOGIN per UPS (not just USERNAME/PASSWORD) — catches ACCESS-DENIED before the adapter starts
- Fixed auth failure now fully disconnects from NUT server — no further connection attempts until adapter restart

## 0.1.2 (2026-05-18)

- Fixed authentication failure no longer stops the adapter — stays alive with yellow status so the connection test button remains usable
- Fixed admin UI layout (host, port and poll interval on one row; username and password paired; test button on separate row)

## 0.1.1 (2026-05-18)

- Fixed upgrade from previous adapter version — leftover states are cleaned up automatically
- Fixed state IDs to match previous adapter behavior
- Fixed authentication failure now stops the adapter instead of continuing without permissions
- Fixed connection test now also verifies authentication credentials
- Added per-UPS online indicator (info.online) with device status integration
- Fixed command buttons only created after successful authentication
- Fixed state names now human-readable instead of raw NUT variable names
- Fixed log message order (auth result before "started" message)
- Fixed admin UI layout (network interface and poll interval on separate rows)
