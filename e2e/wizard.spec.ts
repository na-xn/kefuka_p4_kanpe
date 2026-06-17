import { test, expect } from "@playwright/test";

test.describe("P4 判定入力ウィザード", () => {
  test("ハッピーパス: 5判定を入力して処理フローへ", async ({ page }) => {
    await page.goto("/");

    // 1. 開始 → 判定 1 / 5
    await expect(page.getByText("判定 1 / 5")).toBeVisible();

    // 2. GC1: 担当「雷」+ 真 + 確定 → 判定 2 / 5
    await page.getByRole("radio", { name: "雷", exact: true }).click();
    await page.getByRole("radio", { name: "真", exact: true }).click();
    await page.getByRole("button", { name: /確定/ }).click();
    await expect(page.getByText("判定 2 / 5")).toBeVisible();

    // 3. つなみ/ほのお1: 炎 + 真 + 確定 → 判定 3 / 5
    await page.getByRole("radio", { name: "炎(ほのお)", exact: true }).click();
    await page.getByRole("radio", { name: "真", exact: true }).click();
    await page.getByRole("button", { name: /確定/ }).click();
    await expect(page.getByText("判定 3 / 5")).toBeVisible();

    // 4. GC2: GC1が雷なので自動でなし側(加早/加遅)。加早 + 呪詛「無」 + 真 + 確定 → 判定 4 / 5
    await page.getByRole("radio", { name: "加早", exact: true }).click();
    await page.getByRole("radio", { name: "無", exact: true }).click();
    await page.getByRole("radio", { name: "真", exact: true }).click();
    await page.getByRole("button", { name: /確定/ }).click();
    await expect(page.getByText("判定 4 / 5")).toBeVisible();

    // 5. つなみ/ほのお2: 種類 + 真 + 確定 → 判定 5 / 5
    await page.getByRole("radio", { name: "水(つなみ)", exact: true }).click();
    await page.getByRole("radio", { name: "真", exact: true }).click();
    await page.getByRole("button", { name: /確定/ }).click();
    await expect(page.getByText("判定 5 / 5")).toBeVisible();

    // 6. GC3: アラガン + 真 + 確定 → 処理フロー
    await page.getByRole("radio", { name: "アラガン", exact: true }).click();
    await page.getByRole("radio", { name: "真", exact: true }).click();
    await page.getByRole("button", { name: /確定/ }).click();

    // 処理フロー表示の確認
    await expect(page.getByText("生者の傷（GC3）処理")).toBeVisible();
    await expect(page.getByText("どきどきアルテマ", { exact: false }).first()).toBeVisible();
  });

  test("ALLリセットで判定 1 / 5 に戻る", async ({ page }) => {
    await page.goto("/");

    // 1ステップ進める
    await page.getByRole("radio", { name: "雷", exact: true }).click();
    await page.getByRole("radio", { name: "真", exact: true }).click();
    await page.getByRole("button", { name: /確定/ }).click();
    await expect(page.getByText("判定 2 / 5")).toBeVisible();

    // ALLリセット
    await page.getByRole("button", { name: /ALLリセット/ }).click();
    await expect(page.getByText("判定 1 / 5")).toBeVisible();
  });
});
