import { useEffect, useRef, useState } from "react";
import { X, Lock, LockOpen, RotateCcw, ChevronLeft } from "lucide-react";
import { Button } from "@/components/ui/button";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { LogicalSize } from "@tauri-apps/api/dpi";
import { getVersion } from "@tauri-apps/api/app";
import { openUrl } from "@tauri-apps/plugin-opener";
import { EventCard } from "@/components/p4/EventCard";
import { ProcessFlow } from "@/components/p4/ProcessFlow";
import { INPUT_EVENTS } from "@/p4/events";
import type { State, Phase, MenuState } from "@/p4/types";

const REPO = "na-xn/kefuka_p4_kanpe";
const RELEASES_URL = `https://github.com/${REPO}/releases/latest`;

/** "v0.4.1" 等を数値配列に。 */
function parseVer(s: string): number[] {
  return s.replace(/^v/i, "").split(".").map((n) => parseInt(n, 10) || 0);
}
/** latest が current より新しいか。 */
function isNewer(latest: string, current: string): boolean {
  const a = parseVer(latest);
  const b = parseVer(current);
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    const x = a[i] || 0;
    const y = b[i] || 0;
    if (x !== y) return x > y;
  }
  return false;
}

type UpdateState =
  | { s: "idle" }
  | { s: "checking" }
  | { s: "latest"; latest: string }
  | { s: "available"; latest: string }
  | { s: "error" };

/** 入力ウィザードのステップ構成: ①GC1+つなみ/ほのお1 ②GC2+つなみ/ほのお2 ③GC3 */
const STEP_GROUPS: string[][] = [
  ["gc1", "wave1"],
  ["gc2", "wave2"],
  ["gc3"],
];

const EVENT_BY_ID = Object.fromEntries(INPUT_EVENTS.map((e) => [e.id, e]));

/** 1イベント分の関連状態キー（自動確定の監視用）。 */
function eventKeys(id: string, state: State): string[] {
  if (id === "gc3") return ["gc3_role__role"];
  if (id === "gc1" || id === "gc2") {
    const n = id === "gc1" ? "1" : "2";
    const keys = [`gc${n}_role__role`, `gc${n}_role`];
    const r = state[`gc${n}_role__role`];
    // 担当=なし は加速度・呪詛 / 雷水は処理タイミング(早遅) も監視対象に含める
    if (r === "nashi") keys.push(`gc${n}_accel`, `gc${n}_juso`);
    if (r === "rai" || r === "mizu") keys.push(`gc${n}_when`);
    return keys;
  }
  if (id === "wave1" || id === "wave2") {
    const n = id === "wave1" ? "1" : "2";
    return [`wave${n}_type__role`, `wave${n}_type`, `wave${n}_when`];
  }
  return [];
}

/** ステップ（複数イベント）の関連キーをまとめて返す。 */
function relatedKeys(step: number, state: State): string[] {
  return (STEP_GROUPS[step] ?? []).flatMap((id) => eventKeys(id, state));
}

/** 1イベント分の必須未入力ラベル。 */
function eventMissing(id: string, get: (k: string) => string): string[] {
  const missing: string[] = [];
  const need = (k: string, l: string) => {
    if (!get(k)) missing.push(l);
  };
  if (id === "gc1" || id === "gc2") {
    const n = id === "gc1" ? "1" : "2";
    need(`gc${n}_role__role`, `GC${n} 担当`);
    need(`gc${n}_role`, `GC${n} 真偽`);
    const r = get(`gc${n}_role__role`);
    if (r === "nashi") {
      need(`gc${n}_accel`, `GC${n} 加速度（早/遅）`);
      need(`gc${n}_juso`, `GC${n} 呪詛（有/無）`);
    }
    if (r === "rai" || r === "mizu") {
      need(`gc${n}_when`, `GC${n} 水雷の処理（早/遅）`);
    }
  } else if (id === "wave1" || id === "wave2") {
    const n = id === "wave1" ? "1" : "2";
    need(`wave${n}_type__role`, `つなみ/ほのお${n} 種類`);
    need(`wave${n}_type`, `つなみ/ほのお${n} 真偽`);
    need(`wave${n}_when`, `つなみ/ほのお${n} 処理（早/遅）`);
  } else if (id === "gc3") {
    need("gc3_role__role", "GC3 担当（アラガン/死の超越）");
  }
  return missing;
}

export default function App() {
  const [state, setState] = useState<State>({});
  const [phase, setPhase] = useState<Phase>("input");
  const [inputStep, setInputStep] = useState(0);
  const [opacity, setOpacity] = useState(1);
  const [locked, setLocked] = useState(false);
  const [menu, setMenu] = useState<MenuState>(null);
  const [errors, setErrors] = useState<string[]>([]);
  const [autoConfirm, setAutoConfirm] = useState(false);
  const [autoConfirmSec, setAutoConfirmSec] = useState(1);
  const [hideEdgeSteps, setHideEdgeSteps] = useState(false); // ①生者の傷・⑧アルテマを隠す
  const [appVersion, setAppVersion] = useState("");
  const [update, setUpdate] = useState<UpdateState>({ s: "idle" });
  const menuRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const lastHeight = useRef(0);

  // ウィンドウ高さをコンテンツに合わせて自動可変（最大＝画面高さ）。最大時のみ本体スクロール。
  useEffect(() => {
    const el = contentRef.current;
    if (!el) return;
    let raf = 0;
    const apply = () => {
      // ヘッダー(32) + 外周padding(12) + カード枠(2) + 本体padding(16) ≒ 62 + 余白
      const chrome = 64;
      const screenH = window.screen.availHeight || window.innerHeight;
      const target = Math.min(el.scrollHeight + chrome, screenH);
      if (Math.abs(target - lastHeight.current) < 2) return;
      lastHeight.current = target;
      try {
        // getCurrentWindow() は Tauri ランタイム外（ブラウザ）では同期例外を投げる
        getCurrentWindow()
          .setSize(new LogicalSize(window.innerWidth, Math.round(target)))
          .catch(() => {});
      } catch {
        /* ブラウザプレビュー等では無視 */
      }
    };
    const ro = new ResizeObserver(() => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(apply);
    });
    ro.observe(el);
    apply();
    return () => {
      ro.disconnect();
      cancelAnimationFrame(raf);
    };
  }, []);

  // メニュー外クリック / Esc で閉じる
  useEffect(() => {
    if (!menu) return;
    const onDown = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setMenu(null);
    };
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setMenu(null);
    window.addEventListener("mousedown", onDown);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("mousedown", onDown);
      window.removeEventListener("keydown", onKey);
    };
  }, [menu]);

  const openMenu = (e: React.MouseEvent) => {
    e.preventDefault();
    const w = 184;
    const h = 240;
    setMenu({
      x: Math.min(e.clientX, window.innerWidth - w - 8),
      y: Math.min(e.clientY, window.innerHeight - h - 8),
    });
  };

  const closeWindow = async () => {
    try {
      await getCurrentWindow().close();
    } catch {
      /* ブラウザプレビューでは無視 */
    }
  };

  // 起動時に現在のアプリバージョンを取得（Tauri 外では空）。
  useEffect(() => {
    getVersion()
      .then(setAppVersion)
      .catch(() => {});
  }, []);

  // GitHub の最新リリースを確認。
  const checkUpdate = async () => {
    setUpdate({ s: "checking" });
    try {
      const res = await fetch(`https://api.github.com/repos/${REPO}/releases/latest`, {
        headers: { Accept: "application/vnd.github+json" },
      });
      if (!res.ok) throw new Error(String(res.status));
      const data = (await res.json()) as { tag_name?: string };
      const latest = (data.tag_name || "").replace(/^v/i, "");
      if (!latest) throw new Error("no tag");
      if (appVersion && isNewer(latest, appVersion)) {
        setUpdate({ s: "available", latest });
      } else {
        setUpdate({ s: "latest", latest });
      }
    } catch {
      setUpdate({ s: "error" });
    }
  };

  const openReleases = async () => {
    try {
      await openUrl(RELEASES_URL);
    } catch {
      window.open(RELEASES_URL, "_blank");
    }
  };

  const get = (key: string): string => state[key] ?? "";
  const set = (key: string, value: string) =>
    setState((s) => ({ ...s, [key]: value }));
  const resetAll = () => {
    setState({});
    setErrors([]);
    setInputStep(0);
    setPhase("input");
  };

  /** 現在の入力ステップ（複数イベント）の必須未入力を検証。不足ラベルの配列を返す。 */
  const validateStep = (step: number): string[] =>
    (STEP_GROUPS[step] ?? []).flatMap((id) => eventMissing(id, get));

  // ①⑧を隠す設定のときは GC3 ステップ（最後）も入力ウィザードから省く。
  const activeStepGroups = hideEdgeSteps ? STEP_GROUPS.slice(0, -1) : STEP_GROUPS;

  // hideEdge 切替で現在ステップが範囲外になったらクランプ。
  useEffect(() => {
    if (inputStep > activeStepGroups.length - 1) {
      setInputStep(activeStepGroups.length - 1);
    }
  }, [activeStepGroups.length, inputStep]);

  /** 現在ステップの確定処理（検証して次へ。最終ステップなら処理フェーズへ）。 */
  const confirmStep = () => {
    const missing = validateStep(inputStep);
    if (missing.length > 0) {
      setErrors(missing);
      return;
    }
    setErrors([]);
    if (inputStep >= activeStepGroups.length - 1) {
      setPhase("process");
    } else {
      setInputStep((s) => s + 1);
    }
  };

  const goBackStep = () => {
    if (inputStep > 0) {
      setErrors([]);
      setInputStep((s) => s - 1);
    }
  };

  // 自動確定: 入力フェーズ & autoConfirm ON のとき、現在ステップの関連キーに
  // 何か値が入っていれば autoConfirmSec 秒後に確定処理を実行（入力ごとにデバウンス）。
  const stepKeys = relatedKeys(inputStep, state);
  const stepValid = validateStep(inputStep).length === 0;
  const stepValues = stepKeys.map((k) => get(k)).join(" ");
  useEffect(() => {
    if (!autoConfirm || phase !== "input" || !stepValid) return;
    const hasInput = stepValues.split(" ").some((v) => v !== "");
    if (!hasInput) return;
    const ms = Math.max(1, Math.min(60, autoConfirmSec)) * 1000;
    const t = setTimeout(() => confirmStep(), ms);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoConfirm, phase, inputStep, autoConfirmSec, stepValid, stepValues]);

  const dragProps = locked ? {} : { "data-tauri-drag-region": true };

  return (
    <div
      className="flex h-screen w-screen items-center justify-center bg-transparent p-1.5"
      onContextMenu={openMenu}
    >
      <div
        className="flex h-full w-full flex-col overflow-hidden rounded-xl border bg-background shadow-lg"
        style={{ opacity }}
      >
        {/* ヘッダー兼ドラッグバー */}
        <div
          {...dragProps}
          className="flex h-8 shrink-0 items-center justify-between gap-2 border-b px-2"
        >
          {phase === "process" ? (
            <Button
              variant="secondary"
              size="xs"
              onClick={() => setPhase("input")}
              className="shrink-0"
            >
              <ChevronLeft />
              判定を編集
            </Button>
          ) : (
            <span {...dragProps} className="truncate text-xs font-bold select-none">
              🤡 絶妖星乱舞 P4 真偽判定
            </span>
          )}
          <div className="flex items-center gap-1">
            <Button variant="destructive" size="xs" onClick={resetAll}>
              <RotateCcw />
              ALLリセット
            </Button>
            <Button
              variant="ghost"
              size="icon-xs"
              onClick={() => setLocked((l) => !l)}
              aria-label={locked ? "位置ロック解除" : "位置ロック"}
              title={locked ? "位置ロック中" : "位置ロック"}
            >
              {locked ? <Lock /> : <LockOpen />}
            </Button>
            <Button variant="ghost" size="icon-xs" onClick={closeWindow} aria-label="閉じる">
              <X />
            </Button>
          </div>
        </div>

        {/* 本体（高さはウィンドウ自動可変。最大時のみスクロール） */}
        <div className="flex-1 overflow-y-auto px-2 py-2">
          <div ref={contentRef}>
          {phase === "input" ? (
            <div className="flex flex-col gap-2">
              {/* 進捗表示 */}
              <div className="flex items-center justify-between px-0.5">
                <span className="text-xs font-bold text-muted-foreground">
                  判定 {inputStep + 1} / {activeStepGroups.length}
                </span>
                {autoConfirm && (
                  <span className="text-[11px] text-muted-foreground">
                    ⏱ 自動確定 ON（{autoConfirmSec}秒）
                  </span>
                )}
              </div>

              {(activeStepGroups[inputStep] ?? []).map((id, i) => (
                <EventCard
                  key={id}
                  index={i + 1}
                  event={EVENT_BY_ID[id]}
                  get={get}
                  set={set}
                />
              ))}

              {errors.length > 0 && (
                <div className="mt-1 rounded-md border border-destructive/50 bg-destructive/10 px-2 py-1.5 text-destructive">
                  <p className="text-xs font-bold">未入力の項目があります:</p>
                  <ul className="mt-1 list-disc pl-4 text-[11px]">
                    {errors.map((e) => (
                      <li key={e}>{e}</li>
                    ))}
                  </ul>
                </div>
              )}

              <div className="mt-1 flex items-center gap-2">
                {inputStep > 0 && (
                  <Button
                    variant="secondary"
                    className="h-11 shrink-0 text-sm font-bold"
                    onClick={goBackStep}
                  >
                    ← 戻る
                  </Button>
                )}
                <Button
                  variant="default"
                  className="h-11 flex-1 text-sm font-bold"
                  onClick={confirmStep}
                >
                  {inputStep >= activeStepGroups.length - 1 ? "確定 → 処理フローへ →" : "確定 →"}
                </Button>
              </div>
            </div>
          ) : (
            <ProcessFlow get={get} set={set} hideEdge={hideEdgeSteps} />
          )}
          </div>
        </div>
      </div>

      {/* 右クリックメニュー: 透過度スライダー */}
      {menu && (
        <div
          ref={menuRef}
          className="fixed z-50 rounded-lg border bg-popover p-2 text-popover-foreground shadow-xl"
          style={{ left: menu.x, top: menu.y, width: 184 }}
          onContextMenu={(e) => e.preventDefault()}
        >
          <div className="mb-1.5 flex items-center justify-between text-[11px] font-medium text-muted-foreground">
            <span>透過度</span>
            <span className="tabular-nums">{Math.round(opacity * 100)}%</span>
          </div>
          <input
            type="range"
            min={0.2}
            max={1}
            step={0.05}
            value={opacity}
            onChange={(e) => setOpacity(Number(e.target.value))}
            className="w-full accent-primary"
          />

          {/* 自動確定 */}
          <div className="mt-2 border-t pt-2">
            <label className="flex cursor-pointer items-center justify-between text-[11px] font-medium text-muted-foreground">
              <span>自動確定</span>
              <input
                type="checkbox"
                checked={autoConfirm}
                onChange={(e) => setAutoConfirm(e.target.checked)}
                className="size-3.5 accent-primary"
              />
            </label>
            <div className="mt-1.5 flex items-center justify-between gap-2 text-[11px] text-muted-foreground">
              <input
                type="number"
                min={1}
                max={60}
                value={autoConfirmSec}
                onChange={(e) =>
                  setAutoConfirmSec(
                    Math.max(1, Math.min(60, Number(e.target.value) || 1))
                  )
                }
                className="w-12 rounded border bg-background px-1 py-0.5 text-right tabular-nums text-foreground"
              />
              <span>秒後に自動確定</span>
            </div>
          </div>

          {/* 処理画面の表示オプション */}
          <div className="mt-2 border-t pt-2">
            <label className="flex cursor-pointer items-center justify-between text-[11px] font-medium text-muted-foreground">
              <span>①生者の傷・⑧アルテマを隠す</span>
              <input
                type="checkbox"
                checked={hideEdgeSteps}
                onChange={(e) => setHideEdgeSteps(e.target.checked)}
                className="size-3.5 accent-primary"
              />
            </label>
          </div>

          {/* 更新確認 */}
          <div className="mt-2 border-t pt-2">
            <div className="flex items-center justify-between gap-2">
              <Button
                variant="secondary"
                size="xs"
                onClick={checkUpdate}
                disabled={update.s === "checking"}
              >
                {update.s === "checking" ? "確認中…" : "更新を確認"}
              </Button>
              <span className="text-[10px] text-muted-foreground tabular-nums">
                {appVersion ? `v${appVersion}` : ""}
              </span>
            </div>
            {update.s === "latest" && (
              <p className="mt-1 text-[10px] text-muted-foreground">最新です（v{update.latest}）</p>
            )}
            {update.s === "error" && (
              <p className="mt-1 text-[10px] text-destructive">確認に失敗しました</p>
            )}
            {update.s === "available" && (
              <button
                type="button"
                onClick={openReleases}
                className="mt-1 w-full rounded bg-primary px-2 py-1 text-[11px] font-bold text-primary-foreground"
              >
                新バージョン v{update.latest} → ダウンロード
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
