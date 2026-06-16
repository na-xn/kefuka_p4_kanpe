import { useEffect, useRef, useState } from "react";
import { X, Lock, LockOpen, RotateCcw, ChevronLeft } from "lucide-react";
import { Button } from "@/components/ui/button";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { EventCard } from "@/components/p4/EventCard";
import { ProcessFlow } from "@/components/p4/ProcessFlow";
import { INPUT_EVENTS } from "@/p4/events";
import type { State, Phase, MenuState } from "@/p4/types";

export default function App() {
  const [state, setState] = useState<State>({});
  const [phase, setPhase] = useState<Phase>("input");
  const [opacity, setOpacity] = useState(1);
  const [locked, setLocked] = useState(false);
  const [menu, setMenu] = useState<MenuState>(null);
  const [errors, setErrors] = useState<string[]>([]);
  const menuRef = useRef<HTMLDivElement>(null);

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
    const h = 64;
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

  const get = (key: string): string => state[key] ?? "";
  const set = (key: string, value: string) =>
    setState((s) => ({ ...s, [key]: value }));
  const resetAll = () => {
    setState({});
    setErrors([]);
  };

  /** 入力フェーズ必須項目の検証。不足ラベルの配列を返す。 */
  const validateInput = (): string[] => {
    const missing: string[] = [];
    const need = (key: string, label: string) => {
      if (!get(key)) missing.push(label);
    };
    need("gc1_juso", "呪詛の叫声（早）");
    need("gc1_role__role", "GC1 担当（雷/水）の選択");
    need("gc1_role", "GC1 担当の真偽");
    need("gc2_juso", "呪詛の叫声（遅）");
    need("gc2_role__role", "GC2 担当（雷/水）の選択");
    need("gc2_role", "GC2 担当の真偽");
    need("wave1_type__role", "つなみ/ほのお1 種類");
    need("wave1_type", "つなみ/ほのお1 真偽");
    need("wave2_type__role", "つなみ/ほのお2 種類");
    need("wave2_type", "つなみ/ほのお2 真偽");
    need("gc3_role__role", "GC3 担当（アラガン/死の超越）");
    need("gc3_truth", "GC3 担当の真偽");
    if (!get("gc1_accel") && !get("gc2_accel")) {
      missing.push("加速度爆弾（GC1 か GC2 のどちらか一方）");
    }
    return missing;
  };

  const confirmToProcess = () => {
    const missing = validateInput();
    if (missing.length > 0) {
      setErrors(missing);
      return;
    }
    setErrors([]);
    setPhase("process");
  };

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

        {/* 本体（スクロール可能） */}
        <div className="flex-1 overflow-y-auto px-2 py-2">
          {phase === "input" ? (
            <div className="flex flex-col gap-2">
              {INPUT_EVENTS.map((ev, idx) => (
                <EventCard
                  key={ev.id}
                  index={idx + 1}
                  event={ev}
                  get={get}
                  set={set}
                  inputPhase
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
              <Button
                variant="default"
                className="mt-1 h-11 w-full text-sm font-bold"
                onClick={confirmToProcess}
              >
                確定 → 処理フローへ →
              </Button>
            </div>
          ) : (
            <ProcessFlow get={get} set={set} />
          )}
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
        </div>
      )}
    </div>
  );
}
