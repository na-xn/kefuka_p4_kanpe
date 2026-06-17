# 絶妖星乱舞 P4 真偽判定カンペ

[![release](https://img.shields.io/github/v/release/na-xn/kefuka_p4_kanpe)](https://github.com/na-xn/kefuka_p4_kanpe/releases/latest)
[![test](https://github.com/na-xn/kefuka_p4_kanpe/actions/workflows/test.yml/badge.svg)](https://github.com/na-xn/kefuka_p4_kanpe/actions/workflows/test.yml)
[![license](https://img.shields.io/github/license/na-xn/kefuka_p4_kanpe)](./LICENSE)

FFXIV「絶妖星乱舞 P4」フェーズの**真偽判定カンペ**デスクトップアプリ。判定（真/偽・担当）を入力すると、自分のやるべき行動が**処理順（タイムライン）**で表示されます。ゲーム画面の**最前面に常駐**し、**クリックしてもゲームのフォーカスを奪いません**（オーバーレイ）。

> ⚠️ 個人制作のファンツールです。Square Enix とは無関係で、FINAL FANTASY XIV 関連の名称・ギミック表記の権利は © SQUARE ENIX に帰属します。ゲームの利用規約の範囲内でご利用ください。

## 特長

- 入力ウィザード（3画面: GC1+つなみ/ほのお1 / GC2+つなみ/ほのお2 / GC3）→ 確定 → 処理タイムライン
- 担当・加速度・呪詛・早遅などの**排他関係を自動補助**して入力タップを最小化
- 自分が担当する**加速度爆弾・呪詛発生源**のステップを★強調
- ボーダーレス / 常に最前面 / **フォーカス非奪取**（Windows `WS_EX_NOACTIVATE`）
- 右クリックで**透過度スライダー**と**自動確定**（全入力後 N 秒で次へ）、ヘッダーの鍵で位置ロック
- ウィンドウ高さはコンテンツに**自動フィット**（最大＝画面高さ）

## ダウンロード / インストール（Windows）

[**Releases**](https://github.com/na-xn/kefuka_p4_kanpe/releases/latest) から `p4-kanpe.exe` をダウンロードし、ダブルクリックで起動（インストール不要）。

- Windows 10 / 11 対応。初回は [WebView2 ランタイム](https://developer.microsoft.com/microsoft-edge/webview2/) が必要（Win11 は標準同梱）。
- SmartScreen の「発行元不明」警告が出た場合は **「詳細情報」→「実行」**。コード署名証明書を使っていないための表示で、動作に問題はありません。
- くわしい使い方は同梱の `README.md`（[release/README.md](release/README.md)）参照。

## 開発

Linux/SSH で UI・ロジックを開発（GTK 不要、Vite のみ）。「常に最前面」など実機挙動の最終確認は Windows（WebView2）で行う。

```bash
pnpm install
pnpm dev      # http://localhost:1420 をブラウザで（Tauri 呼び出しはガード済み）
pnpm build    # 型チェック + フロントの本番ビルド
pnpm test     # ユニット（Vitest）
pnpm e2e      # E2E（Playwright / chromium）
pnpm tauri dev    # デスクトップアプリ起動（要 Rust + WebView2 + GUI セッション）
```

### 配布ビルド / リリース

`.github/workflows/build-windows.yml` が windows-latest 上で `--no-bundle` ビルド（単体 exe のみ）。

- **手動**: Actions →「build-windows」→ Run workflow → `p4-kanpe-windows` アーティファクト（`p4-kanpe.exe` + `README.md`）。
- **リリース**: `git tag vX.Y.Z && git push origin vX.Y.Z` で Draft Release に `p4-kanpe.exe` + `README.md` を添付。

## 技術スタック

Tauri v2 / React 19 / TypeScript / Vite / Tailwind CSS v4 / shadcn(radix-ui) / Vitest / Playwright

## ディレクトリ

| パス | 役割 |
| --- | --- |
| `src/p4/` | ゲームロジック（純粋関数）・型・イベントデータ |
| `src/components/p4/` | UI 部品（入力カード・処理タイムライン） |
| `src/App.tsx` | 状態管理・入力ウィザード・ウィンドウ枠 |
| `src-tauri/` | Tauri（Rust）側。`WS_EX_NOACTIVATE` 付与など |
| `e2e/` | Playwright E2E |
| `release/README.md` | 配布物に同梱するユーザー向け説明 |

## ライセンス

[MIT](./LICENSE)
