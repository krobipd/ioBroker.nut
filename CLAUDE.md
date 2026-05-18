# CLAUDE.md — ioBroker.nut

> Gemeinsame ioBroker-Wissensbasis: `../CLAUDE.md` (lokal, nicht im Git). Standards dort, Projekt-Spezifisches hier.

## Projekt

**ioBroker NUT Monitor** — Überwacht USV-Geräte über das Network UPS Tools (NUT) Protokoll. Persistente TCP-Verbindung, Multi-UPS per Instanz, dynamische State-Erstellung.

- **Version:** 0.1.0 (WORK IN PROGRESS — Greenfield-Rewrite)
- **GitHub:** https://github.com/krobipd/ioBroker.nut
- **npm:** https://www.npmjs.com/package/iobroker.nut
- **Repository PR:** noch nicht eingereicht
- **Runtime-Deps:** nur `@iobroker/adapter-core` (TCP via Node.js built-in `net`)
- **Test-Setup:** Tests unter `src/**/*.test.ts` direkt via **vitest**. `test/package.js` + `test/integration.js` bleiben mocha (`@iobroker/testing` ist mocha-only).
- **`@types/node` an `engines.node`-Min gekoppelt:** `^22.x` weil `engines.node: ">=22"`

## Architektur

```
src/main.ts                     → NutAdapter (Lifecycle, Polling, onStateChange für Commands/SetVar)
src/lib/
├── nut-client.ts               → NUT TCP Client (persistent, command queue, reconnect, auth)
├── nut-client.test.ts           → Mocked net.Socket tests
├── state-manager.ts            → ioBroker state CRUD (device/channel/state, createdIds-Cache)
├── state-manager.test.ts
├── type-detector.ts            → NUT variable → ioBroker type/role/unit Mapping
├── type-detector.test.ts
├── status-parser.ts            → ups.status → 18 booleans + severity (0-4)
├── status-parser.test.ts
├── coerce.ts                   → errText + Boundary-Validators (host, port, pollInterval, commandTimeout)
├── coerce.test.ts
├── message-router.ts           → onMessage-Dispatcher (checkConnection, default-Branch-Contract)
├── message-router.test.ts
├── i18n-states.ts              → 11-Sprachen State-Name-Translations + CHANNEL_I18N Map
└── types.ts                    → TypeScript Interfaces + NUT-Konstanten
scripts/sync-iopackage-from-i18n.py → instanceObjects.common.name Sync aus i18n-states.ts
```

## Design-Entscheidungen

1. **Kein `node-nut` Dependency** — eigener NUT Client. Protokoll ist triviales ASCII-over-TCP (~460 LOC), `node-nut` seit 2018 abandoned
2. **Multi-UPS per Instanz** via `LIST UPS` — alle UPS eines NUT-Servers automatisch entdeckt
3. **Persistente TCP-Verbindung** — behebt den Per-Poll-Reconnect-Overhead des alten Adapters
4. **parseFloat-Heuristik** statt GET TYPE — GET TYPE ist unzuverlässig (Eaton markiert alles als NUMBER). Known-String-Override + parseFloat-Fallback
5. **Status-Flags als einzelne Booleans** — besser für Visualisierung/Scripting/Alerting als Raw-String. Computed Severity (0-4) für Dashboards
6. **Commands hinter Safety-Gate** — `enableCommands` Checkbox verhindert versehentliches `load.off`. SET VAR ebenfalls gated
7. **Network-Interface-Selector** — govee/hassemu-Pattern, wichtig für Multi-Homed-Server
8. **Dot-Depth-Sortierung** — Variables nach Punkttiefe sortiert, damit Parent-States vor Children existieren (battery.charge vor battery.charge.low)

## NUT-Protokoll Referenz

- Protokoll-Spec: `Ressourcen/nut/nut-protocol-reference.md`
- Krobi Live-Daten: `Ressourcen/nut/krobi-eaton-live-data.md` (51 Variablen, Eaton PRO 1600)
- Port: 3493/TCP, ASCII-Zeilenprotokoll
- Auth: `USERNAME <user>` → `PASSWORD <pass>` → `LOGIN <ups>`
- 23 Error-Codes in `types.ts:NUT_ERRORS`

## Tests (236 unit + 57 package = 293)

```
src/lib/nut-client.test.ts      → TCP Client (45 tests)
src/lib/type-detector.test.ts   → Variable-Type-Detection (68 tests)
src/lib/status-parser.test.ts   → Status-Flag-Parsing (45 tests)
src/lib/state-manager.test.ts   → State CRUD + Cleanup (26 tests)
src/lib/coerce.test.ts          → Boundary-Validators (40 tests)
src/lib/message-router.test.ts  → onMessage-Dispatcher (12 tests)
test/package.js                 → @iobroker/testing Package-Tests (57 tests)
```

## Versionshistorie

| Version | Highlights |
|---------|------------|
| 0.1.0 | **Initial release** — complete TypeScript rewrite. Multi-UPS support via LIST UPS, persistent TCP connection with reconnect, dynamic state creation with proper types/units, parsed ups.status flags as booleans + severity, instant commands (INSTCMD) and writable variables (SET VAR) with safety gates, network interface selector, connection test button, 11-language admin UI. 236 unit + 57 package = 293 tests. |

## Befehle

```bash
npm run build         # Production (esbuild)
npm test              # vitest src/**/*.test.ts + @iobroker/testing packageFiles (mocha)
npm run coverage      # vitest run --coverage
npm run lint          # ESLint
npm run format:check  # Prettier --check
npm run check         # tsc --noEmit (Type-Check)
```
