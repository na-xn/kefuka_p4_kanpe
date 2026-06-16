import { useEffect, useRef, useState } from "react";
import { Minus, Plus, RotateCcw, X, Lock, LockOpen } from "lucide-react";
import { Button } from "@/components/ui/button";
import { getCurrentWindow } from "@tauri-apps/api/window";

type MenuState = { x: number; y: number } | null;

export default function App() {
  const [count, setCount] = useState(0);
  const [opacity, setOpacity] = useState(1);
  const [locked, setLocked] = useState(false);
  const [menu, setMenu] = useState<MenuState>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  // メニュー外クリック / Esc で閉じる
  useEffect(() => {
    if (!menu) return;
    const onDown = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setMenu(null);
      }
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
    const pad = 8;
    const w = 184;
    const h = 64;
    setMenu({
      x: Math.min(e.clientX, window.innerWidth - w - pad),
      y: Math.min(e.clientY, window.innerHeight - h - pad),
    });
  };

  const closeWindow = async () => {
    try {
      await getCurrentWindow().close();
    } catch {
      /* ブラウザプレビューでは無視 */
    }
  };

  // 位置ロック中はドラッグ領域属性を外して移動を無効化
  const dragProps = locked ? {} : { "data-tauri-drag-region": true };

  return (
    <div
      className="flex h-screen w-screen items-center justify-center bg-transparent p-1.5"
      onContextMenu={openMenu}
    >
      <div
        className="flex h-full w-full flex-col overflow-hidden rounded-xl border border-border bg-background shadow-lg"
        style={{ opacity }}
      >
        {/* ドラッグ用バー */}
        <div
          {...dragProps}
          className="flex h-7 shrink-0 items-center justify-between px-2 text-muted-foreground"
        >
          <span {...dragProps} className="text-[11px] font-medium select-none">
            Counter
          </span>
          <div className="flex items-center gap-0.5">
            <button
              type="button"
              onClick={() => setLocked((l) => !l)}
              className={
                "grid h-5 w-5 place-items-center rounded hover:bg-secondary " +
                (locked ? "text-foreground" : "")
              }
              aria-label={locked ? "位置ロック解除" : "位置ロック"}
              title={locked ? "位置ロック中" : "位置ロック"}
            >
              {locked ? <Lock className="h-3.5 w-3.5" /> : <LockOpen className="h-3.5 w-3.5" />}
            </button>
            <button
              type="button"
              onClick={closeWindow}
              className="grid h-5 w-5 place-items-center rounded hover:bg-secondary"
              aria-label="閉じる"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
        </div>

        {/* 本体 */}
        <div className="flex flex-1 flex-col items-center justify-center gap-3 pb-3">
          <div className="text-5xl font-bold tabular-nums leading-none">{count}</div>
          <div className="flex gap-1.5">
            <Button variant="outline" size="icon" onClick={() => setCount((c) => c - 1)}>
              <Minus className="h-4 w-4" />
            </Button>
            <Button size="icon" onClick={() => setCount((c) => c + 1)}>
              <Plus className="h-4 w-4" />
            </Button>
            <Button variant="ghost" size="icon" onClick={() => setCount(0)}>
              <RotateCcw className="h-4 w-4" />
            </Button>
          </div>
        </div>
      </div>

      {/* 右クリックメニュー: 透過度スライダー */}
      {menu && (
        <div
          ref={menuRef}
          className="fixed z-50 rounded-lg border border-border bg-background p-2 shadow-xl"
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
