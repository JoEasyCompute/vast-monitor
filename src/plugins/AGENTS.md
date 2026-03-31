<!-- Parent: ../AGENTS.md -->
<!-- Generated: 2026-03-31 | Updated: 2026-03-31 -->

# src/plugins

## Purpose
Plugin system public API and loader. Discovers, imports, normalizes, and exposes plugins to the rest of the application. Also builds the client-side asset manifest used by the frontend to load plugin JS/CSS.

## Key Files

| File | Description |
|------|-------------|
| `index.js` | Public re-export barrel — re-exports everything from `loader.js` |
| `loader.js` | `loadPlugins`, `normalizePlugin`, `definePlugin`, `getClientExtensionManifest`, `resolvePluginPublicDir` |

## For AI Agents

### Working In This Directory
- Plugins are loaded from paths listed in `config.pluginModules` (env var `PLUGIN_MODULES`, comma-separated).
- `loadPlugins(runtimeConfig)` — async, resolves module paths relative to `projectRoot` and dynamic-imports them.
- `normalizePlugin(plugin, resolvedFrom)` — validates that the plugin has a `name`, generates a URL-safe `slug`.
- `definePlugin(plugin)` — identity helper; provides type documentation signal, no runtime effect.
- `getClientExtensionManifest(plugins)` — returns `{ scripts: [], styles: [] }` with paths prefixed by `/plugins/<slug>/` when `clientAssets.publicDir` is set.
- `resolvePluginPublicDir(runtimeConfig, plugin)` — resolves the plugin's `publicDir` to an absolute path for Express static serving.

### Plugin Interface (hooks available)
| Hook | Signature | Called from |
|------|-----------|-------------|
| `enrichMachine({ machine, previous, config, db, monitor })` | async → enriched machine object | `FleetMonitor.poll()` during each poll |
| `decorateStatusMachine({ machine, config, db, monitor })` | async → decorated machine object | `server.js` when building `/api/status` response |
| `buildAlerts({ previous, current, timestamp, config, db, monitor })` | async → `{ events[], alerts[] }` | `FleetMonitor.poll()` after each machine |
| `registerRoutes({ app, config, db, monitor })` | sync | `server.js` at startup |
| `clientAssets` | `{ publicDir?, scripts[], styles[] }` | `loader.js` / `server.js` |

### Testing Requirements
- Unit tests: `../../test/plugins.test.js`
- Test `normalizePlugin` with invalid inputs (missing name, non-object) and valid slugification.

### Common Patterns
- Plugins are plain objects (or default exports) — no class required.
- A plugin must have at minimum a `name` string property.
- Slug is auto-derived from `name` if not explicitly set: lowercased, non-alphanumeric chars replaced with `-`.

## Dependencies

### Internal
- Used by `../index.js` (load at startup) and `../server.js` (routes, static dirs, client manifest)

### External
- None (uses `node:path` and `node:url`)

<!-- MANUAL: -->
