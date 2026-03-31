<!-- Parent: ../AGENTS.md -->
<!-- Generated: 2026-03-31 | Updated: 2026-03-31 -->

# examples/company-plugin

## Purpose
A fully-featured reference plugin that demonstrates all vast-monitor plugin hooks. It maps machines to owners and teams using a JSON config file, adds a `/api/company/assignments` route, and injects client-side CSS and JS into the dashboard.

## Key Files

| File | Description |
|------|-------------|
| `company-plugin.js` | Plugin entry point — implements `enrichMachine`, `decorateStatusMachine`, `buildAlerts`, `registerRoutes`, and declares `clientAssets` |
| `owner-team-map.json` | Example machine-to-owner/team mapping — supports `machine_ids`, `hostname_prefixes`, and `hostname_patterns` (regex) arrays |

## Subdirectories

| Directory | Purpose |
|-----------|---------|
| `public/` | Client-side assets injected into the dashboard (see `public/AGENTS.md`) |

## For AI Agents

### Working In This Directory
- This is the **canonical plugin example** for local activation and reference.
- To activate locally: `PLUGIN_MODULES=./examples/company-plugin/company-plugin.js` in `.env`.
- Assignment resolution priority: `machine_ids` → `hostname_prefixes` → `hostname_patterns` (first match wins).
- `owner-team-map.json` in this directory is used by the example plugin directly.
- Private repos can instead copy the file into their own `config/` directory and adjust the path there.
- The plugin adds `owner_name`, `team_name`, and `company_annotations` fields to each machine object.

### Testing Requirements
- No dedicated test file exists yet — add `../../test/company-plugin.test.js` if extending this plugin.
- Test `resolveOwnerTeamAssignment` with each match strategy (id, prefix, pattern, no-match).

### Common Patterns
- Use `definePlugin({ name, ...hooks })` as the export — it is an identity function that documents the plugin shape.
- `buildAlerts` returns `{ events: [], alerts: [] }` — always return both keys even if empty.
- `clientAssets.publicDir` is relative to `projectRoot`; Express will serve it at `/plugins/<slug>/`.

## Dependencies

### Internal
- Imports `definePlugin` from `../../src/plugins/index.js`

### External
- Node built-in: `node:fs`, `node:path`, `node:url`

<!-- MANUAL: -->
