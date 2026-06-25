import { Zap, Snowflake, Swords, UserX, Users } from "lucide-react";
import { DEBUFF_ICON } from "@/p4/icons";
import { SelectToggle } from "@/components/p4/primitives";
import { buildTimeline } from "@/p4/timeline";
import type { Item } from "@/p4/timeline";

/** ミニマムモード（テスト機能・通常モードとは独立）。
 * 役割ベース・最小入力。セットアップ（自分の水雷タイプ/GC/早遅・加速度系の視線/無職）と
 * 4つの真偽観測（GC1色/GC2色/ほのお/つなみ）から、処理順タイムラインを導出する。
 * GCのキャスト色(真偽)は全員共通で、1つのGC真偽がそのGCの水雷/加速度/視線を全部決める。 */

export type MinState = Record<string, string>;
/** App 側の更新ヘルパのシグネチャ（id の値を value に置き換える）。 */
export type MinSet = (id: string, value: string) => void;

/** 既定値: 真偽は全て真。自分は水・GC1・早・視線（任意の初期値）。 */
export const INITIAL_MIN: MinState = {
  waterType: "mizu", // 自分の水雷タイプ（mizu/rai）
  waterGC: "1", // 自分が水雷を持つGC（1/2）。逆GCが加速度系。
  waterWhen: "haya", // 自分の水雷の処理早/遅（観測）
  shisen: "yes", // 加速度系GCでの自分: yes=視線 / no=無職
  gc1: "shin", // GC1 の色真偽
  gc2: "shin", // GC2 の色真偽
  honoo: "shin", // ほのお真偽
  tsunami: "shin", // つなみ真偽
  thunda: "shin", // サンダガ（マジックアウト記憶）
  blizza: "shin", // ブリザガ（マジックアウト記憶）
};

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
        className={`absolute top-1/2 size-5 -translate-y-1/2 rounded-full bg-white shadow transition-all ${
          oso ? "right-0.5" : "left-0.5"
        }`}
      />
    </button>
  );
}

/** デバフ画像アイコンの node。 */
const imgIcon = (src: string) => (
  <img src={src} alt="" className="h-5 w-auto rounded-[2px]" draggable={false} />
);

/** Lucide アイコン付きの2択トグル（加速度系の視線/無職など）。 */
function IconToggle({
  value,
  onChange,
  options,
}: {
  value: string;
  onChange: (v: string) => void;
  options: { value: string; label: string; node: React.ReactNode }[];
}) {
  return (
    <div className="flex shrink-0 gap-0.5">
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          onClick={() => onChange(o.value)}
          aria-label={o.label}
          className={`flex items-center gap-1 rounded-md border px-2 py-1 text-xs font-bold ${
            value === o.value
              ? "border-primary bg-primary text-primary-foreground"
              : "opacity-40"
          }`}
        >
          {o.node}
          <span>{o.label}</span>
        </button>
      ))}
    </div>
  );
}

/** セットアップのセル（ラベル上・トグル下）。2×2グリッド用。 */
function SetupCell({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-1 rounded-md border bg-card/40 px-2 py-1.5">
      <span className="text-[10px] font-semibold text-muted-foreground">{label}</span>
      {children}
    </div>
  );
}

/** 真偽トグル（タップで真↔偽。真=青 / 偽=赤）。 */
function TruthChip({
  label,
  value,
  onToggle,
  iconNode,
}: {
  label: string;
  value: string;
  onToggle: () => void;
  iconNode?: React.ReactNode;
}) {
  const shin = value === "shin";
  return (
    <button
      type="button"
      onClick={onToggle}
      aria-label={`${label} 真偽`}
      className="flex items-center gap-1.5 rounded-md border bg-card/40 px-2 py-1.5"
    >
      <span className="flex w-6 shrink-0 justify-center">{iconNode}</span>
      <span className="min-w-0 flex-1 truncate text-left text-[11px] font-bold text-foreground">
        {label}
      </span>
      <span
        className={`w-10 shrink-0 rounded-md px-2 py-0.5 text-center text-xs font-bold ${
          shin ? "bg-blue-600 text-white" : "bg-red-600 text-white"
        }`}
      >
        {shin ? "真" : "偽"}
      </span>
    </button>
  );
}

/** タイムライン1行（アイコン＋行動テキスト）。 */
function TimelineRow({ item }: { item: Item }) {
  return (
    <div className="flex items-center gap-2 rounded-md border bg-card/40 px-2 py-1.5">
      <span className="flex min-w-6 shrink-0 items-center justify-center gap-0.5">
        {item.icon ? (
          <img src={item.icon} alt="" className="h-5 w-auto rounded-[2px]" draggable={false} />
        ) : item.lucide === "zap" ? (
          <Zap className="size-5" />
        ) : item.lucide === "snow" ? (
          <Snowflake className="size-5" />
        ) : item.lucide === "users" ? (
          <Users className="size-5" />
        ) : null}
        {item.extraIcon && (
          <img src={item.extraIcon} alt="" className="h-5 w-auto rounded-[2px]" draggable={false} />
        )}
      </span>
      <span className="min-w-0 flex-1 truncate text-left text-xs font-bold text-foreground">
        {item.text || "—"}
      </span>
    </div>
  );
}

export function MinimumMode({
  value,
  set,
  view = "full",
}: {
  value: MinState;
  set: MinSet;
  /**
   * 表示範囲。
   *  - "full"（既定）: 入力（真偽・役割・サンダガ/ブリザガ記憶）＋導出タイムライン。
   *  - "input": 入力セクションのみ（導出タイムラインを出さない）。
   *  - "timeline": 導出タイムラインのみ（入力を出さない）。
   * 操作プレイの横並びレイアウトで、入力を右の細い列・タイムラインを下部全幅に分割するために使う。
   * 他の呼び出し元（カンペ練習・セッション・通常ミニマムモード）は既定 "full" で従来どおり。
   */
  view?: "full" | "input" | "timeline";
}) {
  const showInput = view === "full" || view === "input";
  const showTimeline = view === "full" || view === "timeline";
  const v = (k: string) => value[k] ?? INITIAL_MIN[k] ?? "";

  const waterType = v("waterType"); // mizu | rai
  const waterGC = v("waterGC"); // "1" | "2"
  const waterWhen = v("waterWhen"); // haya | oso
  const shisen = v("shisen"); // yes | no
  const gc1 = v("gc1");
  const gc2 = v("gc2");
  const honoo = v("honoo");
  const tsunami = v("tsunami");

  // 処理順タイムラインを導出（共有 pure モジュール）。
  const sorted = buildTimeline(value);

  // 連続する同 group をまとめてグルーピング。
  const groups: { g: number; items: Item[] }[] = [];
  for (const it of sorted) {
    const last = groups[groups.length - 1];
    if (last && last.g === it.group) last.items.push(it);
    else groups.push({ g: it.group, items: [it] });
  }

  const toggleTruth = (id: string) => set(id, v(id) === "shin" ? "gi" : "shin");

  return (
    <div className="flex flex-col gap-2">
      {showInput && (
        <>
      {/* 1) 真偽判定（4トグル・タップで真↔偽） */}
      <div className="grid grid-cols-2 gap-1.5">
        <TruthChip label="GC1" value={gc1} onToggle={() => toggleTruth("gc1")} iconNode={<Swords className="size-5" />} />
        <TruthChip label="GC2" value={gc2} onToggle={() => toggleTruth("gc2")} iconNode={<Swords className="size-5" />} />
        <TruthChip label="ほのお" value={honoo} onToggle={() => toggleTruth("honoo")} iconNode={imgIcon(DEBUFF_ICON.honoo)} />
        <TruthChip label="つなみ" value={tsunami} onToggle={() => toggleTruth("tsunami")} iconNode={imgIcon(DEBUFF_ICON.tsunami)} />
      </div>

      <div className="border-t" />

      {/* 2) 役割判定（個別入力・役割/タイミング）2×2グリッド */}
      <div className="grid grid-cols-2 gap-1.5">
        <SetupCell label="水雷">
          <SelectToggle
            value={waterType}
            onChange={(x) => set("waterType", x)}
            options={[
              { value: "mizu", label: "水", icon: DEBUFF_ICON.mizu },
              { value: "rai", label: "雷", icon: DEBUFF_ICON.rai },
            ]}
          />
        </SetupCell>
        <SetupCell label="水雷GC">
          <SelectToggle
            value={waterGC}
            onChange={(x) => set("waterGC", x)}
            options={[
              { value: "1", label: "GC1" },
              { value: "2", label: "GC2" },
            ]}
          />
        </SetupCell>
        <SetupCell label="水雷早遅">
          <EarlyLate value={waterWhen} onChange={(x) => set("waterWhen", x)} />
        </SetupCell>
        <SetupCell label="加速度系">
          <IconToggle
            value={shisen}
            onChange={(x) => set("shisen", x)}
            options={[
              {
                value: "yes",
                label: "視線",
                node: (
                  <img
                    src={DEBUFF_ICON.juso}
                    alt=""
                    className="h-4 w-auto rounded-[2px]"
                    draggable={false}
                  />
                ),
              },
              { value: "no", label: "無職", node: <UserX className="size-4" /> },
            ]}
          />
        </SetupCell>
      </div>

      <div className="border-t" />

      {/* 3) マジックアウト記憶（水雷/加速度の下・処理タイムラインの上） */}
      <div className="flex flex-col gap-1.5 rounded-lg border-2 border-primary/40 bg-primary/5 p-1.5">
        <TruthChip label="サンダガ" value={v("thunda")} onToggle={() => toggleTruth("thunda")} iconNode={<Zap className="size-5" />} />
        <TruthChip label="ブリザガ" value={v("blizza")} onToggle={() => toggleTruth("blizza")} iconNode={<Snowflake className="size-5" />} />
      </div>
        </>
      )}

      {view === "full" && <div className="border-t" />}

      {showTimeline && (
      /* 4) 導出タイムライン（処理順ソート＋ブロック） */
      <div className="flex flex-col gap-1.5">
        {groups.map((grp, gi) => {
          // 水雷・加速度（早=1/遅=4）は中身1つでも常にブロック枠。単独処理（視線/ほのお/つなみ）は枠なし。
          const block = grp.g === 1 || grp.g === 4;
          if (!block) return <TimelineRow key={`g${gi}`} item={grp.items[0]} />;
          return (
            <div
              key={`g${gi}`}
              className="flex flex-col gap-1.5 rounded-lg border-2 border-primary/40 bg-primary/5 p-1.5"
            >
              {grp.items.map((it) => (
                <TimelineRow key={it.key} item={it} />
              ))}
            </div>
          );
        })}
      </div>
      )}

    </div>
  );
}
