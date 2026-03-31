<!-- Parent: ../AGENTS.md -->
<!-- Generated: 2026-03-31 | Updated: 2026-03-31 -->

# src/alerts

## Purpose
Alert delivery system. `AlertManager` deduplicates and rate-limits outgoing alerts using a cooldown map, then fans them out to registered channels. `ConsoleAlertChannel` is the only built-in channel — it logs alerts to stdout.

## Key Files

| File | Description |
|------|-------------|
| `alert-manager.js` | `AlertManager` class — `send(alert)`, `shouldSend(alert)`, `markSent(alert)`; per-type cooldown config; dedup key: `alertType|machineId|hostname|message` |
| `console-alert-channel.js` | `ConsoleAlertChannel` — implements `send(alert)` by logging to console; used as the default channel |

## For AI Agents

### Working In This Directory
- `AlertManager` takes `channels[]` and `options` (`defaultCooldownMinutes`, `hostnameCollisionCooldownMinutes`) in its constructor.
- Rate-limited alert types: `new_reports`, `high_temp`, `idle` (use `defaultCooldownMinutes`).
- `hostname_collision` alerts use the separate `hostnameCollisionCooldownMinutes` cooldown.
- All other alert types (e.g., `host_up`, `host_down`) have **no cooldown** (sent every time).
- To add a new alert channel (e.g., Slack, email): implement a class with `async send(alert)` and pass it in the `channels` array in `src/index.js`.

### Testing Requirements
- Unit tests: `../../test/alert-manager.test.js`
- Test `shouldSend` logic with controlled `created_at` timestamps to avoid relying on `Date.now()`.

### Common Patterns
- Alert shape: `{ created_at, machine_id, hostname, alert_type, severity, message, payload_json }`.
- Cooldown state is **in-memory only** — restarting the process resets all cooldowns.

## Dependencies

### Internal
- Used by `../monitor.js` — `alertManager.send(alert)` called after each poll

### External
- None

<!-- MANUAL: -->
