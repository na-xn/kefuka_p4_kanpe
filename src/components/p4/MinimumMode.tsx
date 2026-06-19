import { Zap, Snowflake } from "lucide-react";
import { accel, raiMizuAction, tsunamiHonooAction } from "@/p4/logic";
import { DEBUFF_ICON } from "@/p4/icons";
import type { Choice } from "@/p4/types";

/** ミニマムモード（テスト機能・通常モードとは独立）。
 * 7カラム（加速度/フォークライトニング/水圧縮/ほのお/つなみ/サンダガ/ブリザガ）を
 * トグルだけで入力。真偽はカラム名クリックで反転、早/遅は該当列のトグルスイッチ。 */

export type MinVal = { truth: string; when: string };
export type MinState = Record<string, MinVal>;
const DEFAULT: MinVal = { truth: "", when: "haya" };

type Col = {
  id: string;
  name: string;
  /** デバフアイコン画像 src（無ければ lucide） */
  img?: string;
  lucide?: "zap" | "snow";
  /** 早/遅トグルを出すか */
  when: boolean;
  /** 真偽から行動テキストを導出（null=未確定） */
  act: (t: Choice) => string | null;
};

const COLS: Col[] = [
  { id: "accel", name: "加速度", img: DEBUFF_ICON.accel, when: true, act: (t) => accel(t) },
  { id: "rai", name: "フォークライトニング", img: DEBUFF_ICON.rai, when: true, act: (t) => raiMizuAction("rai", t) },
  { id: "mizu", name: "水圧縮", img: DEBUFF_ICON.mizu, when: true, act: (t) => raiMizuAction("mizu", t) },
  { id: "honoo", name: "ほのお", img: DEBUFF_ICON.honoo, when: true, act: (t) => tsunamiHonooAction("honoo", t) },
  { id: "tsunami", name: "つなみ", img: DEBUFF_ICON.tsunami, when: true, act: (t) => tsunamiHonooAction("tsunami", t) },
  { id: "thunda", name: "サンダガ", lucide: "zap", when: false, act: (t) => (t ? (t === "shin" ? "真" : "偽") : null) },
  { id: "blizza", name: "ブリザガ", lucide: "snow", when: false, act: (t) => (t ? (t === "shin" ? "真" : "偽") : null) },
];

/** 早/遅のトグルスイッチ（左=早 / 右=遅）。 */
function EarlyLate({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const oso = value === "oso";
  return (
    <button
      type="button"
      onClick={() => onChange(oso ? "haya" : "oso")}
      aria-label={oso ? "遅" : "早"}
      className={`relative h-6 w-14 shrink-0 rounded-full border transition-colors ${
        oso ? "bg-orange-700" : "bg-amber-500"
      }`}
    >
      <span
        className={`absolute inset-0 flex items-center text-[10px] font-bold ${
          oso ? "justify-start pl-2 text-white" : "justify-end pr-2 text-black"
        }`}
      >
        {oso ? "遅" : "早"}
      </span>
      <span
        className={`absolute top-0.5 size-5 rounded-full bg-white shadow transition-all ${
          oso ? "right-0.5" : "left-0.5"
        }`}
      />
    </button>
  );
}

export function MinimumMode({
  value,
  set,
}: {
  value: MinState;
  set: (id: string, patch: Partial<MinVal>) => void;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <p className="px-0.5 text-[10px] text-muted-foreground">
        カラム名クリックで真偽を反転。早/遅はトグル。（テスト機能）
      </p>
      {COLS.map((c) => {
        const v = value[c.id] ?? DEFAULT;
        const truth = v.truth as Choice;
        const action = c.act(truth);
        const truthCls =
          truth === "shin"
            ? "bg-blue-600 text-white border-blue-600"
            : truth === "gi"
            ? "bg-red-600 text-white border-red-600"
            : "bg-card text-muted-foreground";
        return (
          <div key={c.id} className="flex items-center gap-2 rounded-md border bg-card/40 px-2 py-1.5">
            {/* カラム名（クリックで真偽反転） */}
            <button
              type="button"
              onClick={() => set(c.id, { truth: truth === "shin" ? "gi" : "shin" })}
              className={`flex min-w-0 flex-1 items-center gap-1.5 rounded-md border px-2 py-1 text-xs font-bold ${truthCls}`}
            >
              {c.img ? (
                <img src={c.img} alt="" className="h-5 w-auto shrink-0 rounded-[2px]" draggable={false} />
              ) : c.lucide === "zap" ? (
                <Zap className="size-4 shrink-0" />
              ) : (
                <Snowflake className="size-4 shrink-0" />
              )}
              <span className="truncate">{c.name}</span>
              <span className="ml-auto shrink-0 tabular-nums">
                {truth === "shin" ? "真" : truth === "gi" ? "偽" : "—"}
              </span>
            </button>

            {/* 早/遅トグル（該当列のみ） */}
            {c.when ? (
              <EarlyLate value={v.when} onChange={(w) => set(c.id, { when: w })} />
            ) : (
              <span className="w-14 shrink-0" />
            )}

            {/* 行動テキスト */}
            <span className="w-20 shrink-0 truncate text-right text-[11px] font-bold text-foreground">
              {action ?? "—"}
            </span>
          </div>
        );
      })}
    </div>
  );
}
