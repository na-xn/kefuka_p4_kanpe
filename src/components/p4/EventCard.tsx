import { useEffect } from "react";
import { ActionBar, TruthToggle, RoleToggle, SelectToggle } from "@/components/p4/primitives";
import { seishi, raiMizuAction, tsunamiHonooAction } from "@/p4/logic";
import { DEBUFF_ICON, raiMizuIcon, chaosIcon } from "@/p4/icons";
import type { Choice, Judge, EventDef } from "@/p4/types";

/** イベント見出しに置く「真偽トグル」の状態キー（GC・つなみ/ほのお）。GC3は真偽不要。 */
const HEADER_TRUTH_KEY: Record<string, string> = {
  gc1: "gc1_role",
  gc2: "gc2_role",
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

const ICON = DEBUFF_ICON;

// GC 担当の3択（雷/水/加速度）。加速度=役割キーは "nashi"、表示valueは "accel"。
const RAI_OPT = {
  value: "rai",
  label: "雷",
  icon: ICON.rai,
  onClass:
    "data-[state=on]:bg-purple-600 data-[state=on]:text-white data-[state=on]:border-purple-600",
};
const MIZU_OPT = {
  value: "mizu",
  label: "水",
  icon: ICON.mizu,
  onClass:
    "data-[state=on]:bg-sky-400 data-[state=on]:text-black data-[state=on]:border-sky-400",
};
const ACCEL_OPT = {
  value: "accel",
  label: "加速度",
  icon: ICON.accel,
  onClass:
    "data-[state=on]:bg-amber-500 data-[state=on]:text-black data-[state=on]:border-amber-500",
};
// 早/遅の汎用（つなみ・ほのおの処理タイミング・GC処理用）
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
    icon: ICON.juso,
    onClass:
      "data-[state=on]:bg-fuchsia-600 data-[state=on]:text-white data-[state=on]:border-fuchsia-600",
  },
  { value: "no", label: "無" },
];

/** ①③ GC1 / GC2 入力カード。真偽は見出しにあるので body には担当・処理早遅・呪詛のみ。 */
function GcInputCard({
  suffix,
  get,
  set,
  activeFieldKey = null,
}: {
  /** "1" | "2" */
  suffix: string;
  get: (k: string) => string;
  set: (k: string, v: string) => void;
  activeFieldKey?: string | null;
}) {
  const roleKey = `gc${suffix}_role__role`;
  const accelKey = `gc${suffix}_accel`;
  const whenKey = `gc${suffix}_when`;
  const role = get(roleKey); // "rai" | "mizu" | "nashi" | ""
  const truth = get(`gc${suffix}_role`) as Choice; // GC真偽（見出し）
  const accelVal = get(accelKey); // "haya" | "oso" | ""
  const whenVal = get(whenKey); // 散開/頭割りの処理タイミング（早/遅）
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

  const isNashi = role === "nashi"; // 加速度担当
  const isRaiMizu = role === "rai" || role === "mizu"; // 水雷持ち
  const roleDecided = isNashi || isRaiMizu; // 担当が決まったか

  // 担当トグル: 表示value（雷/水/加速度）。
  const roleValue = role === "rai" ? "rai" : role === "mizu" ? "mizu" : role === "nashi" ? "accel" : "";
  const setRole = (v: string) => {
    if (v === "rai" || v === "mizu") {
      set(roleKey, v);
      if (accelVal) set(accelKey, "");
    } else {
      // "accel"
      set(roleKey, "nashi");
      if (whenVal) set(whenKey, "");
    }
  };

  // GC1=3択 / GC2なし側=雷水2択 / GC2雷水側=担当トグル非表示（加速度固定）
  const roleOptions =
    isGc2 && gc2Side === "raimizu" ? [RAI_OPT, MIZU_OPT] : [RAI_OPT, MIZU_OPT, ACCEL_OPT];
  // GC2の加速度固定側は担当トグルを出さず静的ラベル表示
  const showRoleToggle = !(isGc2 && gc2Side === "nashi");

  // 早/遅: 担当=雷水→gcN_when / 担当=加速度→gcN_accel
  const earlyKey = isNashi ? accelKey : whenKey;
  const earlyVal = isNashi ? accelVal : whenVal;

  return (
    <>
      {/* 担当（雷/水/加速度） */}
      {isGc2 && gc2Side === "wait" ? (
        <div className="rounded-md border border-dashed px-2 py-1.5 text-[11px] text-muted-foreground">
          GC1 の担当を先に入力してください
        </div>
      ) : (
        <div className="rounded-md border bg-card px-2 py-1.5">
          <div className="flex items-center justify-between gap-2">
            <span className="min-w-0 flex-1 text-xs font-semibold">担当</span>
            {showRoleToggle ? (
              <SelectToggle
                value={roleValue}
                onChange={setRole}
                options={roleOptions}
                active={activeFieldKey === roleKey}
              />
            ) : (
              <span className="shrink-0 rounded bg-amber-500 px-2 py-0.5 text-xs font-bold text-black">
                加速度
              </span>
            )}
          </div>
          <ActionBar text={raiMizuAction(role, truth)} icon={raiMizuIcon(role)} />
        </div>
      )}

      {/* 処理（早/遅）: 担当が決まったら常に表示。雷水→when / 加速度→accel */}
      {roleDecided && (
        <div className="rounded-md border bg-card px-2 py-1.5">
          <div className="flex items-center justify-between gap-2">
            <span className="min-w-0 flex-1 text-xs font-semibold">処理（早/遅）</span>
            <SelectToggle
              value={earlyVal}
              onChange={(v) => set(earlyKey, v)}
              options={WHEN_OPTIONS}
              active={activeFieldKey === `gc${suffix}_early`}
            />
          </div>
        </div>
      )}

      {/* 担当=加速度 のときだけ 呪詛（発生源） */}
      {isNashi && (
        <div className="rounded-md border bg-card px-2 py-1.5">
          <div className="flex items-center justify-between gap-2">
            <span className="min-w-0 flex-1 text-xs font-semibold">呪詛（発生源）</span>
            <SelectToggle
              value={jusoVal}
              onChange={(v) => set(`gc${suffix}_juso`, v)}
              options={JUSO_OPTIONS}
              active={activeFieldKey === `gc${suffix}_juso`}
            />
          </div>
        </div>
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
  activeFieldKey = null,
}: {
  suffix: string;
  get: (k: string) => string;
  set: (k: string, v: string) => void;
  activeFieldKey?: string | null;
}) {
  const roleKey = `wave${suffix}_type__role`;
  const role = get(roleKey);
  const truth = get(`wave${suffix}_type`) as Choice;
  const whenKey = `wave${suffix}_when`;
  const isWave2 = suffix === "2";

  // 2回目の種類は1回目と排他（1回目=ほのお→2回目=つなみ、逆も）。
  const wave1Role = get("wave1_type__role");
  const autoType = isWave2
    ? wave1Role === "honoo"
      ? "tsunami"
      : wave1Role === "tsunami"
      ? "honoo"
      : ""
    : "";
  useEffect(() => {
    if (!isWave2) return;
    if (autoType && role !== autoType) set(roleKey, autoType);
    if (!autoType && role) set(roleKey, "");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isWave2, autoType, role]);

  // 早/遅は種類で確定（ほのお=早 / つなみ=遅）。waveN_when を種類から自動設定し、入力欄は持たない。
  const autoWhen = role === "honoo" ? "haya" : role === "tsunami" ? "oso" : "";
  const whenVal = get(whenKey);
  useEffect(() => {
    if (autoWhen && whenVal !== autoWhen) set(whenKey, autoWhen);
    if (!autoWhen && whenVal) set(whenKey, "");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoWhen, whenVal]);

  return (
    <div className="rounded-md border bg-card px-2 py-1.5">
      <div className="flex items-center justify-between gap-2">
        <span className="min-w-0 flex-1 text-xs font-semibold">種類</span>
        {isWave2 ? (
          autoType ? (
            <span className="flex shrink-0 items-center gap-1 rounded bg-slate-500 px-2 py-0.5 text-xs font-bold text-white">
              <img
                src={autoType === "honoo" ? ICON.honoo : ICON.tsunami}
                alt=""
                className="h-5 w-auto rounded-[2px]"
                draggable={false}
              />
              {autoType === "honoo" ? "炎（早）" : "水（遅）"}（自動）
            </span>
          ) : (
            <span className="shrink-0 text-[10px] text-muted-foreground">
              1回目の種類を先に選択
            </span>
          )
        ) : (
          <RoleToggle
            role={{
              left: { value: "honoo", label: "炎(ほのお)", icon: ICON.honoo },
              right: { value: "tsunami", label: "水(つなみ)", icon: ICON.tsunami },
            }}
            value={role}
            onChange={(v) => set(roleKey, v)}
            active={activeFieldKey === roleKey}
          />
        )}
      </div>
      <ActionBar text={tsunamiHonooAction(role, truth)} icon={chaosIcon(role)} />
    </div>
  );
}

/** ⑤ GC3 の担当選択（真偽は見出し）。 */
function Gc3RolePicker({
  get,
  set,
  activeFieldKey = null,
}: {
  get: (k: string) => string;
  set: (k: string, v: string) => void;
  activeFieldKey?: string | null;
}) {
  const roleKey = "gc3_role__role";
  const role = get(roleKey);
  return (
    <div className="rounded-md border bg-card px-2 py-1.5">
      <div className="flex items-center justify-between gap-2">
        <span className="min-w-0 flex-1 text-xs font-semibold">担当</span>
        <RoleToggle
          role={{
            left: { value: "aragan", label: "アラガン", icon: ICON.aragan },
            right: { value: "shi", label: "死の超越", icon: ICON.shi },
          }}
          value={role}
          onChange={(v) => set(roleKey, v)}
          active={activeFieldKey === roleKey}
        />
      </div>
      <ActionBar text={seishi(role)} />
    </div>
  );
}

/** イベントカード（判定入力フェーズ） */
export function EventCard({
  index,
  event,
  get,
  set,
  activeFieldKey = null,
}: {
  index: number;
  event: EventDef;
  get: (k: string) => string;
  set: (k: string, v: string) => void;
  /** キー入力のカーソル位置（このキーの欄を強調） */
  activeFieldKey?: string | null;
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
            active={activeFieldKey === truthKey}
          />
        )}
      </div>

      <div className="flex flex-col gap-1.5">
        {event.id === "gc1" || event.id === "gc2" ? (
          <GcInputCard
            suffix={event.id === "gc1" ? "1" : "2"}
            get={get}
            set={set}
            activeFieldKey={activeFieldKey}
          />
        ) : event.id === "wave1" || event.id === "wave2" ? (
          <TsunamiInputCard
            suffix={event.id === "wave1" ? "1" : "2"}
            get={get}
            set={set}
            activeFieldKey={activeFieldKey}
          />
        ) : event.id === "gc3" ? (
          <Gc3RolePicker get={get} set={set} activeFieldKey={activeFieldKey} />
        ) : (
          event.judges.map((j) => <JudgeRow key={j.id} judge={j} get={get} set={set} />)
        )}
      </div>
    </div>
  );
}
