import { useEffect, useRef, useState } from "react";
import { X, Lock, LockOpen, RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { getCurrentWindow } from "@tauri-apps/api/window";

type Choice = "shin" | "gi" | "";

type Row = { id: string; name: string; shin: string; gi: string };
type Section = { title: string; rows: Row[] };

const SECTIONS: Section[] = [
  {
    title: "【早デバフの皆様】",
    rows: [
      { id: "1water", name: "💧 早水", shin: "📢 【真】水頭割り参加", gi: "📢 【偽】水散開（頭割り入らない）" },
      { id: "1light", name: "⚡ 早ライトニング", shin: "📢 【真】ライトニング散開", gi: "📢 【偽】ライトニング頭割り" },
      { id: "1look", name: "👁️ 早視線", shin: "📢 【真】視線見ない", gi: "📢 【偽】視線見る" },
      { id: "element1", name: "🌊 1回目 つなみ or ほのお", shin: "📢 【真】水：ドーナツ / 炎：タケノコ", gi: "📢 【偽】水：タケノコ / 炎：ドーナツ" },
    ],
  },
  {
    title: "【遅デバフの皆様】",
    rows: [
      { id: "2water", name: "💧 遅水", shin: "📢 【真】水頭割り参加", gi: "📢 【偽】水散開（頭割り入らない）" },
      { id: "2light", name: "⚡ 遅ライトニング", shin: "📢 【真】ライトニング散開", gi: "📢 【偽】ライトニング頭割り" },
      { id: "2look", name: "👁️ 遅視線", shin: "📢 【真】視線見ない", gi: "📢 【偽】視線見る" },
      { id: "element2", name: "🔥 2回目 つなみ or ほのお", shin: "📢 【真】水：ドーナツ / 炎：タケノコ", gi: "📢 【偽】水：タケノコ / 炎：ドーナツ" },
    ],
  },
  {
    title: "【安置、加速度判断】",
    rows: [
      { id: "thunda", name: "⚡ サンダガ", shin: "📢 【真】直線踏まない", gi: "📢 【偽】直線踏む" },
      { id: "blizza", name: "❄️ ブリザガ", shin: "📢 【真】扇踏まない", gi: "📢 【偽】扇踏む" },
      { id: "accel", name: "⏳ 加速度爆弾", shin: "📢 【真】止まる", gi: "📢 【偽】動き続ける" },
    ],
  },
];

type MenuState = { x: number; y: number } | null;

export default function App() {
  const [sel, setSel] = useState<Record<string, Choice>>({});
  const [opacity, setOpacity] = useState(1);
  const [locked, setLocked] = useState(false);
  const [menu, setMenu] = useState<MenuState>(null);
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

  const setChoice = (id: string, value: Choice) =>
    setSel((s) => ({ ...s, [id]: value }));
  const resetAll = () => setSel({});

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
          <span {...dragProps} className="truncate text-xs font-bold select-none">
            🤡 絶妖星乱舞 P4 真偽判定
          </span>
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
        <div className="flex-1 overflow-y-auto px-2 py-1.5">
          {SECTIONS.map((section) => (
            <div key={section.title} className="mb-2">
              <div className="border-l-2 border-primary pl-1.5 text-[10px] font-bold text-muted-foreground">
                {section.title}
              </div>
              <div className="mt-1 flex flex-col gap-1">
                {section.rows.map((row) => {
                  const choice = sel[row.id] ?? "";
                  return (
                    <div
                      key={row.id}
                      className="flex items-center justify-between gap-2 rounded-md border bg-card px-2 py-1.5"
                    >
                      <div className="flex min-w-0 flex-col">
                        <span className="truncate text-xs font-bold">{row.name}</span>
                        <span className="truncate text-[10px] text-muted-foreground">
                          {choice === "shin" ? row.shin : choice === "gi" ? row.gi : " "}
                        </span>
                      </div>
                      <ToggleGroup
                        type="single"
                        value={choice}
                        onValueChange={(v) => setChoice(row.id, v as Choice)}
                        variant="outline"
                        size="sm"
                        className="shrink-0"
                      >
                        <ToggleGroupItem value="shin" aria-label="真">
                          真
                        </ToggleGroupItem>
                        <ToggleGroupItem value="gi" aria-label="偽">
                          偽
                        </ToggleGroupItem>
                      </ToggleGroup>
                    </div>
                  );
                })}
              </div>
            </div>
          ))}
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
