/**
 * Data layer for the Volcengine Ark quota widget.
 *
 * Pure, TUI-free: shells out to `arkcli usage plan`, parses JSON, and
 * normalizes the rolling-window periods. No Solid or opentui imports.
 *
 * Multi-account: each account is an arkcli identity (default HOME or an
 * isolated HOME). `arkcli usage plan` without --product auto-discovers every
 * subscribed SKU for that identity, so one subprocess per account returns all
 * plans (agent-plan + coding-plan). Team SKUs report empty periods (no quota)
 * and are skipped.
 */

export type WindowKey = "session" | "weekly" | "monthly"

export interface UsageWindow {
  key: WindowKey
  /** Short label shown in the TUI, e.g. "5h", "1W", "1M". */
  label: string
  /** Used percentage, 0-100+. */
  percent: number
  /** ISO timestamp when the window resets. */
  resetAt?: string
}

export interface PlanUsage {
  product: string
  edition?: string
  tier?: string
  windows: UsageWindow[]
}

/** One arkcli identity: a display label + optional isolated HOME / profile. */
export interface AccountSpec {
  /** Panel header label for this account. */
  label?: string
  /** HOME override for an isolated arkcli identity (2nd Volc account). */
  home?: string
  /** Optional arkcli profile to select (--profile). */
  profile?: string
}

export interface AccountUsage extends AccountSpec {
  label: string
  plans: PlanUsage[]
  /** Per-account fetch error (arkcli failed / not authenticated). Present ⇒ this account failed and plans is empty. */
  error?: string
}

export interface UsageData {
  accounts: AccountUsage[]
  updatedAt: number
}

export class UsageError extends Error {}

interface ArkPeriod {
  label?: string
  percent?: number
  reset_at?: string
}

interface ArkItem {
  product?: string
  edition?: string
  tier?: string
  subscribed?: boolean
  periods?: ArkPeriod[]
}

interface ArkPlanOutput {
  items?: ArkItem[]
}

/** Map an arkcli period label to a stable window key + display label.
 *  AgentPlan reports "5h"; CodingPlan reports "session". Both are the short
 *  rolling window — normalize both to the "5h" label for a consistent look. */
function windowKey(raw: string | undefined): { key: WindowKey; label: string } | null {
  const s = (raw ?? "").trim().toLowerCase()
  if (s === "5h") return { key: "session", label: "5h" }
  if (s === "session") return { key: "session", label: "5h" }
  if (s === "weekly") return { key: "weekly", label: "1W" }
  if (s === "monthly") return { key: "monthly", label: "1M" }
  return null
}

const ORDER: WindowKey[] = ["session", "weekly", "monthly"]

/**
 * Query quota for every account and every subscribed plan.
 *
 * Runs `arkcli usage plan` (no --product → auto-discovers all SKUs) once per
 * account in parallel, and normalizes each subscribed item's periods into
 * windows. Team SKUs with empty periods are dropped.
 */
/** Run `arkcli usage plan` for one identity and normalize its plans. Throws UsageError on any failure. */
async function fetchOneAccount(
  bin: string,
  spec: AccountSpec,
  timeoutMs: number,
  excludeProducts?: string[],
): Promise<PlanUsage[]> {
  const args = [bin, "usage", "plan", "--format", "json"]
  if (spec.profile) args.push("--profile", spec.profile)
  const env: Record<string, string | undefined> = { ...Bun.env, ARKCLI_NO_UPDATE_NOTIFIER: "1" }
  if (spec.home) {
    env.HOME = spec.home
    // Windows: the arkcli binary reads USERPROFILE (os.homedir), not HOME.
    if (process.platform === "win32") env.USERPROFILE = spec.home
  }

  const proc = Bun.spawn(args, { stdout: "pipe", stderr: "pipe", env })
  const timer = setTimeout(() => proc.kill(), timeoutMs)
  let stdout = ""
  let stderr = ""
  let exitCode = -1
  try {
    stdout = await new Response(proc.stdout).text()
    stderr = await new Response(proc.stderr).text()
    exitCode = await proc.exited
  } catch (e) {
    throw new UsageError(`failed to run ${bin}: ${(e as Error).message}`)
  } finally {
    clearTimeout(timer)
  }

  if (exitCode !== 0) {
    const hint = stderr.trim().split("\n").pop() ?? ""
    throw new UsageError(
      `${bin} exited ${exitCode}${hint ? `: ${hint}` : " (not installed or not authenticated?)"}`,
    )
  }

  let parsed: ArkPlanOutput
  try {
    parsed = JSON.parse(stdout) as ArkPlanOutput
  } catch {
    throw new UsageError(`could not parse ${bin} JSON output`)
  }

  const plans: PlanUsage[] = []
  for (const item of parsed.items ?? []) {
    if (item.subscribed === false) continue
    if (excludeProducts?.includes(item.product ?? "")) continue
    const rawPeriods = item.periods ?? []
    if (rawPeriods.length === 0) continue // e.g. team SKUs without quota
    const byKey = new Map<WindowKey, UsageWindow>()
    for (const p of rawPeriods) {
      const w = windowKey(p.label)
      if (!w) continue
      byKey.set(w.key, {
        key: w.key,
        label: w.label,
        percent: clampPercent(p.percent ?? 0),
        resetAt: p.reset_at,
      })
    }
    const windows = ORDER.filter((k) => byKey.has(k)).map((k) => byKey.get(k)!)
    if (windows.length === 0) continue
    plans.push({ product: item.product ?? "unknown", edition: item.edition, tier: item.tier, windows })
  }
  return plans
}

export async function fetchAllUsage(
  options: {
    bin?: string
    timeoutMs?: number
    accounts: AccountSpec[]
    excludeProducts?: string[]
  } = { accounts: [] },
): Promise<UsageData> {
  const bin = options.bin ?? "arkcli"
  const timeoutMs = options.timeoutMs ?? 20000
  const accounts = options.accounts.length > 0 ? options.accounts : [{}]

  // Per-account fault isolation: one dead identity (e.g. expired STS) must not
  // blank the whole widget — it becomes an account-level error instead.
  const results = await Promise.all(
    accounts.map(async (spec) => {
      const label = spec.label ?? spec.home ?? "default"
      try {
        const plans = await fetchOneAccount(bin, spec, timeoutMs, options.excludeProducts)
        return { label, home: spec.home, profile: spec.profile, plans }
      } catch (e) {
        return {
          label,
          home: spec.home,
          profile: spec.profile,
          plans: [],
          error: e instanceof UsageError ? e.message : String(e),
        }
      }
    }),
  )

  return { accounts: results, updatedAt: Date.now() }
}

export function clampPercent(value: number): number {
  if (!Number.isFinite(value)) return 0
  return Math.max(0, Math.min(100, value))
}

/** Build a block-character progress bar string for a percentage. */
export function bar(percent: number, width: number, fill = "█", empty = "░"): string {
  const w = Math.max(1, Math.floor(width))
  const filled = Math.round((clampPercent(percent) / 100) * w)
  return fill.repeat(filled) + empty.repeat(w - filled)
}

/** Compact "reset in" countdown, e.g. "4h12m", "35m", "6d". Empty when past. */
export function formatCountdown(resetAt: string | undefined, now: number = Date.now()): string {
  if (!resetAt) return ""
  const ms = new Date(resetAt).getTime() - now
  if (!Number.isFinite(ms) || ms <= 0) return "resetting"
  const mins = Math.floor(ms / 60000)
  const days = Math.floor(mins / (60 * 24))
  const hours = Math.floor((mins % (60 * 24)) / 60)
  const m = mins % 60
  if (days > 0) return `${days}d${hours}h`
  if (hours > 0) return `${hours}h${m}m`
  return `${m}m`
}
