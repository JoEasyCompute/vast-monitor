# Private Repo Setup

This document describes a practical way to keep `vast-monitor` public and generic while moving company-specific behavior into a private companion repo.

## Goal

Keep this repo:

- reusable by anyone
- free of company-only logic
- the source of truth for core polling, storage, APIs, and the base dashboard

Move private behavior into a separate repo:

- internal machine tagging
- internal alert rules
- internal API routes
- internal dashboard panels
- any company-only styling or business logic

## Recommended Repo Layout

Public repo:

```text
vast-monitor/
```

Private repo:

```text
vast-monitor-company/
  .env
  package.json
  src/
    company-plugin.js
  public/
    company-app.js
    company.css
```

## Local Development Layout

The simplest local setup is to keep both repos side by side:

```text
/Users/you/dev/
  vast-monitor/
  vast-monitor-company/
```

That makes local paths simple and predictable.

## Step 1: Create The Private Repo

Create a new private GitHub repo, for example:

```text
github.com/<your-org>/vast-monitor-company
```

Clone it next to the public repo.

## Step 2: Copy The Plugin Starter

From the public repo, copy these starter files into the private repo:

- `examples/company-plugin/company-plugin.js` -> `vast-monitor-company/src/company-plugin.js`
- `examples/company-plugin/public/company-app.js` -> `vast-monitor-company/public/company-app.js`
- `examples/company-plugin/public/company.css` -> `vast-monitor-company/public/company.css`

Then replace the example logic with your real company rules.

## Step 3: Private Repo `.env`

Create `vast-monitor-company/.env`:

```bash
PORT=3000
DB_PATH=./data/vast-monitor.db
PLUGIN_MODULES=./src/company-plugin.js

# Usual vast-monitor settings
VAST_CLI_PATH=/absolute/path/to/vast
VAST_API_KEY_PATH=/absolute/path/to/vast_api_key
```

Important:

- `PLUGIN_MODULES` is resolved relative to the current project root
- plugin public assets should also live inside the private repo if they are private

## Step 4: Private Plugin Shape

Minimal private plugin:

```js
import { definePlugin } from "../../vast-monitor/src/plugins/index.js";

export default definePlugin({
  name: "Your Company",

  async enrichMachine({ machine }) {
    return {
      ...machine,
      company_annotations: []
    };
  },

  async buildAlerts({ current, timestamp }) {
    return {
      events: [],
      alerts: []
    };
  },

  registerRoutes({ app }) {
    app.get("/api/company/health", (_req, res) => {
      res.json({ ok: true });
    });
  },

  clientAssets: {
    publicDir: "./public",
    scripts: ["company-app.js"],
    styles: ["company.css"]
  }
});
```

What each hook is for:

- `enrichMachine`: add company-only metadata to machine rows
- `decorateStatusMachine`: add company-only metadata to `/api/status` machines built from stored state
- `buildAlerts`: emit company-only alerts/events
- `registerRoutes`: add internal API endpoints
- `clientAssets`: load internal browser UI code and styles

## Step 5: Running The App

There are two workable patterns.

### Pattern A: Run from the public repo

Use the public repo as the runtime root and point at the private plugin by absolute path.

Example:

```bash
cd /Users/you/dev/vast-monitor
PLUGIN_MODULES=/Users/you/dev/vast-monitor-company/src/company-plugin.js npm start
```

Use this when:

- you want the public repo to remain the runnable app
- the private repo only provides plugins

If you use this pattern, plugin `clientAssets.publicDir` should usually be an absolute path.

Example:

```js
clientAssets: {
  publicDir: "/Users/you/dev/vast-monitor-company/public",
  scripts: ["company-app.js"],
  styles: ["company.css"]
}
```

### Pattern B: Run from the private repo

Use the private repo as the operator workspace and invoke the public app from there.

This is cleaner long term, but you need one small launcher file in the private repo that imports the public core and starts it with the private repo as the config root.

Use this when:

- your team mostly works from the private repo
- you want `.env`, plugin code, and private assets all co-located
- you are ready to maintain a thin bootstrap wrapper

At the moment, Pattern A is the lowest-friction path with the current codebase.

## Step 6: Versioning Strategy

Use tags or pinned commits in the private repo when referencing the public core.

Recommended:

- public repo releases tagged as `v1.x.y`
- private repo tracks a known tag or commit
- update private repo only after validating plugin compatibility

Avoid:

- a long-lived private fork of the public repo
- editing the public repo directly for company-only behavior
- mixing internal defaults into the public README or `.env.example`

## Step 7: What To Keep Public vs Private

Keep public:

- generic monitor behavior
- generic schema changes
- generic alert infrastructure
- generic API shape
- generic dashboard widgets
- plugin hooks and plugin loader

Keep private:

- internal route names and internal endpoints
- company alert thresholds if they are business-specific
- private tags, annotations, or machine ownership rules
- internal dashboard widgets
- internal branding

## First Real Company Uses

Good first company-only features to move into the private plugin:

- map machine IDs or hostnames to internal owner/team tags
- internal maintenance classification rules
- internal health or escalation alerts
- internal-only API endpoints for operator notes
- a company dashboard panel summarizing those annotations

## Suggested First Commit In The Private Repo

Make a small first version:

1. add `company-plugin.js`
2. add one harmless `/api/company/health` route
3. add one simple frontend panel
4. do not change fleet math or core schema yet

That gives you a safe integration checkpoint before adding business logic.

## Owner/Team Mapping Pattern

The safest first real feature is a static mapping file in the private repo.

Recommended private files:

```text
vast-monitor-company/
  src/
    company-plugin.js
  config/
    owner-team-map.json
```

Suggested mapping sources, in order:

1. exact `machine_id`
2. hostname prefix
3. hostname regex

That lets you start simple and stay resilient when machine IDs change.

Example shape:

```json
{
  "machine_ids": [
    { "machine_id": 49697, "owner_name": "Alice", "team_name": "Inference" }
  ],
  "hostname_prefixes": [
    { "prefix": "render-", "owner_name": "Bob", "team_name": "Rendering" }
  ],
  "hostname_patterns": [
    { "pattern": "^train-", "owner_name": "Carol", "team_name": "Training" }
  ]
}
```

Use the private plugin to:

- attach `owner_name` and `team_name` to matching machines
- expose those fields in a private route if useful
- optionally render a small owner/team dashboard panel

The public repo now includes a generic example of this pattern in:

- [examples/company-plugin/company-plugin.js](/Users/josephcheung/Desktop/dev/vast-monitor/examples/company-plugin/company-plugin.js)
- [examples/company-plugin/owner-team-map.json](/Users/josephcheung/Desktop/dev/vast-monitor/examples/company-plugin/owner-team-map.json)

## Current Limitation

The current public repo supports plugin loading and plugin-served static assets, but it does not yet provide:

- a formal npm package boundary
- a dedicated plugin SDK package
- a first-class private wrapper bootstrap

That is fine for now. The plugin seam is enough to keep company-specific work out of the public core.
