<!-- Parent: ../AGENTS.md -->
<!-- Generated: 2026-03-31 | Updated: 2026-03-31 -->

# examples

## Purpose
Reference plugin implementations demonstrating how to build and register a vast-monitor plugin. These examples are not loaded by default — they must be explicitly listed in the `PLUGIN_MODULES` environment variable.

## Subdirectories

| Directory | Purpose |
|-----------|---------|
| `company-plugin/` | Full-featured example plugin that maps machines to owners/teams, adds custom API routes, and injects client-side UI (see `company-plugin/AGENTS.md`) |

## For AI Agents

### Working In This Directory
- Use these as the canonical reference when implementing a new plugin.
- The `company-plugin` demonstrates all four plugin hooks: `enrichMachine`, `decorateStatusMachine`, `buildAlerts`, `registerRoutes`, and the `clientAssets` manifest.
- To activate an example plugin locally: set `PLUGIN_MODULES=./examples/company-plugin/company-plugin.js` in `.env`.

<!-- MANUAL: -->
