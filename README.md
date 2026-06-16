# counter-topmost

最前面に常駐するカウントアップ用デスクトップアプリ（Tauri v2 + React + Tailwind v4 + shadcn 風 UI）。

開発環境（Linux/SSH）と利用環境（Windows）を分けて運用する。

| やること | 場所 |
| --- | --- |
| UI / ロジック開発 | Linux（SSH 可。GTK 不要、Vite dev サーバのみ） |
| 「常に最前面」の最終確認・常用 | Windows 実機（WebView2） |
| 配布用 `.exe` / `.msi` ビルド | GitHub Actions（windows-latest） |

> `setAlwaysOnTop` は同一デスクトップ内の z-order を操作するため、SSH 越しの転送表示では「手元の最前面」にはならない。最前面の体験確認は必ず Windows 実機で行う。

## 1. Linux/SSH での開発（UI・ロジック）

Vite の dev サーバはただの Web サーバなので GTK 無しで動く。手元から SSH トンネルを張ってブラウザで開く。

```bash
# 手元のターミナル
ssh -L 1420:localhost:1420 <user>@<remote-host>

# リモート側
pnpm install
pnpm dev            # http://localhost:1420
```

ブラウザでは `setAlwaysOnTop` は no-op（try/catch で無視）になるが、カウンタ等の UI/ロジックはすべて動作確認できる。

## 2. Windows 実機での確認（pnpm tauri dev）

前提（1 回だけ）:

- [Rust](https://www.rust-lang.org/tools/install)（`rustup`、MSVC toolchain）
- [Node.js 22+](https://nodejs.org/) と `corepack enable` で pnpm
- [WebView2 Runtime](https://developer.microsoft.com/microsoft-edge/webview2/)（Win11 は同梱、Win10 は要インストール）
- Visual Studio Build Tools（C++ デスクトップ開発ワークロード）

```powershell
git clone <repo> ; cd kefuka_p4_kanpe
pnpm install
pnpm tauri dev      # 320x220 の小窓が常に最前面で起動
```

## 3. 配布用 .exe / .msi（GitHub Actions）

`.github/workflows/build-windows.yml` が windows-latest 上で `--no-bundle` ビルドする（インストーラは作らず、ダブルクリック起動の単体 `counter-topmost.exe` のみ）。Windows 側にツールチェーンは不要。

- **手動ビルド**: GitHub の Actions タブ →「build-windows」→ Run workflow。完了後 `counter-topmost-windows` アーティファクト（`counter-topmost.exe` と `README.md` のみ）を DL。
- **リリース**: `git tag v0.1.0 && git push origin v0.1.0` で Draft Release に `counter-topmost.exe` と `README.md` だけが添付される。

## スクリプト

| コマンド | 内容 |
| --- | --- |
| `pnpm dev` | Vite dev サーバ（フロントのみ） |
| `pnpm build` | 型チェック + フロントの本番ビルド（`dist/`） |
| `pnpm tauri dev` | デスクトップアプリ開発起動（GUI セッション必須） |
| `pnpm tauri build` | ローカルでのネイティブビルド |
