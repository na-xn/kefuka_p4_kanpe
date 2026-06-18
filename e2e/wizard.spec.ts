import { test, expect } from "@playwright/test";
import type { Page } from "@playwright/test";

const group = (page: Page, name: string) => page.getByRole("group", { name });
const radio = (scope: ReturnType<typeof group>, name: string) =>
  scope.getByRole("radio", { name, exact: true });

test.describe("P4 判定入力ウィザード", () => {
  test("ハッピーパス: 3ステップ入力して処理フローへ", async ({ page }) => {
    await page.goto("/");

    // ① GC1 + つなみ/ほのお1（同一画面） → 判定 1 / 3
    await expect(page.getByText("判定 1 / 3")).toBeVisible();
    const gc1 = group(page, "グランドクロス 1回目");
    await radio(gc1, "雷").click();
    await radio(gc1, "真").click();
    await radio(gc1, "早").click(); // 水雷の処理（早/遅）
    const wave1 = group(page, "つなみ / ほのお 1回目");
    await radio(wave1, "炎(ほのお)").click();
    await radio(wave1, "真").click();
    await radio(wave1, "早").click();
    await page.getByRole("button", { name: /確定/ }).click();

    // ② GC2 + つなみ/ほのお2 → 判定 2 / 3
    await expect(page.getByText("判定 2 / 3")).toBeVisible();
    const gc2 = group(page, "グランドクロス 2回目");
    // GC1が雷水なのでGC2は加速度固定側。担当トグルは出ず、処理(早/遅)と呪詛を入力。
    await radio(gc2, "早").click(); // 処理（早/遅）→ gc2_accel
    await radio(gc2, "無").click(); // 呪詛
    await radio(gc2, "真").click();
    const wave2 = group(page, "つなみ / ほのお 2回目");
    // 種類は1回目=炎の排他で自動「水(つなみ)」、早/遅も自動「遅」。真偽のみ入力。
    await radio(wave2, "真").click();
    await page.getByRole("button", { name: /確定/ }).click();

    // ③ GC3 → 処理フロー
    await expect(page.getByText("判定 3 / 3")).toBeVisible();
    const gc3 = group(page, "グランドクロス 3回目（生者の傷）");
    await radio(gc3, "アラガン").click(); // GC3 は担当のみ（真偽不要）
    await page.getByRole("button", { name: /確定/ }).click();

    // 処理フロー表示の確認
    await expect(page.getByText("生者の傷（GC3）処理")).toBeVisible();
    await expect(page.getByText("どきどきアルテマ", { exact: false }).first()).toBeVisible();
  });

  test("ALLリセットで判定 1 / 3 に戻る", async ({ page }) => {
    await page.goto("/");

    // ①を埋めて次へ
    const gc1 = group(page, "グランドクロス 1回目");
    await radio(gc1, "雷").click();
    await radio(gc1, "真").click();
    await radio(gc1, "早").click(); // 水雷の処理（早/遅）
    const wave1 = group(page, "つなみ / ほのお 1回目");
    await radio(wave1, "炎(ほのお)").click();
    await radio(wave1, "真").click();
    await radio(wave1, "早").click();
    await page.getByRole("button", { name: /確定/ }).click();
    await expect(page.getByText("判定 2 / 3")).toBeVisible();

    // ALLリセット
    await page.getByRole("button", { name: /ALLリセット/ }).click();
    await expect(page.getByText("判定 1 / 3")).toBeVisible();
  });
});
