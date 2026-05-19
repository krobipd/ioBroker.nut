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
