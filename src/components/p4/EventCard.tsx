import { useEffect } from "react";
import { ActionBar, TruthToggle, RoleToggle, SelectToggle } from "@/components/p4/primitives";
import { seishi, raiMizuAction, tsunamiHonooAction } from "@/p4/logic";
import type { Choice, Judge, EventDef } from "@/p4/types";

/** イベント見出しに置く「真偽トグル」の状態キー（GC・つなみ/ほのお・GC3）。 */
const HEADER_TRUTH_KEY: Record<string, string> = {
  gc1: "gc1_role",
  gc2: "gc2_role",
  gc3: "gc3_truth",
  wave1: "wave1_type",
  wave2: "wave2_type",
};

/** 1判定行（汎用・フォールバック用） */
function JudgeRow({
  judge,
  get,
  set,
}: {
  judge: Judge;
  get: (k: string) => string;
  set: (k: string, v: string) => void;
}) {
  const truth = (judge.truth === false ? "" : get(judge.id)) as Choice;
  const roleKey = `${judge.id}__role`;
  const role = judge.role ? get(roleKey) : "";
  const action = judge.resolve({ truth, role });

  return (
    <div className="rounded-md border bg-card px-2 py-1.5">
      <div className="flex items-center justify-between gap-2">
        <span className="min-w-0 flex-1 text-xs font-semibold">{judge.label}</span>
        <div className="flex shrink-0 items-center gap-1">
          {judge.role && (
            <RoleToggle role={judge.role} value={role} onChange={(v) => set(roleKey, v)} />
          )}
          {judge.truth !== false && (
            <TruthToggle value={truth} onChange={(v) => set(judge.id, v)} />
          )}
        </div>
      </div>
      <ActionBar text={action} />
    </div>
  );
}

// 担当に加速度(早/遅)を統合した選択肢。なし＝加速度持ち（早/遅）なので、雷/水/加早/加遅 の4択。
const RAI_OPT = {
  value: "rai",
  label: "雷",
  onClass:
    "data-[state=on]:bg-purple-600 data-[state=on]:text-white data-[state=on]:border-purple-600",
};
const MIZU_OPT = {
  value: "mizu",
  label: "水",
  onClass:
    "data-[state=on]:bg-sky-400 data-[state=on]:text-black data-[state=on]:border-sky-400",
};
const ACC_HAYA = {
  value: "haya",
  label: "加早",
  onClass:
    "data-[state=on]:bg-amber-500 data-[state=on]:text-black data-[state=on]:border-amber-500",
};
const ACC_OSO = {
  value: "oso",
  label: "加遅",
  onClass:
    "data-[state=on]:bg-orange-700 data-[state=on]:text-white data-[state=on]:border-orange-700",
};
// 早/遅の汎用（つなみ・ほのおの処理タイミング用）
const WHEN_OPTIONS = [
  {
    value: "haya",
    label: "早",
    onClass:
      "data-[state=on]:bg-amber-500 data-[state=on]:text-black data-[state=on]:border-amber-500",
  },
  {
    value: "oso",
    label: "遅",
    onClass:
      "data-[state=on]:bg-orange-700 data-[state=on]:text-white data-[state=on]:border-orange-700",
  },
];
// 呪詛は「発生源」かどうかの有/無のみ（早/遅は GC1=早・GC2=遅 で確定。見る見ないは全員）。
const JUSO_OPTIONS = [
  {
    value: "yes",
    label: "有",
    onClass:
      "data-[state=on]:bg-fuchsia-600 data-[state=on]:text-white data-[state=on]:border-fuchsia-600",
  },
  { value: "no", label: "無" },
];

/** ①③ GC1 / GC2 入力カード。真偽は見出しにあるので body には担当・加速度・呪詛のみ。 */
function GcInputCard({
  suffix,
  get,
  set,
}: {
  /** "1" | "2" */
  suffix: string;
  get: (k: string) => string;
  set: (k: string, v: string) => void;
}) {
  const roleKey = `gc${suffix}_role__role`;
  const accelKey = `gc${suffix}_accel`;
  const role = get(roleKey); // "rai" | "mizu" | "nashi" | ""
  const truth = get(`gc${suffix}_role`) as Choice; // GC真偽（見出し）
  const accelVal = get(accelKey); // "haya" | "oso" | ""
  const jusoVal = get(`gc${suffix}_juso`);
  const gc1Role = get("gc1_role__role");

  // GC2 は GC1 の担当に応じて自動で側が決まる（雷/水↔なしの排他）
  const isGc2 = suffix === "2";
  const gc2Side: "wait" | "nashi" | "raimizu" | null = !isGc2
    ? null
    : !gc1Role
    ? "wait"
    : gc1Role === "nashi"
    ? "raimizu"
    : "nashi";

  // GC2 の担当キーを GC1 に同期（なし側→nashi固定 / 雷水側→nashiならクリア）
  useEffect(() => {
    if (!isGc2) return;
    if (gc2Side === "nashi" && role !== "nashi") set(roleKey, "nashi");
    if (gc2Side === "raimizu" && role === "nashi") set(roleKey, "");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isGc2, gc2Side, role]);

  const isNashi = isGc2 ? gc2Side === "nashi" : role === "nashi";

  // 担当＋加速度を統合した1つの値（雷/水/加早/加遅）
  const combined =
    role === "rai" || role === "mizu" ? role : role === "nashi" ? accelVal : "";
  const setCombined = (v: string) => {
    if (v === "rai" || v === "mizu") {
      set(roleKey, v);
      if (accelVal) set(accelKey, "");
    } else {
      set(roleKey, "nashi");
      set(accelKey, v); // haya | oso
    }
  };

  // 表示する選択肢: GC1=4択 / GC2なし側=加早遅 / GC2雷水側=雷水
  const combinedOptions =
    isGc2 && gc2Side === "nashi"
      ? [ACC_HAYA, ACC_OSO]
      : isGc2 && gc2Side === "raimizu"
      ? [RAI_OPT, MIZU_OPT]
      : [RAI_OPT, MIZU_OPT, ACC_HAYA, ACC_OSO];

  return (
    <>
      {/* 担当（＋加速度早遅を統合） */}
      {isGc2 && gc2Side === "wait" ? (
        <div className="rounded-md border border-dashed px-2 py-1.5 text-[11px] text-muted-foreground">
          GC1 の担当を先に入力してください
        </div>
      ) : (
        <div className="rounded-md border bg-card px-2 py-1.5">
          <div className="flex items-center justify-between gap-2">
            <span className="min-w-0 flex-1 text-xs font-semibold">担当 / 加速度</span>
            <SelectToggle value={combined} onChange={setCombined} options={combinedOptions} />
          </div>
          <ActionBar text={raiMizuAction(role, truth)} />
        </div>
      )}

      {/* 担当=なし のときだけ 呪詛（発生源） */}
      {isNashi && (
        <>
          <div className="rounded-md border bg-card px-2 py-1.5">
            <div className="flex items-center justify-between gap-2">
              <span className="min-w-0 flex-1 text-xs font-semibold">呪詛（発生源）</span>
              <SelectToggle
                value={jusoVal}
                onChange={(v) => set(`gc${suffix}_juso`, v)}
                options={JUSO_OPTIONS}
              />
            </div>
          </div>
        </>
      )}

      {isGc2 && (
        <p className="px-0.5 text-[10px] text-muted-foreground">
          ※GC2の担当はGC1と排他（自動で出し分け）
        </p>
      )}
    </>
  );
}

/** ②④ つなみ / ほのお 入力カード（種類のみ。真偽は見出し）。 */
function TsunamiInputCard({
  suffix,
  get,
  set,
}: {
  suffix: string;
  get: (k: string) => string;
  set: (k: string, v: string) => void;
}) {
  const roleKey = `wave${suffix}_type__role`;
  const role = get(roleKey);
  const truth = get(`wave${suffix}_type`) as Choice;
  const whenVal = get(`wave${suffix}_when`); // haya | oso（処理の早/遅）
  return (
    <>
    <div className="rounded-md border bg-card px-2 py-1.5">
      <div className="flex items-center justify-between gap-2">
        <span className="min-w-0 flex-1 text-xs font-semibold">種類</span>
        <RoleToggle
          role={{
            left: { value: "honoo", label: "炎(ほのお)" },
            right: { value: "tsunami", label: "水(つなみ)" },
          }}
          value={role}
          onChange={(v) => set(roleKey, v)}
        />
      </div>
      <ActionBar text={tsunamiHonooAction(role, truth)} />
    </div>
    <div className="rounded-md border bg-card px-2 py-1.5">
      <div className="flex items-center justify-between gap-2">
        <span className="min-w-0 flex-1 text-xs font-semibold">処理（早/遅）</span>
        <SelectToggle
          value={whenVal}
          onChange={(v) => set(`wave${suffix}_when`, v)}
          options={WHEN_OPTIONS}
        />
      </div>
    </div>
    </>
  );
}

/** ⑤ GC3 の担当選択（真偽は見出し）。 */
function Gc3RolePicker({
  get,
  set,
}: {
  get: (k: string) => string;
  set: (k: string, v: string) => void;
}) {
  const roleKey = "gc3_role__role";
  const role = get(roleKey);
  const truth = get("gc3_truth") as Choice;
  return (
    <div className="rounded-md border bg-card px-2 py-1.5">
      <div className="flex items-center justify-between gap-2">
        <span className="min-w-0 flex-1 text-xs font-semibold">担当</span>
        <RoleToggle
          role={{
            left: { value: "aragan", label: "アラガン" },
            right: { value: "shi", label: "死の超越" },
          }}
          value={role}
          onChange={(v) => set(roleKey, v)}
        />
      </div>
      <ActionBar text={seishi(role, truth)} />
    </div>
  );
}

/** イベントカード（判定入力フェーズ） */
export function EventCard({
  index,
  event,
  get,
  set,
}: {
  index: number;
  event: EventDef;
  get: (k: string) => string;
  set: (k: string, v: string) => void;
}) {
  const truthKey = HEADER_TRUTH_KEY[event.id];
  return (
    <div className="rounded-lg border bg-card/40 p-2" role="group" aria-label={event.name}>
      {/* 見出し（番号＋名称＋真偽トグル） */}
      <div className="mb-1.5 flex items-center justify-between gap-1.5">
        <div className="flex min-w-0 items-center gap-1.5">
          <span className="flex size-5 shrink-0 items-center justify-center rounded-full bg-primary text-[11px] font-bold text-primary-foreground">
            {index}
          </span>
          <span className="truncate text-xs font-bold">{event.name}</span>
        </div>
        {truthKey && (
          <TruthToggle
            value={get(truthKey) as Choice}
            onChange={(v) => set(truthKey, v)}
          />
        )}
      </div>

      <div className="flex flex-col gap-1.5">
        {event.id === "gc1" || event.id === "gc2" ? (
          <GcInputCard suffix={event.id === "gc1" ? "1" : "2"} get={get} set={set} />
        ) : event.id === "wave1" || event.id === "wave2" ? (
          <TsunamiInputCard suffix={event.id === "wave1" ? "1" : "2"} get={get} set={set} />
        ) : event.id === "gc3" ? (
          <Gc3RolePicker get={get} set={set} />
        ) : (
          event.judges.map((j) => <JudgeRow key={j.id} judge={j} get={get} set={set} />)
        )}
      </div>
    </div>
  );
}
