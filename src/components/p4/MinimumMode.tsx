import { Zap, Snowflake } from "lucide-react";
import { accel, raiMizuAction, tsunamiHonooAction, fumuText, juso } from "@/p4/logic";
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


/** 既定値: 真偽は真。排他ペアは雷を使用・水を未使用。早/遅の既定は早。 */
export const INITIAL_MIN: MinState = {
  mizu: { truth: "none", when: "haya" },
  rai: { truth: "shin", when: "haya" },
  accel: { truth: "shin", when: "haya" },
  juso_haya: { truth: "shin", when: "" },
  juso_oso: { truth: "shin", when: "" },
  honoo: { truth: "shin", when: "" },
  tsunami: { truth: "shin", when: "" },
  thunda: { truth: "shin", when: "" },
  blizza: { truth: "shin", when: "" },
};

/**
 * 処理順ソート用のフェーズ値（小さいほど先）。早/遅で位置が変わる列は when を反映。
 * ②水雷/加速度（早）→③叫び早→④ほのお→⑤水雷/加速度（遅）→⑥叫び遅→⑦つなみ。
 * サンダガ/ブリザガは一番下固定。
 */
function phaseOf(id: string, when: string): number {
  const oso = when === "oso";
  switch (id) {
    case "mizu": return oso ? 5.0 : 1.0;
    case "rai": return oso ? 5.1 : 1.1;
    case "accel": return oso ? 5.2 : 1.2;
    case "juso_haya": return 2.0;
    case "juso_oso": return 6.0;
    case "honoo": return 4.0;
    case "tsunami": return 7.0;
    case "thunda": return 100;
    case "blizza": return 101;
    default: return 50;
  }
}

type Col = {
  id: string;
  name: string;
  img?: string;
  lucide?: "zap" | "snow";
  when: boolean;
  act: (t: Choice) => string | null;
};

// 早/遅トグルは処理位置が変わる 水/雷/加速度/叫び のみ。表示順は phaseOf で処理順に動的ソート。
const COLS: Col[] = [
  { id: "mizu", name: "水圧縮", img: DEBUFF_ICON.mizu, when: true, act: (t) => raiMizuAction("mizu", t) },
  { id: "rai", name: "フォークライトニング", img: DEBUFF_ICON.rai, when: true, act: (t) => raiMizuAction("rai", t) },
  { id: "accel", name: "加速度", img: DEBUFF_ICON.accel, when: true, act: (t) => accel(t) },
  { id: "juso_haya", name: "叫び（早）", img: DEBUFF_ICON.juso, when: false, act: (t) => juso(t) },
  { id: "juso_oso", name: "叫び（遅）", img: DEBUFF_ICON.juso, when: false, act: (t) => juso(t) },
  { id: "honoo", name: "ほのお", img: DEBUFF_ICON.honoo, when: false, act: (t) => tsunamiHonooAction("honoo", t) },
  { id: "tsunami", name: "つなみ", img: DEBUFF_ICON.tsunami, when: false, act: (t) => tsunamiHonooAction("tsunami", t) },
  { id: "thunda", name: "サンダガ", lucide: "zap", when: false, act: (t) => fumuText(t) },
  { id: "blizza", name: "ブリザガ", lucide: "snow", when: false, act: (t) => fumuText(t) },
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
  // 加速度と叫び（呪詛）は同じ なし担当GC 由来で真偽が共通なので連動。
  const onName = (id: string, truth: string) => {
    if (PAIR[id] && truth === "none") {
      set(PAIR[id], { truth: "none" });
      set(id, { truth: "shin" });
      return;
    }
    const next = truth === "shin" ? "gi" : "shin";
    set(id, { truth: next });
    // 加速度 ↔ 叫び（加速度と同じ早/遅側＝同じ なし担当GC）を連動。
    const accelWhen = (value["accel"] ?? INITIAL_MIN["accel"]).when;
    const jusoId = accelWhen === "oso" ? "juso_oso" : "juso_haya";
    if (id === "accel") set(jusoId, { truth: next });
    else if (id === jusoId) set("accel", { truth: next });
  };

  // 処理順にソート（早/遅で水雷/加速度/叫びの位置が入れ替わる。サンダガ/ブリザガは最下部固定）。
  const sorted = [...COLS].sort((a, b) => {
    const wa = (value[a.id] ?? INITIAL_MIN[a.id])?.when ?? "haya";
    const wb = (value[b.id] ?? INITIAL_MIN[b.id])?.when ?? "haya";
    return phaseOf(a.id, wa) - phaseOf(b.id, wb);
  });

  return (
    <div className="flex flex-col gap-1.5">
      {sorted.map((c) => {
        const v = value[c.id] ?? INITIAL_MIN[c.id] ?? { truth: "shin", when: "haya" };
        const truth = v.truth;
        const none = truth === "none";
        const action = none ? null : c.act(truth as Choice);
        const truthCls =
          truth === "shin"
            ? "bg-blue-600 text-white border-blue-600"
            : truth === "gi"
            ? "bg-red-600 text-white border-red-600"
            : "bg-card text-muted-foreground";
        return (
          <div
            key={c.id}
            className={`flex items-center gap-2 rounded-md border bg-card/40 px-2 py-1.5 ${
              none ? "opacity-55" : ""
            }`}
          >
            {/* デバフアイコン（中立背景・名前はツールチップ） */}
            <span title={c.name} className="flex w-6 shrink-0 justify-center">
              {c.img ? (
                <img src={c.img} alt="" className="h-5 w-auto rounded-[2px]" draggable={false} />
              ) : c.lucide === "zap" ? (
                <Zap className="size-5" />
              ) : (
                <Snowflake className="size-5" />
              )}
            </span>

            {/* 真偽トグル（クリックで真偽反転 / 排他切替） */}
            <button
              type="button"
              onClick={() => onName(c.id, truth)}
              aria-label={`${c.name} 真偽`}
              className={`w-12 shrink-0 rounded-md border px-2 py-1 text-center text-xs font-bold tabular-nums ${truthCls}`}
            >
              {none ? "—" : truth === "shin" ? "真" : "偽"}
            </button>

            {/* 行動テキスト（クリックでも真偽反転 / 排他切替） */}
            <button
              type="button"
              onClick={() => onName(c.id, truth)}
              aria-label={`${c.name} 真偽`}
              className="min-w-0 flex-1 truncate text-left text-xs font-bold text-foreground"
            >
              {none ? "—" : action ?? "—"}
            </button>

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
