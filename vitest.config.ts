import { defineConfig } from "vitest/config";
import path from "node:path";

// 純粋ロジックのみを対象にする軽量な Vitest 設定。
// @tauri-apps/api を import する重いコンポーネントや E2E(Playwright) は対象外。
export default defineConfig({
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  test: {
    include: ["src/**/*.test.ts"],
    exclude: ["node_modules", "dist", "e2e"],
  },
});
