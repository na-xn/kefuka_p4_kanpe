import { Zap, Snowflake } from "lucide-react";
import { accel, raiMizuAction, tsunamiHonooAction, fumuText } from "@/p4/logic";
import { DEBUFF_ICON } from "@/p4/icons";
import type { Choice } from "@/p4/types";

/** ミニマムモード（テスト機能・通常モードとは独立）。
 * 7カラム（加速度/フォークライトニング/水圧縮/ほのお/つなみ/サンダガ/ブリザガ）を
 * トグルだけで入力。真偽はカラム名クリックで反転（既定=真）、早/遅は該当列のトグル。
 * 水圧縮とフォークライトニングは排他（どちらか一方のみ使用、他方は未使用）。 */

export type MinVal = { truth: string; when: string }; // truth: "shin" | "gi" | "none"
export type MinState = Record<string, MinVal>;

/** 排他ペア（雷=フォークライトニング ↔ 水=水圧縮）。 */
const PAIR: Record<string, string> = { rai: "mizu", mizu: "rai" };

/** 既定値: 真偽は真。排他ペアは雷を使用・水を未使用。早/遅は炎=早/つなみ=遅、他は早。 */
export const INITIAL_MIN: MinState = {
  accel: { truth: "shin", when: "haya" },
  rai: { truth: "shin", when: "haya" },
  mizu: { truth: "none", when: "haya" },
  honoo: { truth: "shin", when: "haya" },
  tsunami: { truth: "shin", when: "oso" },
  thunda: { truth: "shin", when: "" },
  blizza: { truth: "shin", when: "" },
};

type Col = {
  id: string;
  name: string;
  img?: string;
  lucide?: "zap" | "snow";
  when: boolean;
  act: (t: Choice) => string | null;
};

// 処理順（タイムライン）: ②水属性圧縮→フォークライトニング→加速度 ③サンダガ
// ④混沌早=ほのお ⑤ブリザガ ⑦混沌遅=つなみ。早/遅トグルは可変な 水/雷/加速度 のみ。
const COLS: Col[] = [
  { id: "mizu", name: "水圧縮", img: DEBUFF_ICON.mizu, when: true, act: (t) => raiMizuAction("mizu", t) },
  { id: "rai", name: "フォークライトニング", img: DEBUFF_ICON.rai, when: true, act: (t) => raiMizuAction("rai", t) },
  { id: "accel", name: "加速度", img: DEBUFF_ICON.accel, when: true, act: (t) => accel(t) },
  { id: "thunda", name: "サンダガ", lucide: "zap", when: false, act: (t) => fumuText(t) },
  { id: "honoo", name: "ほのお", img: DEBUFF_ICON.honoo, when: false, act: (t) => tsunamiHonooAction("honoo", t) },
  { id: "blizza", name: "ブリザガ", lucide: "snow", when: false, act: (t) => fumuText(t) },
  { id: "tsunami", name: "つなみ", img: DEBUFF_ICON.tsunami, when: false, act: (t) => tsunamiHonooAction("tsunami", t) },
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
  // カラム名クリック: 排他ペアの未使用列は「使用中（真）」に切替え相方を未使用へ。それ以外は真偽反転。
  const onName = (id: string, truth: string) => {
    if (PAIR[id] && truth === "none") {
      set(PAIR[id], { truth: "none" });
      set(id, { truth: "shin" });
      return;
    }
    set(id, { truth: truth === "shin" ? "gi" : "shin" });
  };

  return (
    <div className="flex flex-col gap-1.5">
      {COLS.map((c) => {
        const v = value[c.id] ?? INITIAL_MIN[c.id] ?? { truth: "shin", when: "haya" };
        const truth = v.truth;
        const none = truth === "none";
        const action = none ? null : c.act(truth as Choice);
        const truthCls =
          truth === "shin"
            ? "bg-blue-600 text-white border-blue-600"
            : truth === "gi"
            ? "bg-red-600 text-white border-red-600"
            : "bg-card text-muted-foreground opacity-50";
        return (
          <div key={c.id} className="flex items-center gap-2 rounded-md border bg-card/40 px-2 py-1.5">
            {/* デバフアイコン＋真偽（クリックで真偽反転 / 排他切替）。名前はツールチップ。 */}
            <button
              type="button"
              onClick={() => onName(c.id, truth)}
              title={c.name}
              aria-label={c.name}
              className={`flex shrink-0 items-center gap-1.5 rounded-md border px-2 py-1 text-xs font-bold ${truthCls}`}
            >
              {c.img ? (
                <img src={c.img} alt="" className="h-5 w-auto shrink-0 rounded-[2px]" draggable={false} />
              ) : c.lucide === "zap" ? (
                <Zap className="size-4 shrink-0" />
              ) : (
                <Snowflake className="size-4 shrink-0" />
              )}
              <span className="tabular-nums">
                {none ? "未使用" : truth === "shin" ? "真" : "偽"}
              </span>
            </button>

            {/* 行動テキスト */}
            <span className="min-w-0 flex-1 truncate text-xs font-bold text-foreground">
              {none ? "—" : action ?? "—"}
            </span>

            {/* 早/遅トグル（一番右。該当列のみ、未使用列は無効） */}
            {c.when && !none ? (
              <EarlyLate value={v.when} onChange={(w) => set(c.id, { when: w })} />
            ) : (
              <span className="w-14 shrink-0" />
            )}
          </div>
        );
      })}
    </div>
  );
}
