import { useState } from "react";
import { Minus, Plus, RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { getCurrentWindow } from "@tauri-apps/api/window";

export default function App() {
  const [count, setCount] = useState(0);
  const [topmost, setTopmost] = useState(true);

  const toggleTopmost = async (next: boolean) => {
    setTopmost(next);
    try {
      await getCurrentWindow().setAlwaysOnTop(next);
    } catch {
      // ブラウザでのプレビュー時など Tauri ランタイム外では無視
    }
  };

  return (
    <main className="flex h-full w-full flex-col items-center justify-center gap-4 p-4">
      <div className="text-6xl font-bold tabular-nums">{count}</div>

      <div className="flex gap-2">
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

      <label htmlFor="topmost" className="flex items-center gap-2 text-sm text-muted-foreground">
        <Switch id="topmost" checked={topmost} onCheckedChange={toggleTopmost} />
        <span>常に最前面</span>
      </label>
    </main>
  );
}
