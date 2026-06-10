# CLAUDE.md — ioBroker.nut

> Gemeinsame ioBroker-Wissensbasis: `../CLAUDE.md` (lokal, nicht im Git). Standards dort, Projekt-Spezifisches hier.

## Projekt

**ioBroker NUT Monitor** — Überwacht USV-Geräte über das Network UPS Tools (NUT) Protokoll. Persistente TCP-Verbindung, Multi-UPS per Instanz, dynamische State-Erstellung.

- **Version:** 0.4.0 (In-Depth-Analyse #2: **info.connection-Korrektheit** — Top-Indikator wird auf `client.isConnected` gegatet statt nach der per-UPS-Schleife unbedingt true gesetzt (zeigte sonst grün während eines Server-Disconnects, weil per-UPS-Fehler im inneren catch geschluckt werden + der Poll-Timer im Reconnect-Backoff weiterfeuert); **per-UPS `info.online` → `info.reachable` umbenannt** (Namens-Kollision mit `status.online`/`OL`-Flag aufgelöst — `reachable`=„antwortet die USV", `status.online`=„am Netz", passt zur Rolle `indicator.reachable`); kein Cleanup-Code (alter Datenpunkt = harmloser Orphan, [[feedback_one_shot_migration_pattern]]). Source sonst sauber bestätigt: STARTTLS/getVar/logout/voller Flag-Katalog bleiben (Ziel = vollständige NUT-Standard-Abdeckung, [[feedback_user_hardware_ist_sample]]). Vorgänger **0.3.0** (released 2026-06-01) STARTTLS, unified Retry-Loop, Flag-Katalog gegen nut-2.8.5, charging/discharging aus battery.charger.status, type/role/unit-Fixes, +15 command-i18n. **0.2.9** memory/perf audit. **0.2.8** changelog rewrite. **0.2.7** CI Node 24 + LICENSE fix. **0.2.6** i18n migration. **0.2.5** preserve state names. npm publish blockiert bis Apollon77-Transfer
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
├── state-manager.ts            → ioBroker state CRUD (device/channel/state, createdIds-Cache, legacy cleanup, cleanupDeprecatedInfoStates, enrichStateMetadata, nutVarToStateId/nutVarToReadableName)
├── state-manager.test.ts
├── type-detector.ts            → NUT variable → ioBroker type/role/unit Mapping
├── type-detector.test.ts
├── status-parser.ts            → ups.status → 19 booleans + severity (0-4) + display string
├── status-parser.test.ts
├── coerce.ts                   → errText + Boundary-Validators (host, port, pollInterval, commandTimeout)
├── coerce.test.ts
├── message-router.ts           → onMessage-Dispatcher (checkConnection + auth test, default-Branch-Contract)
├── message-router.test.ts
├── i18n.ts                     → tName(key) Wrapper über I18n.getTranslatedObject() (adapter-core I18n-Framework)
└── types.ts                    → TypeScript Interfaces + NUT-Konstanten
admin/i18n/<lang>.json          → Single-Source-of-Truth für UI- + State-Translations (133 Keys × 11 Sprachen)
../scripts/sync-iopackage-from-i18n.py → regeneriert io-package.json:instanceObjects.common.name aus admin/i18n/ (zentral, source: admin-i18n)
```

## Design-Entscheidungen

1. **Kein `node-nut` Dependency** — eigener NUT Client. Protokoll ist triviales ASCII-over-TCP (~460 LOC), `node-nut` seit 2018 abandoned
2. **Multi-UPS per Instanz** via `LIST UPS` — alle UPS eines NUT-Servers automatisch entdeckt
3. **Persistente TCP-Verbindung** — behebt den Per-Poll-Reconnect-Overhead des alten Adapters
4. **parseFloat-Heuristik** statt GET TYPE — GET TYPE ist unzuverlässig (Eaton markiert alles als NUMBER). Known-String-Override + parseFloat-Fallback
5. **Status-Flags als einzelne Booleans** — 19 Flags (`status-parser.ts:STATUS_CATALOG`, single source). Treiber-agnostisch gegen gebündelte NUT-2.8.5-Quelle verifiziert: 14 dokumentierte Kern-Tokens + ALARM (intern) + WAIT (upsd-init) + reale Extras ECO/HE, TEST (apc_modbus/powercom u.a.), OVERHEAT. Treiber-private 1-Off-Tokens (ACFAIL/COMMFAULT/DEPLETED/BY/TIP/SD) bewusst NICHT gemappt (Spec: clients MAY ignore unknowns → bleiben in `status.raw`). **Severity (0-4) = reine Power-Quellen-Leiter; Fault-Flags (OVER/ALARM/OFF) bewusst NICHT eingerechnet** (eigene Booleans, keine Verwässerung — Krobi-Entscheidung)
6. **Commands hinter Safety-Gate** — `enableCommands` Checkbox verhindert versehentliches `load.off`. SET VAR ebenfalls gated
7. **Network-Interface-Selector** — govee/hassemu-Pattern, wichtig für Multi-Homed-Server
8. **Dot-Depth-Sortierung** — Variables nach Punkttiefe sortiert, damit Parent-States vor Children existieren (battery.charge vor battery.charge.low)
9. **Dots→Dashes nach Channel** — `battery.charge.low` → stateId `ups0.battery.charge-low`. Erster Dot = Channel-Trenner, restliche Dots werden Dashes (kompatibel zum alten Apollon77-Adapter)
10. **Auth-Failure = stay alive, yellow, no connections** — bei konfiguriertem username+password und ACCESS-DENIED: `client.destroy()` trennt TCP komplett (kein Reconnect, kein Polling, kein Datentransfer), Adapter bleibt am Leben mit `info.connection = false` (gelb in Admin). sendTo-Button (Verbindung testen) funktioniert weiter — User kann Credentials korrigieren und testen bevor er speichert. checkConnection testet auch LOGIN pro UPS (nicht nur USERNAME/PASSWORD)
11. **Per-UPS info.online** — `indicator.reachable` Boolean mit `statusStates.onlineId` auf Device-Objekt (beszel-Pattern)
12. **Legacy-Cleanup** — `cleanupLegacyObjects()` löscht Root-Level-Orphans (alter Adapter) und v0.1.0-Dot-Style-Objekte in einem Pass
13. **STARTTLS** — opt-in `useTls` verschlüsselt die Verbindung (Credentials sonst Klartext). `connect()` macht den Upgrade vor jedem Command. Default `tlsRejectUnauthorized=false` (NUT-Server meist self-signed); ehrlich eingeordnet (transit-encryption, kein MITM-Schutz ohne valides Zertifikat). TLS-Config-Fehler → gelb/kein Retry (wie Auth-Fail)
14. **Unified Retry-Loop im Client** — `start()` besitzt EINE Schleife: retryt den initialen Connect, reconnectet bei Drops, stoppt gelb bei TLS-Config-Fatal (`onFatal`). `connect()` bleibt pur (One-Shot, kein Retry → Verbindungstest-Client unverändert). `setOnConnect` läuft idempotent bei initial UND Reconnect (kein Setup-Pfad-Drift). Backoff via purem `coerce.ts:computeReconnectDelay` (1s→60s). Timer managed (`adapter.setTimeout`-Injection → auto-cleared on unload)
15. **charging/discharging auch aus `battery.charger.status`** — USVen ohne CHRG/DISCHRG-Flags (z.B. Eaton Ellipse ECO, Apollon77-Issues #168/#97) füllen die Booleans über `battery.charger.status` (charging/discharging)

## NUT-Protokoll Referenz

- Protokoll-Spec: `Ressourcen/nut/nut-protocol-reference.md`
- **Autoritative Quelle (Standard-Verifikation): `Ressourcen/nut/nut-2.8.5/`** — echte NUT-Release-Quelle. `docs/new-drivers.txt` = dokumentierte `status_set`-Werte; `docs/nut-names.txt` = Instant-Commands. Flag-/Command-Katalog treiber-agnostisch hiergegen verifiziert (NICHT gegen krobis Eaton). `grep -rhoE 'status_set\("[^"]+"' drivers/` für den realen Token-Satz
- Krobi Live-Daten: `Ressourcen/nut/krobi-eaton-live-data.md` (51 Variablen, Eaton PRO 1600) — nur Test-Sample, NICHT als Standard-Referenz
- Port: 3493/TCP, ASCII-Zeilenprotokoll
- Auth: `USERNAME <user>` → `PASSWORD <pass>` → `LOGIN <ups>`
- 23 Error-Codes in `types.ts:NUT_ERRORS`

## Tests (335 unit + 57 package = 392)

```
src/lib/nut-client.test.ts      → TCP Client + STARTTLS handshake + unified retry loop + isTlsConfigError (58 tests)
src/lib/type-detector.test.ts   → Variable-Type-Detection (90 tests)
src/lib/status-parser.test.ts   → Status-Flag-Parsing (66 tests)
src/lib/state-manager.test.ts   → State CRUD + Cleanup + nutVarToStateId/ReadableName + cleanupLegacy + cleanupDeprecated + enrichStateMetadata + preserve (53 tests)
src/lib/coerce.test.ts          → Boundary-Validators + computeReconnectDelay (42 tests)
src/lib/message-router.test.ts  → onMessage-Dispatcher + Auth/Login-Test + TLS/localAddress passthrough (22 tests)
src/lib/i18n.test.ts            → tName delegation + i18n completeness (11 languages, identical keysets) (4 tests)
test/package.js                 → @iobroker/testing Package-Tests (57 tests)
```

## Versionshistorie

| Version | Highlights                                                                                                                                                                                                                                                                                                                                                                                                                       |
| ------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 0.4.0   | **In-Depth-Analyse #2.** `info.connection` zeigte grün während eines NUT-Server-Disconnects (Z.326 unbedingt true nach der per-UPS-Schleife, deren Fehler intern geschluckt werden) → jetzt auf `client.isConnected` gegatet. Per-UPS `info.online` → **`info.reachable`** umbenannt (Namens-Kollision mit dem `status.online`/`OL`-Flag; `reachable`=USV antwortet, `status.online`=am Netz). Kein Cleanup-Code (alter Datenpunkt = harmloser Orphan). STARTTLS / getVar / logout / voller 19-Flag-Katalog bleiben — Ziel ist vollständige NUT-Standard-Abdeckung für die gesamte Userbase. 335 unit + 57 package = 392 Tests. npm blockiert. |
| 0.3.0   | **In-Depth-Analyse.** STARTTLS-Verschlüsselung (opt-in, ehrlich eingeordnet). Unified Retry-Loop im NutClient (`start`/`onConnect`/`onFatal`, getesteter `computeReconnectDelay`, `connect()` bleibt pur) → ersetzt setupAfterConnect+rediscover-Divergenz. Flag-Katalog treiber-agnostisch gegen gebündelte nut-2.8.5 verifiziert: 19 Flags inkl. TEST/OVERHEAT (reale Treiber-Tokens), `STATUS_CATALOG` single-source. charging/discharging aus `battery.charger.status`. type/role/unit-Fixes (J/K/L/M), `*.voltage|frequency.status`-Enums. +15 Standard-Instant-Commands i18n. process.on-Handler raus, managed Timer. Severity unverändert (Power-Quellen-Leiter, by design). 335 unit + 57 package = 392 Tests. npm blockiert. |
| 0.2.9   | Memory/Perf-Audit: process.on compact-mode guard (module-level), `setState`→`setStateChangedAsync` in state-manager (5 Stellen). |
| 0.2.8   | Changelog user-centric rewrite (README + CHANGELOG_OLD + io-package.json news audited against Hard-Negativ-Liste). |
| 0.2.7   | CI check-and-lint updated to Node.js 24 (repochecker S3021). LICENSE copyright formatting fix (W7003). |
| 0.2.6   | **i18n-Migration auf adapter-core.** Private `i18n-states.ts` (1495 LOC) durch `I18n.getTranslatedObject()` ersetzt, admin/i18n von Unterordner-Pattern auf flat `<lang>.json` migriert (133 Keys = 25 UI + 53 STATE_NAMES + 55 VARIABLE_I18N). Tests 297→301. |
| 0.2.5   | Preserve user-modified state names on restart (mcm1957 feedback). 297 unit + 57 package = 354 tests.                                                                                                                                                                                                                                                                                                                             |
| 0.2.4   | Community-standard event handler pattern (.bind + try/catch).                                                                                                                                                                                                                                                                                                                                                                    |
| 0.2.3   | **Debug Coverage Wave** — 11 patches across state-manager.ts + main.ts. All 9 bug classes at 9/10 (from 7.2). README/changelog user-wording fixes.                                                                                                                                                                                                                                                                               |
| 0.2.2   | SVG icon with transparent background (dark-mode compatible). extIcon via jsdelivr CDN.                                                                                                                                                                                                                                                                                                                                           |
| 0.2.1   | **Hotfix** — ensureState uses extendObjectAsync (fixes type mismatch on v0.1.x→v0.2.0 upgrade). Removed redundant info.description and legacy info.name states. Added 4 driver variable translations. 295 unit + 57 package = 352 tests.                                                                                                                                                                                         |
| 0.2.0   | **Quality & Standards (14 findings)** — Fix vendorid/productid leading zeros, voltage.extended unit, humidity/percent units. Human-readable status.display. HE (ECO) flag. ENUM/RANGE metadata for writable vars. Device name fallback mfr+model. Specific roles (indicator.lowbat, value.voltage, etc.). common.states for enums. 11-language i18n for ~50 variables, 19 flags, 15 commands. 293 unit + 57 package = 350 tests. |
| 0.1.3   | **checkConnection LOGIN + auth-disconnect** — checkConnection verifies LOGIN per UPS (catches ACCESS-DENIED). Auth failure fully disconnects (client.destroy, no reconnect spam). 256 unit + 57 package = 313 tests.                                                                                                                                                                                                             |
| 0.1.2   | **Auth-Failure UX** — Auth failure no longer terminates adapter, stays alive with yellow status (info.connection=false) so connection test button remains usable. Admin layout improved (host+port+poll on one row, credentials paired).                                                                                                                                                                                         |
| 0.1.1   | **9-Bug-Fix** — Upgrade-Pfad (Legacy-Cleanup), Dots→Dashes in State-IDs, Auth-Failure→terminate, checkConnection testet Auth, per-UPS info.online, Commands nach Auth, readable State-Namen, Log-Reihenfolge, Admin-Layout. 254 unit + 57 package = 311 tests.                                                                                                                                                                   |
| 0.1.0   | **Initial release** — complete TypeScript rewrite. Multi-UPS support via LIST UPS, persistent TCP connection with reconnect, dynamic state creation with proper types/units, parsed ups.status flags as booleans + severity, instant commands (INSTCMD) and writable variables (SET VAR) with safety gates, network interface selector, connection test button, 11-language admin UI.                                            |

## Befehle

```bash
npm run build         # Production (esbuild)
npm test              # vitest src/**/*.test.ts + @iobroker/testing packageFiles (mocha)
npm run coverage      # vitest run --coverage
npm run lint          # ESLint
npm run format:check  # Prettier --check
npm run check         # tsc --noEmit (Type-Check)
```
