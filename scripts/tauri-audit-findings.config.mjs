import { defineConfig } from "vitest/config"
export default defineConfig({ test: { environment: "node", include: ["scripts/tauri-audit-findings.test.ts"] } })
