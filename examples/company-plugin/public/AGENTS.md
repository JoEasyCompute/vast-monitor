<!-- Parent: ../AGENTS.md -->
<!-- Generated: 2026-03-31 | Updated: 2026-03-31 -->

# examples/company-plugin/public

## Purpose
Client-side assets for the company plugin, served by Express at `/plugins/example-company-plugin/`. These files are injected into the dashboard by the plugin's `clientAssets` manifest and extend the UI with owner/team assignment display.

## Key Files

| File | Description |
|------|-------------|
| `company-app.js` | Browser JS that reads `owner_name`/`team_name` fields and prepends a summary banner panel to the dashboard |
| `company.css` | Styles for the plugin banner panel and assignment list |

## For AI Agents

### Working In This Directory
- Files here run **in the browser** — no Node APIs.
- Served at `/plugins/example-company-plugin/<file>` (slug derived from plugin name).
- These files are declared in `../company-plugin.js` under `clientAssets: { publicDir, scripts, styles }`.
- The dashboard loads these after the core `app.js` — they augment, not replace, existing UI.

### Testing Requirements
- No automated tests for these files. Manual verification: activate the plugin, load the dashboard, confirm the company summary banner appears.

## Dependencies

### Internal
- Augments data provided by `../company-plugin.js` hooks (`owner_name`, `team_name`, `company_annotations`)

### External
- Browser-native APIs only

<!-- MANUAL: -->
