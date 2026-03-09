# vast-monitor

`vast-monitor` is a Node.js service for monitoring a Vast.ai GPU fleet. It polls the Vast CLI, stores fleet snapshots and state changes in SQLite, raises console alerts, and serves a dark-theme dashboard over Express.

## Features

- Polls `vast show machines --raw` on a configurable interval
- Tracks per-machine fleet fields including hostname, GPU type, GPU count, occupancy, rentals, price, reliability, and GPU temperature
- Detects host up/down transitions and rental start/loss events
- Persists snapshots, events, and alerts to SQLite with `better-sqlite3`
- Computes rolling uptime percentages for 24h, 7d, and 30d windows
- Exposes JSON APIs and a mobile-friendly vanilla HTML dashboard
- Uses an alert interface so Telegram or webhook channels can be added later

## Setup

1. Install dependencies:

   ```bash
   npm install
   ```

2. Create your environment file:

   ```bash
   cp .env.example .env
   ```

3. Review `.env` values:

   - `POLL_INTERVAL_MS`: default `300000` (5 minutes)
   - `VAST_CLI_PATH`: default `/Users/josephcheung/Desktop/dev/vast/vast`
   - `ALERT_TEMP_THRESHOLD`: default `85`
   - `ALERT_IDLE_HOURS`: default `6`
   - `PORT`: default `3000`
   - `DB_PATH`: default `./data/vast-monitor.db`

4. Start the service:

   ```bash
   npm start
   ```

5. Open `http://localhost:3000`

## API

- `GET /api/status`: current fleet summary, GPU-type breakdown, and per-machine state
- `GET /api/history?machine_id=49697&hours=24`: historical snapshots for one machine
- `GET /api/alerts?limit=50`: recent alert records

## Notes

- The monitor uses `vast show machines --raw`, which matches the host-fleet fields required by this project.
- Console alerts are implemented through a channel interface in `src/alerts`, making it straightforward to add Telegram or webhook delivery later.
- Uptime percentages are calculated from recorded poll snapshots, so accuracy improves as the service continues running.
