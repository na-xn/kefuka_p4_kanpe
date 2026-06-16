import { useState } from "react";
import { Minus, Plus, RotateCcw, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { getCurrentWindow } from "@tauri-apps/api/window";

export default function App() {
  const [count, setCount] = useState(0);

  const closeWindow = async () => {
    try {
      await getCurrentWindow().close();
    } catch {
      /* Tauri ランタイム外（ブラウザプレビュー）では無視 */
    }
  };

  return (
    <div className="flex h-screen w-screen items-center justify-center bg-transparent p-1.5">
      <div className="flex h-full w-full flex-col overflow-hidden rounded-xl border border-border bg-background/95 shadow-lg backdrop-blur">
        {/* ドラッグ用バー（ここを掴んで移動） */}
        <div
          data-tauri-drag-region
          className="flex h-7 shrink-0 items-center justify-between px-2 text-muted-foreground"
        >
          <span data-tauri-drag-region className="text-[11px] font-medium select-none">
            Counter
          </span>
          <button
            type="button"
            onClick={closeWindow}
            className="grid h-5 w-5 place-items-center rounded hover:bg-secondary"
            aria-label="閉じる"
          >
            <X className="h-3.5 w-3.5" />
          </button>
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
    </div>
  );
}
