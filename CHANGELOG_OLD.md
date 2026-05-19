# Older changes

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
## 0.1.2 (2026-05-18)

- Fixed authentication failure no longer stops the adapter — stays alive with yellow status so the connection test button remains usable
- Fixed admin UI layout (host, port and poll interval on one row; username and password paired; test button on separate row)

## 0.1.1 (2026-05-18)

- Fixed upgrade path from previous adapter version (orphaned root-level objects are now cleaned up automatically)
- Fixed NUT variable dots converted to dashes in state IDs (matching previous adapter behavior)
- Fixed authentication failure now stops the adapter instead of continuing without permissions
- Fixed connection test now also verifies authentication credentials
- Added per-UPS online indicator (info.online) with device status integration
- Fixed command buttons only created after successful authentication
- Fixed state names now human-readable instead of raw NUT variable names
- Fixed log message order (auth result before "started" message)
- Fixed admin UI layout (network interface and poll interval on separate rows)
