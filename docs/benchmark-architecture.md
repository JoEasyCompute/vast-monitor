# Benchmark Architecture

This document explains where the Vast market-benchmark feature lives in the codebase and how data flows from the external source into the dashboard.

## Purpose

The benchmark feature compares this fleet's GPU utilization and pricing against current and historical market-wide snapshots sourced from:

- `https://gpu-treemap.replit.app/api/gpu-data`

The implementation is intentionally strict about GPU matching:

- safe exact/canonical matches are allowed
- generic internal labels such as `H100` and `A100` do **not** collapse variant-specific upstream rows such as `h100 pcie`, `h100 sxm`, or `a100 sxm4`

## File map

### Backend

#### `src/platform-metrics.js`
Owns the **external-source client and matching logic**.

Responsibilities:
- fetch/cache external benchmark snapshots
- normalize external GPU rows
- canonical GPU matching
- strict ambiguity handling
- market-enriched GPU breakdown shaping
- weighted fleet benchmark calculations
- market price comparison deltas

Use this file when changing:
- upstream fetch/caching behavior
- GPU matching rules
- current-summary/breakdown enrichment logic

#### `src/platform-metrics-history.js`
Owns **pure historical benchmark transformation helpers**.

Responsibilities:
- build historical market GPU-utilization series
- build weighted historical fleet benchmark series
- build hourly rollup rows for persisted benchmark snapshots

Use this file when changing:
- benchmark history shaping
- benchmark rollup aggregation rules
- weighted benchmark history semantics

#### `src/monitor.js`
Owns the **poll loop**.

Responsibilities:
- poll Vast machines
- fetch current benchmark snapshot through the shared platform-metrics client
- pass benchmark snapshots into the database along with the normal fleet poll

Use this file when changing:
- when benchmark snapshots are recorded
- what should happen if benchmark fetches fail during polling

#### `src/db.js`
Owns **all SQLite writes and query orchestration**.

Responsibilities:
- schema migrations
- raw benchmark snapshot persistence
- benchmark hourly rollup persistence
- retention compaction/deletion
- rebuild-derived maintenance operations
- read APIs for merged raw+rollup benchmark history

Important rule:
- `db.js` remains the **only SQLite write layer**

Use this file when changing:
- schema
- statements
- retention/rebuild behavior
- how raw and rolled benchmark history are read back

#### `src/server.js`
Owns **API response shaping**.

Responsibilities:
- include benchmark freshness/status in `/api/health`
- include benchmark health/counts in `/api/admin/db-health`
- include benchmark-enriched breakdown and summary in `/api/status`
- expose historical benchmark series in `/api/fleet/history`

Use this file when changing:
- what benchmark data the frontend receives
- health/admin surface payloads

### Frontend

#### `public/app.js`
Owns **dashboard orchestration**.

Responsibilities:
- render benchmark-enriched breakdown rows
- merge benchmark series into chart data
- choose between:
  - real historical benchmark series
  - leading-gap backfill
  - synthetic fallback baseline
- coordinate shared tooltip display

Use this file when changing:
- overall rendering flow
- fallback order for benchmark chart behavior

#### `public/app/market-tooltip.js`
Owns the **Vast Util tooltip content**.

Responsibilities:
- serialize/parse tooltip payloads
- render the utilization-market detail tooltip markup

Use this file when changing:
- the `Vast Util` tooltip content

#### `public/app/market-benchmarks.js`
Owns **frontend benchmark rendering helpers**.

Responsibilities:
- price-comparison tooltip payloads/markup
- chart-series merge helpers
- synthetic benchmark baseline helpers
- canonical frontend series matching

Use this file when changing:
- Avg Price tooltip behavior
- chart fallback shaping
- frontend market-series merge logic

#### `public/app/event-wiring.js`
Owns **tooltip interactions**.

Responsibilities:
- hover interactions
- keyboard focus / `Enter` / `Space` / `Escape`
- touch/click toggling
- outside-click dismissal

Use this file when changing:
- how users open/close benchmark tooltips

## Data flow

### Current benchmark snapshot

1. `src/platform-metrics.js`
   - fetches and caches the upstream benchmark snapshot
2. `src/server.js`
   - uses the cached snapshot for `/api/status`, `/api/health`, and `/api/admin/db-health`
3. `public/app.js`
   - renders current benchmark values in the breakdown and chart fallbacks

### Persisted historical benchmark path

1. `src/monitor.js`
   - fetches the current benchmark snapshot during polling
2. `src/db.js`
   - stores raw benchmark rows in `platform_gpu_metric_snapshots`
3. `src/db.js`
   - compacts older raw rows into `platform_gpu_metric_hourly_rollups` during retention
4. `src/platform-metrics-history.js`
   - shapes raw+rollup rows into benchmark history series
5. `src/server.js`
   - exposes benchmark history through `/api/fleet/history`
6. `public/app.js`
   - renders:
     - historical benchmark series when available
     - first-point backfill when history starts late
     - synthetic fallback baseline when history is absent

## Fallback order for the utilization chart

For the selected series, the frontend currently prefers:

1. **Real persisted historical benchmark series**
2. **Leading-gap backfill** using the first available benchmark point
3. **Synthetic full-range fallback baseline** from the current benchmark value

This order should stay stable unless the product behavior changes deliberately.

## Operator surfaces

### `/api/health`
Shows:
- benchmark live/cached/unavailable state
- fetched timestamp
- source
- last error

### `/api/admin/db-health`
Shows:
- raw benchmark snapshot counts
- benchmark hourly rollup counts
- benchmark health/freshness/source/error

### `DB Admin`
Shows:
- benchmark raw/rollup counts
- benchmark state badge
- benchmark freshness/source details
- benchmark-specific warnings when unavailable or stale

## Future changes guidance

Prefer these boundaries:

- **fetch/cache/matching/current summary** → `src/platform-metrics.js`
- **historical shaping/rollups** → `src/platform-metrics-history.js`
- **SQLite execution** → `src/db.js`
- **API payloads** → `src/server.js`
- **frontend orchestration** → `public/app.js`
- **tooltip content** → `public/app/market-tooltip.js` and `public/app/market-benchmarks.js`
- **tooltip interaction mechanics** → `public/app/event-wiring.js`
