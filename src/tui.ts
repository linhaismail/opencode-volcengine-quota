import { Plugin } from "@opencode/plugin/tui"
import { createSignal } from "solid-js"
import { createElement, setProp, insert } from "@opentui/solid"
import { readFileSync } from "node:fs"
import { homedir } from "node:os"
import { join } from "node:path"
import { fetchAllUsage, bar, formatCountdown, UsageError, type AccountSpec, type UsageData } from "./usage"

type Child = string | number | boolean | null | undefined | object | (() => Child)

// Which arkcli identities to show. Each account is one Volc engine identity:
//  - the default HOME (first Volc account)
//  - an optional isolated HOME for a second account, e.g. ~/.arkcli-b
// Configure in ~/.config/opencode/volcengine-quota.json:
//    { "accounts": [
//        { "label": "account A" },
//        { "label": "account B", "home": "/Users/linhai/.arkcli-b" }
//      ],
//      "providerMap": {
//        "ark-agent-plan":       { "account": "account A", "product": "agent-plan" },
//        "ark-agent-plan 2":     { "account": "account B", "product": "agent-plan" }
//      },
//      "excludeProducts": ["coding-plan"] }
// providerMap maps an OpenCode provider ID (the provider the current session
// runs on) to the account + plan it consumes, so the widget can highlight the
// plan and account currently in use. Missing / empty map → no highlight.
interface ProviderTarget {
  account: string
  product?: string
}

interface QuotaConfig {
  accounts: AccountSpec[]
  providerMap?: Record<string, ProviderTarget>
  /** Products to hide from the widget, e.g. ["coding-plan"]. */
  excludeProducts?: string[]
}

function readConfig(): QuotaConfig {
  try {
    const raw = readFileSync(join(homedir(), ".config", "opencode", "volcengine-quota.json"), "utf8")
    const cfg = JSON.parse(raw) as Partial<QuotaConfig>
    return {
      accounts: Array.isArray(cfg?.accounts) ? cfg.accounts : [],
      providerMap:
        cfg?.providerMap && typeof cfg.providerMap === "object" ? (cfg.providerMap as Record<string, ProviderTarget>) : undefined,
      excludeProducts: Array.isArray(cfg?.excludeProducts) ? cfg.excludeProducts : undefined,
    }
  } catch {
    return { accounts: [] }
  }
}

// Collapse state persisted via context.storage.store (durable across hot
// reloads and TUI restarts). Keys:
//   accounts: { [accountLabel]: boolean }  — true = whole account collapsed
//   plans:    { "accountLabel/product": boolean } — true = plan collapsed
interface CollapseState {
  accounts: Record<string, boolean>
  plans: Record<string, boolean>
}

function el(tag: string, props: Record<string, unknown>, children: Child[] = []): any {
  const node = createElement(tag)
  for (const [key, value] of Object.entries(props)) {
    if (value !== undefined) setProp(node, key, value)
  }
  for (const child of children) {
    if (child !== null && child !== undefined && child !== false) insert(node, child)
  }
  return node
}
const box = (props: Record<string, unknown>, children: Child[] = []) => el("box", props, children)
const text = (props: Record<string, unknown>, children: Child[] = []) => el("text", props, children)

/** Accent highlight color: light purple in dark mode, deep purple in light mode. */
function accentColor(theme: any, mode: string | undefined): unknown {
  const hue = theme?.hue?.accent
  if (!hue) return undefined
  return mode === "light" ? (hue[700] ?? hue[600] ?? hue[500]) : (hue[200] ?? hue[300] ?? hue[400])
}

export default Plugin.define({
  id: "volcengine-quota",
  setup(context: any) {
    const options = {
      bin: (context.options?.bin as string) ?? "arkcli",
      pollMs: (context.options?.pollMs as number) ?? 60_000,
      barWidth: (context.options?.barWidth as number) ?? 12,
    }

    const [data, setData] = createSignal<UsageData | null>(null)
    const [error, setError] = createSignal<string | null>(null)
    const [busy, setBusy] = createSignal(false)
    const [now, setNow] = createSignal(Date.now())

    const [collapse, setCollapse] = context.storage.store("volcengine-quota.collapse", {
      initial: { accounts: {}, plans: {} },
    })

    const toggleAccount = (label: string) => {
      void setCollapse((d: CollapseState) => {
        d.accounts[label] = !d.accounts[label]
      })
    }
    const togglePlan = (accountLabel: string, product: string) => {
      void setCollapse((d: CollapseState) => {
        d.plans[`${accountLabel}/${product}`] = !d.plans[`${accountLabel}/${product}`]
      })
    }
    const isAccountCollapsed = (label: string) => collapse.accounts[label] === true
    const isPlanCollapsed = (accountLabel: string, product: string) =>
      collapse.plans[`${accountLabel}/${product}`] === true

    let config: QuotaConfig = readConfig()
    let inFlight = false
    const refresh = async () => {
      if (inFlight) return
      inFlight = true
      setBusy(true)
      try {
        config = readConfig()
        const result = await fetchAllUsage({
          accounts: config.accounts,
          bin: options.bin,
          excludeProducts: config.excludeProducts,
        })
        setData(result)
        setError(null)
      } catch (e) {
        setData(null)
        setError(e instanceof UsageError ? e.message : String(e))
      } finally {
        inFlight = false
        setBusy(false)
      }
    }

    void refresh()
    const poll = setInterval(() => void refresh(), options.pollMs)
    const tick = setInterval(() => setNow(Date.now()), 1000)

    const slot = context.ui.slot({
      after: "sidebar.content",
      render: (input: { sessionID?: string }) => {
        const theme = context.theme
        const accent = accentColor(theme, context.themeMode)

        // Which provider the viewed session runs on. Fall back to the prompt's
        // selected model when the session has no model info.
        let providerID: string | undefined
        if (input?.sessionID) providerID = context.data.session.get(input.sessionID)?.model?.providerID
        providerID ??= context.ui.model.current()?.providerID
        const active = providerID ? config.providerMap?.[providerID] : undefined

        const d = data()
        const rows: Child[] = []
        if (!d) {
          rows.push(text({ fg: theme.text.muted }, [error() ? "ark ✕" : "ark …"]))
        } else {
          rows.push(text({ fg: theme.text.muted }, [`Ark Plans (${d.accounts.length})`]))
          for (const acc of d.accounts) {
            const accCollapsed = isAccountCollapsed(acc.label)
            const isActiveAcc = !!active && acc.label === active.account
            // Per-account failure: keep the widget alive, show header + inline error.
            if (acc.error) {
              rows.push(
                text(
                  {
                    fg: isActiveAcc ? accent : theme.text.muted,
                    onMouseDown: () => toggleAccount(acc.label),
                  },
                  [`${accCollapsed ? "▶" : "▼"} ${acc.label}  ✕`],
                ),
              )
              if (!accCollapsed) {
                const errLine = acc.error.replace(/\s+/g, " ").trim()
                rows.push(
                  text({ fg: theme.text.feedback.error.base }, [
                    `  ✕ ${errLine.length > 64 ? `${errLine.slice(0, 64)}…` : errLine}`,
                  ]),
                )
              }
              continue
            }
            if (acc.plans.length === 0) continue
            rows.push(
              text(
                {
                  fg: isActiveAcc ? accent : theme.text.muted,
                  onMouseDown: () => toggleAccount(acc.label),
                },
                [`${accCollapsed ? "▶" : "▼"} ${acc.label}`],
              ),
            )
            if (accCollapsed) continue
            for (const plan of acc.plans) {
              const planKey = `${acc.label}/${plan.product}`
              const planCollapsed = isPlanCollapsed(acc.label, plan.product)
              const isActivePlan = isActiveAcc && !!active.product && plan.product === active.product
              rows.push(
                text(
                  {
                    fg: isActivePlan ? accent : theme.text.base,
                    onMouseDown: () => togglePlan(acc.label, plan.product),
                  },
                  [`  ${planCollapsed ? "▸" : "▾"} ${plan.product}`],
                ),
              )
              if (planCollapsed) continue
              for (const w of plan.windows) {
                const cd = formatCountdown(w.resetAt, now())
                const row: Child[] = [
                  text({ fg: theme.text.muted }, [`    ${w.label}`]),
                  text({ fg: isActivePlan ? accent : theme.text.base }, [bar(w.percent, options.barWidth)]),
                  text({ fg: isActivePlan ? accent : theme.text.base }, [`${Math.round(w.percent)}%`]),
                ]
                if (cd) row.push(text({ fg: theme.text.muted }, [`in ${cd}`]))
                rows.push(box({ flexDirection: "row", gap: 1 }, row))
              }
            }
          }
        }
        rows.push(
          text({ fg: theme.text.muted, onMouseDown: () => refresh() }, [busy() ? "↻ …" : "↻ refresh"]),
        )

        return box({ flexDirection: "column", marginTop: 1 }, rows)
      },
    })

    return () => {
      clearInterval(poll)
      clearInterval(tick)
      slot?.()
    }
  },
})
