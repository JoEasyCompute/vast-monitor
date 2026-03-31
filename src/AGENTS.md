<!-- Parent: ../AGENTS.md -->
<!-- Generated: 2026-03-31 | Updated: 2026-03-31 -->

# src

## Purpose
Backend source code for vast-monitor. Contains the application entry point, Express HTTP server, SQLite database layer, fleet polling monitor, Vast.ai API/CLI client, configuration, alert system, and plugin loader.

## Key Files

| File | Description |
|------|-------------|
| `index.js` | Application entry point — wires together config, DB, plugins, alerts, monitor, and HTTP server; handles graceful shutdown on SIGINT/SIGTERM |
| `server.js` | Express app factory (`createServer`) — defines all REST API routes and plugin route/static registration |
| `monitor.js` | `FleetMonitor` class — periodic polling loop, change detection, event/alert generation, plugin hooks |
| `db.js` | `createDatabase` — SQLite schema creation and all query methods (state, history, snapshots, alerts, earnings) |
| `vast-client.js` | Vast CLI and REST API wrappers — `fetchMachines`, `fetchMachineReports`, `fetchMachineEarnings`, `fetchDatacenterMetadata` |
| `fleet-metrics.js` | Pure functions for fleet aggregation — `buildFleetAggregate`, `isFleetEligibleMachine`, `getFleetEligibleMachines` |
| `config.js` | `config` singleton from env vars — also exports `validateRuntimeConfig`, `getLiveDependencyHealth`, `getOptionalRuntimeWarnings` |

## Subdirectories

| Directory | Purpose |
|-----------|---------|
| `alerts/` | Alert manager and output channels (see `alerts/AGENTS.md`) |
| `plugins/` | Plugin loader and public API (see `plugins/AGENTS.md`) |

## For AI Agents

### Working In This Directory
- All files are **ESM modules** — use `import`/`export` only.
- `index.js` exports `startApp(options)` which accepts overrides for all major dependencies (useful in tests).
- `server.js` exports `createServer({ config, db, monitor, plugins })` — pure factory, no side effects.
- `monitor.js` exports `FleetMonitor` class plus several pure helper functions (`buildChangeSet`, `resolveIdleSince`, `dedupeMachinesByHostname`, `detectHostnameCollisions`, etc.) that are independently unit-testable.
- `db.js` is the only file that writes to SQLite; do not call SQLite directly from other modules.
- `vast-client.js` invokes the Vast CLI via `execFile` — requires the CLI binary at the configured path.

### Testing Requirements
- Unit tests for this directory live in `../test/` — e.g., `monitor.test.js`, `config.test.js`, `vast-client.test.js`.
- Integration tests (`db.integration.test.js`, `server.integration.test.js`) spin up real SQLite and Express instances.
- `startApp` accepts a full `options` bag so tests can inject stubs without mocking the module system.

### Common Patterns
- Alert and event objects share a shape: `{ created_at, machine_id, hostname, alert_type|event_type, severity, message, payload_json }`.
- All timestamps are ISO 8601 strings.
- Machine status is either `"online"` or `"offline"` (Vast CLI timeout > 300s = offline).
- Datacenter machines are identified by `hosting_type === 1`; `datacenter_id` equals `host_id` for these.

## Dependencies

### Internal
- `alerts/` — `AlertManager`, `ConsoleAlertChannel`
- `plugins/` — `loadPlugins`, `getClientExtensionManifest`, `resolvePluginPublicDir`

### External
- `better-sqlite3` — database
- `express` ^5 — HTTP server
- `dotenv` — env loading (in `config.js`)

<!-- MANUAL: -->
