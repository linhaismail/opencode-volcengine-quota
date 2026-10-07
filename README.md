# opencode-volcengine-quota

OpenCode V2 sidebar widget for **Volcengine Ark** plans: live plan-quota bars for every account and plan, with **multi-account** support and collapsible sections.

## Features

- **Plan quota** — Agent Plan / Coding Plan used-percent bars with reset countdown, read live from `arkcli usage plan`.
- **Multi-account aggregation** — every Volc engine account is one `arkcli` identity; the panel lists all of them with their subscribed plans side by side.
- **Auto-discovery** — each account runs one `arkcli usage plan` call (no `--product`) that returns every subscribed SKU (agent-plan + coding-plan) automatically.
- **Collapsible** — click an account or plan header to collapse it; state persists across restarts.

## Prerequisites

- OpenCode **V2** (TUI).
- [`arkcli`](https://github.com/volcengine/ark-cli) installed and SSO-logged-in:
  ```sh
  arkcli auth login volc-sso
  arkcli usage plan --product agent-plan   # sanity check
  ```

## Install

Add the package to `plugins` in `~/.config/opencode/opencode.jsonc`:

```jsonc
{
  "plugins": [
    {
      "package": "opencode-volcengine-quota",
      "options": {
        "bin": "arkcli",        // optional: arkcli binary name/path
        "pollMs": 60000,        // optional: quota refresh interval
        "barWidth": 12          // optional: progress bar width
      }
    }
  ]
}
```

## Configuration

The plugin reads `~/.config/opencode/volcengine-quota.json`. When the file is missing or `accounts` is empty, it shows a single account on the default arkcli identity:

```jsonc
{
  "accounts": [
    { "label": "account A" },
    { "label": "account B", "home": "/Users/you/.arkcli-b", "profile": "optional-profile-name" }
  ]
}
```

- `label` — panel header for the account.
- `home` — optional HOME override: an **isolated arkcli identity** for a second Volc account (see below).
- `profile` — optional `--profile` passed to arkcli.

Each account runs `arkcli usage plan` in parallel, so any number of accounts/plans show together.

## Highlighting the plan currently in use

The widget highlights the plan (and its account) that the **current session is
running on**, using the theme's accent color. Wire it up with a `providerMap`
that maps each OpenCode provider ID to the account + plan it consumes:

```jsonc
{
  "accounts": [
    { "label": "account A" },
    { "label": "account B", "home": "/Users/you/.arkcli-b" }
  ],
  "providerMap": {
    "ark-agent-plan":        { "account": "account A", "product": "agent-plan" },
    "ark-agent-plan 2":      { "account": "account B", "product": "agent-plan" },
    "volcengine-coding-plan": { "account": "account A", "product": "coding-plan" }
  }
}
```

- The active account header, the active plan's header, and the active plan's
  progress bar + percentage are all rendered in the accent color. Plans are
  indented under their account for a clearer hierarchy.
- The provider is read from the viewed session's model (`SessionInfo.model`),
  falling back to the prompt's selected model.
- Missing/empty `providerMap` or an unmapped provider → no highlight (all rows
  render normally).

## Multi-account setup (plans on different Volc accounts)

`arkcli` is **single-identity per config dir**, so a second account needs its own isolated HOME:

```sh
mkdir -p ~/.arkcli-b
HOME=~/.arkcli-b arkcli auth login volc-sso   # log into the 2nd account
```

**Windows (PowerShell):** `arkcli` is a compiled binary and resolves its config dir from `USERPROFILE` (Node's `os.homedir()`), **not** `HOME`. Set `USERPROFILE` in the same terminal session:

```powershell
New-Item -ItemType Directory -Force -Path "$HOME\.arkcli-b"
$env:USERPROFILE = "$HOME\.arkcli-b"
arkcli auth login volc-sso   # log into the 2nd account
```

Then reference the sandbox in `volcengine-quota.json`:

```jsonc
{
  "accounts": [
    { "label": "account A" },
    { "label": "account B", "home": "/Users/you/.arkcli-b" }
  ]
}
```

On Windows, use the same path style for `home` (e.g. `C:\Users\you\.arkcli-b`).

Repeat for account C, D, … with a fresh HOME each time. When an account's STS expires, re-run its `HOME=... arkcli auth login volc-sso` (Windows: `$env:USERPROFILE = ...`).

## Troubleshooting

| Symptom | Fix |
|---|---|
| Panel shows `ark ✕ not configured` | `arkcli` not logged in for that identity/HOME |
| An account shows no plans | That identity has no subscribed plan, or STS expired (re-login) |
| Missing `5h`/`session` row | Out of date? Refresh with `↻`; reinstall latest |
| Multi-account panel errors | Re-run `HOME=<sandbox> arkcli auth login volc-sso` |

## Development

The package source is synced from the live local plugin, so development is a
hot-reload loop.

### Local dev (hot reload)

1. Keep the plugin loaded from the **local directory**, not the npm package,
   so edits hot-reload into the running TUI:
   - `~/.config/opencode/plugins/volcengine-quota/` exists
   - `opencode-volcengine-quota` is **not** in the `plugins` array of
     `opencode.jsonc` (same plugin id would conflict)
2. Edit files under `~/.config/opencode/plugins/volcengine-quota/`:
   - `index.ts` — server entrypoint (rarely touched)
   - `tui.ts`   — the sidebar widget
   - `usage.ts` — arkcli data layer
3. Save — the TUI hot-reloads and the sidebar updates within seconds.

### Publish a new version

`publish.sh` syncs the local plugin into `src/`, bumps the version,
typechecks, and publishes:

```sh
./publish.sh          # patch: 1.0.0 → 1.0.1
./publish.sh minor    # minor: 1.0.0 → 1.1.0
./publish.sh major    # major: 1.0.0 → 2.0.0
./publish.sh 1.2.3    # exact version
./publish.sh --dry-run  # sync only, no bump / publish
```

The local plugin is the single source of truth — `publish.sh` always copies
from `~/.config/opencode/plugins/volcengine-quota/` before publishing.

### Manual build

```sh
npm install
npm run typecheck
npm pack        # build the tarball
```

## License

MIT
