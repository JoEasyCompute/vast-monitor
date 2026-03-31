<!-- Parent: ../AGENTS.md -->
<!-- Generated: 2026-03-31 | Updated: 2026-03-31 -->

# public

## Purpose
Frontend static assets served directly by Express. Contains the single-page dashboard HTML, global CSS, and the top-level `app.js` entry point that bootstraps the browser application. All browser JavaScript uses vanilla ES modules — no bundler.

## Key Files

| File | Description |
|------|-------------|
| `index.html` | Dashboard HTML shell — loads `app.js` as an ES module and references `styles.css` |
| `app.js` | Frontend entry point — imports modules from `app/`, wires event listeners, starts the auto-refresh loop, and manages local dashboard display settings such as carousel mode |
| `styles.css` | Global dashboard styles |

## Subdirectories

| Directory | Purpose |
|-----------|---------|
| `app/` | Modular frontend JS — charts, table rendering, modal controllers, formatters, UI state (see `app/AGENTS.md`) |

## For AI Agents

### Working In This Directory
- All JS here runs **in the browser** as native ES modules (`<script type="module">`).
- No build step — changes to `.js` files are immediately reflected on page reload.
- `app.js` is the only script tag entry point; it imports from `./app/`.
- Plugin client assets are served under `/plugins/<slug>/` and injected by the backend via `getClientExtensionManifest`.

### Testing Requirements
- Frontend unit tests live in `../test/` prefixed with `frontend-` (e.g., `frontend-dashboard-controller.test.js`).
- These tests import the frontend modules directly in Node (they are pure functions with no DOM dependency by design).
- No browser test runner is configured — keep modules free of direct `window`/`document` access where possible; accept them as injected dependencies.

### Common Patterns
- UI modules export pure factory functions that accept dependencies as parameters (dependency injection pattern).
- State is managed through explicit getter/setter functions passed between modules rather than global variables.

## Dependencies

### Internal
- `app/` modules are imported by `app.js`

### External
- No npm dependencies — all browser-native APIs

<!-- MANUAL: -->
