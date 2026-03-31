<!-- Parent: ../AGENTS.md -->
<!-- Generated: 2026-03-31 | Updated: 2026-03-31 -->

# test

## Purpose
Test suite for vast-monitor using Node's built-in test runner (`node --test`). Covers both backend modules (unit and integration) and frontend modules (pure-function unit tests imported directly in Node).

## Key Files

| File | Description |
|------|-------------|
| `alert-manager.test.js` | Unit tests for `AlertManager` cooldown/deduplication logic |
| `config.test.js` | Unit tests for config validation and runtime warning helpers |
| `db.integration.test.js` | Integration tests for `createDatabase` — runs against real temporary SQLite DB files |
| `server.integration.test.js` | Integration tests for Express routes — invokes route handlers directly against a real app instance |
| `monitor.test.js` | Unit tests for `FleetMonitor` polling logic, change detection, and helper functions |
| `vast-client.test.js` | Unit tests for `normalizeMachine`, `normalizeEarningsDay`, and related pure functions |
| `plugins.test.js` | Unit tests for plugin loader (`normalizePlugin`, `getClientExtensionManifest`) |
| `frontend-dashboard-controller.test.js` | Unit tests for `createDashboardController` refresh orchestration |
| `frontend-dashboard-loader.test.js` | Unit tests for the dashboard data-fetching/loader module |
| `frontend-interactions.test.js` | Unit tests for user interaction handlers (click, select, etc.) |
| `frontend-modal-controllers.test.js` | Unit tests for machine modal open/close/render logic |
| `frontend-ui.test.js` | Unit tests for UI state helpers and formatters |

## For AI Agents

### Working In This Directory
- Run all tests: `npm test` (from repo root) — equivalent to `node --test`.
- Node's test runner discovers `*.test.js` files automatically.
- **Do not add a test framework** — the project intentionally uses the built-in runner.
- Integration tests (`*.integration.test.js`) use real temporary SQLite DB files created via `makeTempDbPath(...)`.
- Frontend tests import modules from `../public/app/` directly — keep those modules free of browser globals unless injected.

### Testing Requirements
- New backend logic in `src/` should have a corresponding test here.
- New frontend modules in `public/app/` should have a `frontend-*.test.js` file here.
- Prefer testing pure exported functions directly over mocking internal collaborators.

### Common Patterns
- `startApp` in `src/index.js` accepts an `options` bag for injecting stubs (db, config, monitor, alertManager, plugins, app).
- Integration tests create throwaway DB paths with `makeTempDbPath(...)`.
- Server route tests currently use a small `invokeRoute(...)` helper rather than a bound HTTP port.

## Dependencies

### Internal
- Tests import from `../src/` and `../public/app/`

### External
- Node built-in: `node:test`, `node:assert`

<!-- MANUAL: -->
