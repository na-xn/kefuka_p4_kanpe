// docs 用スクショ生成: vite preview を起動し、実 UI(chromium)をキャプチャ。
// 使い方: pnpm build && node scripts/shot.mjs
import { chromium } from "@playwright/test";
import { spawn } from "node:child_process";
import { mkdirSync } from "node:fs";
import { setTimeout as sleep } from "node:timers/promises";

const PORT = 4317;
const BASE = `http://localhost:${PORT}`;

const server = spawn(
  "pnpm",
  ["preview", "--port", String(PORT), "--strictPort"],
  { stdio: "ignore" },
);

async function waitServer() {
  for (let i = 0; i < 60; i++) {
    try {
      const r = await fetch(BASE);
      if (r.ok) return;
    } catch {
      /* not up yet */
    }
    await sleep(500);
  }
  throw new Error("preview server did not start");
}

const group = (page, name) => page.getByRole("group", { name });
const radio = (scope, name) => scope.getByRole("radio", { name, exact: true });

// コンテンツ高さにビューポートを合わせる（実機の自動可変を再現）
async function fit(page) {
  const h = await page.evaluate(() => {
    const inner = document.querySelector(".overflow-y-auto > div");
    return (inner ? inner.scrollHeight : document.body.scrollHeight) + 64;
  });
  await page.setViewportSize({ width: 380, height: Math.ceil(h) });
  await page.waitForTimeout(120);
}

try {
  await waitServer();
  mkdirSync("docs", { recursive: true });

  const browser = await chromium.launch();
  const page = await browser.newPage({
    viewport: { width: 380, height: 820 },
    deviceScaleFactor: 2,
  });
  await page.goto(BASE);
  await page.emulateMedia({ colorScheme: "dark" });

  const card = page.locator(".rounded-xl").first();

  // 入力フェーズ（GC1 + つなみ/ほのお1）に少し入力した状態
  const gc1 = group(page, "グランドクロス 1回目");
  await radio(gc1, "雷").click();
  await radio(gc1, "真").click();
  await radio(gc1, "早").click(); // 水雷の処理（早/遅）
  const wave1 = group(page, "つなみ / ほのお 1回目");
  await radio(wave1, "炎(ほのお)").click();
  await radio(wave1, "真").click();
  await radio(wave1, "早").click();
  await fit(page);
  await card.screenshot({ path: "docs/input.png" });

  // 残りを入力して処理フローへ
  await page.getByRole("button", { name: /確定/ }).click();
  const gc2 = group(page, "グランドクロス 2回目");
  await radio(gc2, "加早").click();
  await radio(gc2, "無").click();
  await radio(gc2, "真").click();
  const wave2 = group(page, "つなみ / ほのお 2回目");
  await radio(wave2, "水(つなみ)").click();
  await radio(wave2, "真").click();
  await page.getByRole("button", { name: /確定/ }).click();
  const gc3 = group(page, "グランドクロス 3回目（生者の傷）");
  await radio(gc3, "アラガン").click();
  await radio(gc3, "真").click();
  await page.getByRole("button", { name: /確定/ }).click();

  await page.getByText("生者の傷（GC3）処理").waitFor();
  // 無の氾濫など少し入力して見栄えを整える
  await page.getByRole("radio", { name: "真", exact: true }).first().click();
  await fit(page);
  await card.screenshot({ path: "docs/process.png" });

  await browser.close();
  console.log("saved docs/input.png, docs/process.png");
} finally {
  server.kill();
}
