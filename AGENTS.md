<!-- Generated: 2026-03-31 | Updated: 2026-03-31 -->

# vast-monitor

## Purpose
A Node.js application that monitors a Vast.ai GPU hosting fleet. It polls the Vast CLI for machine state on a configurable interval, persists history in a SQLite database, serves a web dashboard with charts and machine tables, fires alerts (temperature, idle, host up/down, new reports), and supports a plugin system for company-specific extensions.

## Key Files

| File | Description |
|------|-------------|
| `package.json` | Project manifest — ESM (`"type": "module"`), deps: `better-sqlite3`, `dotenv`, `express`; `npm start` / `npm test` |
| `.env.example` | Template for all supported environment variables (copy to `.env`) |
| `.env` | Local environment config (not committed) |
| `support-helpers.js` | Utility helpers for support/diagnostics |
| `README.md` | User-facing setup and usage documentation |

## Subdirectories

| Directory | Purpose |
|-----------|---------|
| `src/` | Backend source — server, monitor, DB, config, alerts, plugins (see `src/AGENTS.md`) |
| `public/` | Frontend static assets — HTML, CSS, and JS modules loaded in the browser (see `public/AGENTS.md`) |
| `test/` | Node built-in test runner suite for backend and frontend modules (see `test/AGENTS.md`) |
| `examples/` | Reference plugin implementations (see `examples/AGENTS.md`) |
| `docs/` | Internal documentation (see `docs/AGENTS.md`) |
| `data/` | SQLite database files (runtime-generated, gitignored) |

## For AI Agents

### Working In This Directory
- The project uses **ESM** (`"type": "module"`) — always use `import`/`export`, never `require`.
- Environment variables are loaded via `dotenv` at startup; see `.env.example` for all supported vars.
- Run with `npm start` (calls `node src/index.js`).
- Tests use Node's built-in test runner: `npm test` (calls `node --test`).
- Never commit `.env` or `data/` contents.

### Testing Requirements
- Run `npm test` before submitting changes.
- Tests live in `test/` — both unit (`*.test.js`) and integration (`*.integration.test.js`).
- Integration tests use real temporary SQLite databases and route-level invocation helpers (no ORM mocking).

### Common Patterns
- All async/await; no callbacks except in Node internals.
- `config` object in `src/config.js` is the single source of truth for runtime settings.
- Plugin hooks: `enrichMachine`, `decorateStatusMachine`, `buildAlerts`, `registerRoutes`, `clientAssets`.

## Dependencies

### External
- `better-sqlite3` ^11 — synchronous SQLite bindings
- `dotenv` ^16 — environment variable loading
- `express` ^5 — HTTP server

<!-- MANUAL: -->
