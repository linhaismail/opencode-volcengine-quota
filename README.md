# opencode-volcengine-quota

OpenCode V2 sidebar widget for **Volcengine Ark** plans: live plan-quota bars, per-session token usage, cache-hit rate, and sub-agent usage — with **multi-account** support.

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

## Multi-account setup (plans on different Volc accounts)

`arkcli` is **single-identity per config dir**, so a second account needs its own isolated HOME:

```sh
mkdir -p ~/.arkcli-b
HOME=~/.arkcli-b arkcli auth login volc-sso   # log into the 2nd account
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

Repeat for account C, D, … with a fresh HOME each time. When an account's STS expires, re-run its `HOME=... arkcli auth login volc-sso`.

## Troubleshooting

| Symptom | Fix |
|---|---|
| Panel shows `ark ✕ not configured` | `arkcli` not logged in for that identity/HOME |
| An account shows no plans | That identity has no subscribed plan, or STS expired (re-login) |
| Missing `5h`/`session` row | Out of date? Refresh with `↻`; reinstall latest |
| Multi-account panel errors | Re-run `HOME=<sandbox> arkcli auth login volc-sso` |

## Development

```sh
npm install
npm run typecheck
npm pack        # build the tarball
```

## License

MIT
