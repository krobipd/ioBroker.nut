# CLAUDE.md — ioBroker.nut2

> Gemeinsame ioBroker-Wissensbasis: `../CLAUDE.md` (lokal, nicht im Git). Standards dort, Projekt-Spezifisches hier.

## Projekt

**ioBroker NUT Monitor** — Überwacht USV-Geräte über das Network UPS Tools (NUT) Protokoll. Persistente TCP-Verbindung, Multi-UPS per Instanz, dynamische State-Erstellung.

- **Version + Changelog:** current version in `io-package.json`; full internal dev history moved to `.claude/dev-history.md` (local, not auto-loaded). User-facing changelog: `README.md` + `io-package.json` news.
- **GitHub:** https://github.com/krobipd/ioBroker.nut2
- **npm:** https://www.npmjs.com/package/iobroker.nut2
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
4. **Strikte Zahl-Heuristik** statt GET TYPE — GET TYPE ist unzuverlässig (Eaton markiert alles als NUMBER). Known-String-Override + strikter `parseDecimal`+`Number.isFinite`-Fallback (v0.4.4: „12abc"/„Infinity" bleiben String, nicht-finite Werte werden nicht als Zahl gespeichert). `expectedNumeric`-Flag (aus `detectUnit`) steuert, ob Garbage in einem Zahl-Feld verworfen + 1× gewarnt wird
5. **Status-Flags als einzelne Booleans** — 19 Flags (`status-parser.ts:STATUS_CATALOG`, single source). Treiber-agnostisch gegen gebündelte NUT-2.8.5-Quelle verifiziert: 14 dokumentierte Kern-Tokens + ALARM (intern) + WAIT (upsd-init) + reale Extras ECO/HE, TEST (apc_modbus/powercom u.a.), OVERHEAT. Treiber-private 1-Off-Tokens (ACFAIL/COMMFAULT/DEPLETED/BY/TIP/SD) bewusst NICHT gemappt (Spec: clients MAY ignore unknowns → bleiben in `status.raw`). **Severity (0-4) = reine Power-Quellen-Leiter; Fault-Flags (OVER/ALARM/OFF) bewusst NICHT eingerechnet** (eigene Booleans, keine Verwässerung — Krobi-Entscheidung)
6. **Commands hinter Safety-Gate** — `enableCommands` Checkbox verhindert versehentliches `load.off`. SET VAR ebenfalls gated
7. **Network-Interface-Selector** — govee/hassemu-Pattern, wichtig für Multi-Homed-Server
8. **Dot-Depth-Sortierung** — Variables nach Punkttiefe sortiert, damit Parent-States vor Children existieren (battery.charge vor battery.charge.low)
9. **Dots→Dashes nach Channel** — `battery.charge.low` → stateId `ups0.battery.charge-low`. Erster Dot = Channel-Trenner, restliche Dots werden Dashes — hält die State-IDs flach und eindeutig, ohne Scheinhierarchie unter dem Kanal
10. **Auth-Failure = stay alive, yellow, no connections** — bei konfiguriertem username+password und ACCESS-DENIED: `client.destroy()` trennt TCP komplett (kein Reconnect, kein Polling, kein Datentransfer), Adapter bleibt am Leben mit `info.connection = false` (gelb in Admin). sendTo-Button (Verbindung testen) funktioniert weiter — User kann Credentials korrigieren und testen bevor er speichert. checkConnection prüft `USERNAME`/`PASSWORD` (die echte Credential-Prüfung); **kein `LOGIN`** (v0.4.5) — NUT erlaubt nur ein LOGIN pro Verbindung und es ist upsmon-Shutdown-only; ein per-USV-LOGIN-Loop machte Multi-USV-Server mit Auth gelb (`ALREADY-LOGGED-IN`)
11. **Per-UPS info.reachable** — `indicator.reachable` Boolean mit `statusStates.onlineId` auf Device-Objekt (beszel-Pattern). v0.4.0 von `info.online` umbenannt — die Namens-Kollision mit dem `status.online`/OL-Flag (am Netz) verwirrte: `reachable` = „antwortet die USV / Daten frisch"
12. **Legacy-Cleanup** — `cleanupLegacyObjects()` löscht Root-Level-Orphans (alter Adapter) und v0.1.0-Dot-Style-Objekte in einem Pass
13. **STARTTLS** — opt-in `useTls` verschlüsselt die Verbindung (Credentials sonst Klartext). `connect()` macht den Upgrade vor jedem Command. Default `tlsRejectUnauthorized=false` (NUT-Server meist self-signed); ehrlich eingeordnet (transit-encryption, kein MITM-Schutz ohne valides Zertifikat). TLS-Config-Fehler → gelb/kein Retry (wie Auth-Fail)
14. **Unified Retry-Loop im Client** — `start()` besitzt EINE Schleife: retryt den initialen Connect, reconnectet bei Drops, stoppt gelb bei TLS-Config-Fatal (`onFatal`). `connect()` bleibt pur (One-Shot, kein Retry → Verbindungstest-Client unverändert). `setOnConnect` läuft idempotent bei initial UND Reconnect (kein Setup-Pfad-Drift). Backoff via purem `coerce.ts:computeReconnectDelay` (1s→60s). Timer managed (`adapter.setTimeout`-Injection → auto-cleared on unload)
15. **charging/discharging auch aus `battery.charger.status`** — USVen ohne CHRG/DISCHRG-Flags (z.B. Eaton Ellipse ECO, Apollon77-Issues #168/#97) füllen die Booleans über `battery.charger.status` (charging/discharging)

## NUT-Protokoll Referenz

- **Autoritative Quelle (Standard-Verifikation): NUT 2.8.5 Release-Quelle.** `docs/new-drivers.txt` = dokumentierte `status_set`-Werte; `docs/nut-names.txt` = Instant-Commands. Flag-/Command-Katalog treiber-agnostisch hiergegen verifiziert (NICHT gegen ein einzelnes Gerät). `grep -rhoE 'status_set\("[^"]+"' drivers/` für den realen Token-Satz
- Live-Sample zum Gegenprüfen: ein reales Eaton PRO 1600 (51 Variablen) — nur Test-Sample, NICHT als Standard-Referenz
- Port: 3493/TCP, ASCII-Zeilenprotokoll
- Auth: `USERNAME <user>` → `PASSWORD <pass>` → `LOGIN <ups>`
- 23 Error-Codes in `types.ts:NUT_ERRORS`

## Tests (471 unit + 57 package = 528)

## Befehle

```bash
npm run build         # Production (esbuild)
npm test              # vitest src/**/*.test.ts + @iobroker/testing packageFiles (mocha)
npm run coverage      # vitest run --coverage
npm run lint          # ESLint
npm run format:check  # Prettier --check
npm run check         # tsc --noEmit (Type-Check)
```
