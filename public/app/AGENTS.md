<!-- Parent: ../AGENTS.md -->
<!-- Generated: 2026-03-31 | Updated: 2026-03-31 -->

# public/app

## Purpose
Modular browser-side JavaScript for the dashboard. Most files export focused utilities or factory functions for Node-testable behavior, while `../app.js` is the browser entrypoint that performs DOM wiring and startup work at module scope.

## Key Files

| File | Description |
|------|-------------|
| `dashboard-controller.js` | `createDashboardController` — orchestrates the periodic refresh cycle; calls fetch, applies payloads, handles failures |
| `dashboard-loader.js` | Fetches all dashboard API endpoints (`/api/status`, `/api/fleet/history`, `/api/gpu-type/price-history`, `/api/earnings/hourly`, `/api/alerts`) and assembles the combined payload |
| `charts.js` | SVG chart rendering helpers — fleet utilisation, GPU type price history, hourly earnings, machine charts |
| `machine-table.js` | Renders and updates the machine list table rows from status payload |
| `machine-modal.js` | Pure markup/formatting helpers for the per-machine detail modal |
| `modal-controllers.js` | `createMachineModalController` and `createReportsController` — fetch and render modal content, manage navigation |
| `event-wiring.js` | Wires DOM event listeners for filters, tabs, modal controls, gestures, and refresh actions |
| `ui-state.js` | URL/localStorage-backed UI state helpers for machine filters, selected trend window, and earnings date |
| `formatters.js` | Pure formatting utilities: currency, percentages, durations, dates |
| `clipboard.js` | Copy-to-clipboard helper for IP address cells |

## For AI Agents

### Working In This Directory
- Most modules here are imported directly in Node tests and should stay testable without a browser.
- `../app.js` is the exception: it is the browser entrypoint and reads from `document`/`window` at module scope.
- `dashboard-controller.js` is the refresh orchestrator; it depends on `dashboard-loader.js` for data and on callback-style render/apply functions.
- `formatters.js`, `ui-state.js`, `machine-table.js`, and parts of `machine-modal.js` are safe to import in tests.

### Testing Requirements
- Tests in `../../test/frontend-*.test.js` import these modules directly in Node.
- When adding new modules, ensure they export testable pure functions and accept DOM dependencies as parameters.
- Run with `npm test`.

### Common Patterns
- Factory pattern: `createFoo({ dep1, dep2 }) → { method1, method2 }`.
- Payload application functions (`applyStatusPayload`, `applyFleetHistoryPayload`, etc.) take the API response and mutate the DOM.
- `hasXxxPayload()` / `hasXxxRendered()` predicates prevent double-rendering unavailable states.

## Dependencies

### Internal
- Imported by `../app.js`

### External
- Browser-native APIs only (no npm packages in the browser bundle)

<!-- MANUAL: -->
