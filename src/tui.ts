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
//      ] }
// Missing file / empty list → one account on the default HOME.
interface QuotaConfig {
  accounts: AccountSpec[]
}

function readConfig(): QuotaConfig {
  try {
    const raw = readFileSync(join(homedir(), ".config", "opencode", "volcengine-quota.json"), "utf8")
    const cfg = JSON.parse(raw) as Partial<QuotaConfig>
    if (Array.isArray(cfg?.accounts) && cfg.accounts.length > 0) {
      return { accounts: cfg.accounts }
    }
    return { accounts: [] }
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

    let inFlight = false
    const refresh = async () => {
      if (inFlight) return
      inFlight = true
      setBusy(true)
      try {
        const cfg = readConfig()
        const result = await fetchAllUsage({
          accounts: cfg.accounts,
          bin: options.bin,
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
      render: () => {
        const theme = context.theme
        const d = data()
        const rows: Child[] = []
        if (!d) {
          rows.push(text({ fg: theme.text.subdued }, [error() ? "ark ✕" : "ark …"]))
        } else {
          rows.push(text({ fg: theme.text.subdued }, [`ark plans (${d.accounts.length})`]))
          for (const acc of d.accounts) {
            if (acc.plans.length === 0) continue
            const accCollapsed = isAccountCollapsed(acc.label)
            rows.push(
              text(
                { fg: theme.text.subdued, onMouseDown: () => toggleAccount(acc.label) },
                [`${accCollapsed ? "▶" : "▼"} ${acc.label}`],
              ),
            )
            if (accCollapsed) continue
            for (const plan of acc.plans) {
              const planKey = `${acc.label}/${plan.product}`
              const planCollapsed = isPlanCollapsed(acc.label, plan.product)
              rows.push(
                text(
                  { fg: theme.text.default, onMouseDown: () => togglePlan(acc.label, plan.product) },
                  [`${planCollapsed ? "▸" : "▾"} ${plan.product}`],
                ),
              )
              if (planCollapsed) continue
              for (const w of plan.windows) {
                const cd = formatCountdown(w.resetAt, now())
                const row: Child[] = [
                  text({ fg: theme.text.subdued }, [`  ${w.label}`]),
                  text({ fg: theme.text.default }, [bar(w.percent, options.barWidth)]),
                  text({ fg: theme.text.default }, [`${Math.round(w.percent)}%`]),
                ]
                if (cd) row.push(text({ fg: theme.text.subdued }, [`in ${cd}`]))
                rows.push(box({ flexDirection: "row", gap: 1 }, row))
              }
            }
          }
        }
        rows.push(
          text({ fg: theme.text.subdued, onMouseDown: () => refresh() }, [busy() ? "↻ …" : "↻ refresh"]),
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
