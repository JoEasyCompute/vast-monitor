# vast-monitor

`vast-monitor` is a Node.js service for monitoring a Vast.ai host fleet.

It polls your hosted machines from Vast, enriches them with datacenter tagging metadata, stores state and history in SQLite, emits alerts, and serves a lightweight dashboard over Express.

## Features

- Polls `vast show machines --raw` on a schedule
- Enriches machines with Vast datacenter metadata from the Vast API
- Captures machine-level error messages from Vast machine state
- Tracks current machine state, snapshots, alerts, and events in SQLite
- Detects host up/down transitions and rental activity changes
- Computes rolling uptime for `24h`, `7d`, and `30d`
- Shows fleet health, utilisation, earnings, reports, and datacenter tags in a browser dashboard
- Exposes JSON endpoints for status, history, alerts, and hourly earnings

## Requirements

- Node.js 20+ recommended
- A working Vast CLI install
- A valid Vast API key file

Default assumptions:

- Vast CLI: `~/Desktop/dev/vast/vast`
- Vast API key: `~/.config/vastai/vast_api_key`

## Quick Start

```bash
npm install
cp .env.example .env
npm start
```

Then open `http://localhost:3000`.

## Configuration

Environment variables:

- `POLL_INTERVAL_MS`: poll interval in milliseconds, default `300000`
- `VAST_CLI_PATH`: path to the Vast CLI binary
- `VAST_API_URL`: Vast API base URL, default `https://console.vast.ai/api/v0`
- `VAST_API_KEY_PATH`: path to the Vast API key file
- `ALERT_TEMP_THRESHOLD`: GPU temperature alert threshold, default `85`
- `ALERT_IDLE_HOURS`: idle alert threshold in hours, default `6`
- `PORT`: HTTP port, default `3000`
- `DB_PATH`: SQLite database path, default `./data/vast-monitor.db`

## Startup

Startup is intentionally verbose so you can see progress during the initial poll. Typical output:

```text
[startup] Loading configuration
[startup] Database ready at ...
[startup] Starting HTTP server on port 3000
[startup] Starting fleet monitor
[monitor] Running initial poll
[monitor] Poll started at ...
vast-monitor listening on http://localhost:3000
```

The HTTP server starts before the initial poll finishes, so the process becomes visibly healthy earlier.

## Dashboard

The dashboard includes:

- Fleet summary cards
- GPU type breakdown
- Today’s hourly earnings
- Sortable machine table
- Datacenter `DC` indicator column
- Bright orange highlighting for machines with active error messages
- Recent alerts
- Per-machine history modal

## Datacenter Tagging

Vast does not expose the datacenter tag directly in the host `show machines` payload used by this app.

This project derives it from Vast bundle metadata using:

- `hosting_type === 1` -> machine is treated as datacenter-tagged
- `host_id` -> stored as the datacenter ID internally

In the dashboard, datacenter machines are shown with a blue `DC` pill.

## Machine Errors

The Vast machine payload can include machine-level error text such as:

```text
failed to inject CDI devices: unresolvable CDI devices
```

This project stores that message in machine state when present and uses it in the UI:

- machine rows with an error are highlighted in bright orange
- clicking the machine opens the modal with the error message displayed near the top

The app currently prefers `error_description` and falls back to `vm_error_msg` if needed.

## API

### `GET /api/status`

Returns:

- latest poll time
- summary metrics
- GPU type breakdown
- current machine list

### `GET /api/history?machine_id=49697&hours=24`

Returns historical snapshots for one machine.

Validation:

- `machine_id` must be numeric
- `hours` must be a positive number

### `GET /api/alerts?limit=50`

Returns recent alerts.

Validation:

- `limit` must be a positive number
- maximum `limit` is `500`

### `GET /api/earnings/hourly?date=YYYY-MM-DD`

Returns hourly earnings buckets for a UTC date.

## Database

SQLite is used through `better-sqlite3`.

Main tables:

- `machine_registry`
- `machine_state`
- `polls`
- `machine_snapshots`
- `events`
- `alerts`

### Automatic Schema Patching

If you pull a newer version of this repo onto another machine and start it against an older database, the app patches known additive schema changes automatically on startup.

Current startup migrations cover missing columns including:

- `public_ipaddr`
- `error_message`
- `host_id`
- `hosting_type`
- `is_datacenter`
- `datacenter_id`

As long as the process can write to the SQLite file, an existing DB should upgrade in place.

## Alerts

Alerts are currently delivered to the console through the channel abstraction in [`src/alerts`](./src/alerts).

That makes it easy to add Telegram, webhook, or other delivery backends later.

## Repo Layout

```text
src/
  index.js          startup
  config.js         environment and defaults
  vast-client.js    Vast CLI + Vast API data collection
  monitor.js        polling loop and change detection
  db.js             SQLite schema, queries, and migrations
  server.js         Express API + static file server
  alerts/           alert channel abstraction

public/
  index.html        dashboard shell
  app.js            dashboard rendering
  styles.css        dashboard styling

data/
  vast-monitor.db   SQLite database
```

## Troubleshooting

- If startup stalls after the monitor begins polling, check that the Vast CLI path is correct and the API key file exists.
- If datacenter pills are missing, verify the app can read `VAST_API_KEY_PATH` and reach `VAST_API_URL`.
- If you move the repo to another machine, confirm the SQLite path in `DB_PATH` is writable.

## Notes

- `vast show machines --raw` is still the primary fleet source of truth.
- Datacenter tagging requires both Vast CLI access and Vast API access.
- Uptime accuracy improves as more polling history accumulates.
- The frontend is static HTML/CSS/JS with no build step.
