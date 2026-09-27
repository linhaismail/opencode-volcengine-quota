import { Plugin } from "@opencode/plugin"

// Server-side entrypoint. All behavior lives in the TUI entrypoint (tui.ts),
// which renders Volcengine Ark plan quota into the session sidebar only.
export default Plugin.define({
  id: "volcengine-quota",
  setup() {},
})
