# コントリビューションガイド

ありがとうございます！バグ報告・要望・PR を歓迎します。

## 開発環境

- Node.js 22+ / [pnpm](https://pnpm.io/) 10+
- デスクトップ起動まで行う場合: Rust（rustup）+ Windows なら WebView2、Linux なら webkit2gtk 等
- UI・ロジックだけならブラウザ（`pnpm dev`）で開発可能（Tauri 呼び出しはガード済み）

```bash
pnpm install
pnpm dev      # http://localhost:1420
pnpm build    # 型チェック + ビルド
pnpm test     # ユニット（Vitest）
pnpm e2e      # E2E（Playwright / chromium）
```

初回 E2E 実行時はブラウザ取得が必要な場合があります: `pnpm exec playwright install chromium`

## ブランチ / PR の流れ

- `main` は保護されており、**PR 経由 + CI（test ワークフロー）成功が必須**です（直接 push は不可）。
- 作業はトピックブランチを切って PR を作成してください。
  ```bash
  git switch -c fix/xxx
  # 変更・コミット
  git push -u origin fix/xxx
  gh pr create
  ```
- PR テンプレートのチェック項目（build / test / e2e）を満たしてください。

## コミットメッセージ

- 1行目に要約（日本語/英語可）。何を・なぜ。
- ゲームロジックの仕様変更は、根拠（記事の挙動など）が分かるように書いてください。

## テスト方針

- **ゲームロジック**（`src/p4/logic.ts` の純粋関数）を変えたら `src/p4/logic.test.ts` を更新。
- **入力フロー / UI** を変えたら `e2e/wizard.spec.ts` を更新（カードは `role="group"` でスコープ）。
- ロジックはできるだけ純粋関数に切り出してユニットテスト可能にしてください。

## コード構成

| パス | 役割 |
| --- | --- |
| `src/p4/` | ゲームロジック（純粋関数）・型・イベントデータ |
| `src/components/p4/` | UI 部品（入力カード・処理タイムライン・汎用トグル） |
| `src/App.tsx` | 状態管理・入力ウィザード・ウィンドウ枠・自動確定 |
| `src-tauri/` | Tauri（Rust）側 |
| `e2e/` | Playwright E2E |

## リリース

`main` にマージ後、メンテナが `git tag vX.Y.Z && git push origin vX.Y.Z` で Windows exe をビルド＆リリースします。

## ライセンス

コントリビュートされた内容は [MIT](./LICENSE) で公開されます。FFXIV 関連の名称等の権利は © SQUARE ENIX に帰属します。
