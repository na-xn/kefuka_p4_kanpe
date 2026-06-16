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

const HAYA = {
  value: "haya",
  label: "早",
  onClass:
    "data-[state=on]:bg-amber-500 data-[state=on]:text-black data-[state=on]:border-amber-500",
};
const OSO = {
  value: "oso",
  label: "遅",
  onClass:
    "data-[state=on]:bg-orange-700 data-[state=on]:text-white data-[state=on]:border-orange-700",
};
const NONE_OPT = { value: "none", label: "なし" };
// GC1 は加速度なしもあり得る（呪詛のみ）。GC2 は GC1雷水の裏で必ず加速度がつくので 早/遅 のみ。
const ACCEL_OPTIONS_GC1 = [NONE_OPT, HAYA, OSO];
const ACCEL_OPTIONS_GC2 = [HAYA, OSO];
// 呪詛は「発生源」かどうか＝なし/早/遅（見る見ないは全員が対処するので別）。
const JUSO_OPTIONS = [NONE_OPT, HAYA, OSO];

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
  const role = get(roleKey); // "rai" | "mizu" | "nashi" | ""
  const truth = get(`gc${suffix}_role`) as Choice; // GC真偽（見出し）
  const accelVal = get(`gc${suffix}_accel`);
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

  // 実効的に「なし」側か（加速度・呪詛を出すか）
  const isNashi = isGc2 ? gc2Side === "nashi" : role === "nashi";

  return (
    <>
      {/* 担当 */}
      {isGc2 && gc2Side === "wait" ? (
        <div className="rounded-md border border-dashed px-2 py-1.5 text-[11px] text-muted-foreground">
          GC1 の担当を先に入力してください
        </div>
      ) : (
        <div className="rounded-md border bg-card px-2 py-1.5">
          <div className="flex items-center justify-between gap-2">
            <span className="min-w-0 flex-1 text-xs font-semibold">担当</span>
            {isGc2 && gc2Side === "nashi" ? (
              <span className="shrink-0 rounded bg-slate-500 px-2 py-0.5 text-xs font-bold text-white">
                なし（自動）
              </span>
            ) : isGc2 && gc2Side === "raimizu" ? (
              <RoleToggle
                role={{ left: { value: "rai", label: "雷" }, right: { value: "mizu", label: "水" } }}
                value={role}
                onChange={(v) => set(roleKey, v)}
              />
            ) : (
              <RoleToggle
                role={{
                  left: { value: "rai", label: "雷" },
                  mid: { value: "mizu", label: "水" },
                  right: { value: "nashi", label: "なし" },
                }}
                value={role}
                onChange={(v) => set(roleKey, v)}
              />
            )}
          </div>
          <ActionBar text={raiMizuAction(role, truth)} />
        </div>
      )}

      {/* 担当=なし のときだけ 加速度・呪詛 */}
      {isNashi && (
        <>
          <div className="rounded-md border bg-card px-2 py-1.5">
            <div className="flex items-center justify-between gap-2">
              <span className="min-w-0 flex-1 text-xs font-semibold">加速度爆弾</span>
              <SelectToggle
                value={accelVal}
                onChange={(v) => set(`gc${suffix}_accel`, v)}
                options={suffix === "2" ? ACCEL_OPTIONS_GC2 : ACCEL_OPTIONS_GC1}
              />
            </div>
          </div>
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
  return (
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
    <div className="rounded-lg border bg-card/40 p-2">
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
