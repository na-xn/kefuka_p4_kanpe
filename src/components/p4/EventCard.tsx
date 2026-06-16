import { useMemo } from "react";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { ActionBar, TruthToggle, RoleToggle } from "@/components/p4/primitives";
import type { Choice, Judge, EventDef } from "@/p4/types";

/** 1判定行（汎用） */
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

/** ⑤ GC3 の担当選択のみ（判定入力フェーズ用。無の氾濫は処理フェーズで入力） */
function Gc3RolePicker({
  get,
  set,
}: {
  get: (k: string) => string;
  set: (k: string, v: string) => void;
}) {
  const roleKey = "gc3_role__role";
  const role = get(roleKey);
  return (
    <div className="rounded-md border bg-card px-2 py-1.5">
      <div className="flex items-center justify-between gap-2">
        <span className="min-w-0 flex-1 text-xs font-semibold">担当</span>
        <ToggleGroup
          type="single"
          value={role}
          onValueChange={(v) => set(roleKey, v)}
          variant="outline"
          size="sm"
          className="shrink-0"
        >
          <ToggleGroupItem value="aragan" aria-label="アラガンフィールド">
            アラガン
          </ToggleGroupItem>
          <ToggleGroupItem value="shi" aria-label="死の超越">
            死の超越
          </ToggleGroupItem>
        </ToggleGroup>
      </div>
    </div>
  );
}

/** ⑤ グランドクロス3回目（生者の傷） */
function Gc3Body({
  get,
  set,
}: {
  get: (k: string) => string;
  set: (k: string, v: string) => void;
}) {
  const roleKey = "gc3_role__role";
  const role = get(roleKey); // "aragan" | "shi" | ""
  const mu = get("gc3_mu") as Choice; // 無の氾濫 真/偽

  const result = useMemo(() => {
    if (!role || !mu) return null;
    if (role === "aragan") {
      // 生きる＝ダメージを受けない
      return mu === "shin"
        ? "🎯 異色に当たる（生きる）"
        : "🎯 同色に当たる（生きる）";
    }
    // 死の超越: 瀕死になる＝ダメージを受ける
    return mu === "shin"
      ? "🎯 同色に当たる（瀕死/死を回避）"
      : "🎯 異色に当たる（瀕死/死を回避）";
  }, [role, mu]);

  return (
    <>
      <div className="rounded-md border bg-card px-2 py-1.5">
        <div className="flex items-center justify-between gap-2">
          <span className="min-w-0 flex-1 text-xs font-semibold">担当</span>
          <ToggleGroup
            type="single"
            value={role}
            onValueChange={(v) => set(roleKey, v)}
            variant="outline"
            size="sm"
            className="shrink-0"
          >
            <ToggleGroupItem value="aragan" aria-label="アラガンフィールド">
              アラガン
            </ToggleGroupItem>
            <ToggleGroupItem value="shi" aria-label="死の超越">
              死の超越
            </ToggleGroupItem>
          </ToggleGroup>
        </div>
      </div>
      <div className="rounded-md border bg-card px-2 py-1.5">
        <div className="flex items-center justify-between gap-2">
          <span className="min-w-0 flex-1 text-xs font-semibold">無の氾濫</span>
          <TruthToggle value={mu} onChange={(v) => set("gc3_mu", v)} />
        </div>
        <ActionBar text={result} />
      </div>
    </>
  );
}

/** ⑥ マジックチャージ → マジックアウト（XNOR 解決） */
function MagicBody({
  get,
  set,
}: {
  get: (k: string) => string;
  set: (k: string, v: string) => void;
}) {
  const thunda = get("magic_thunda") as Choice; // 記憶
  const blizza = get("magic_blizza") as Choice; // 記憶
  const out = get("magic_out") as Choice; // マジックアウト

  /** 記憶 と アウト が一致(XNOR)なら本当 / 不一致なら嘘 */
  const finalTruth = (memory: Choice): "shin" | "gi" | null => {
    if (!memory || !out) return null;
    return memory === out ? "shin" : "gi";
  };

  const thundaFinal = finalTruth(thunda);
  const blizzaFinal = finalTruth(blizza);

  const thundaAction =
    thundaFinal === null
      ? null
      : thundaFinal === "shin"
      ? "⚡ 直線を踏まない"
      : "⚡ 直線を踏む";
  const blizzaAction =
    blizzaFinal === null
      ? null
      : blizzaFinal === "shin"
      ? "❄ 扇を踏まない"
      : "❄ 扇を踏む";

  const memLabel = (c: Choice) => (c === "shin" ? "真" : c === "gi" ? "偽" : "—");
  const finLabel = (f: "shin" | "gi" | null) =>
    f === "shin" ? "本当" : f === "gi" ? "嘘" : "—";

  return (
    <>
      <div className="rounded-md border bg-card px-2 py-1.5">
        <div className="flex items-center justify-between gap-2">
          <span className="min-w-0 flex-1 text-xs font-semibold">⚡ もりもりサンダガ（記憶）</span>
          <TruthToggle value={thunda} onChange={(v) => set("magic_thunda", v)} />
        </div>
      </div>
      <div className="rounded-md border bg-card px-2 py-1.5">
        <div className="flex items-center justify-between gap-2">
          <span className="min-w-0 flex-1 text-xs font-semibold">❄ ひろげるブリザガ（記憶）</span>
          <TruthToggle value={blizza} onChange={(v) => set("magic_blizza", v)} />
        </div>
      </div>
      <div className="rounded-md border bg-card px-2 py-1.5">
        <div className="flex items-center justify-between gap-2">
          <span className="min-w-0 flex-1 text-xs font-semibold">🎭 マジックアウト</span>
          <TruthToggle value={out} onChange={(v) => set("magic_out", v)} />
        </div>
        {/* 記憶値・最終結果のサマリ（マジックアウト後に表示） */}
        {out && (
          <div className="mt-1 grid grid-cols-2 gap-1 text-[10px] text-muted-foreground">
            <span>
              ⚡記憶 {memLabel(thunda)} → 結果{" "}
              <b className="text-foreground">{finLabel(thundaFinal)}</b>
            </span>
            <span>
              ❄記憶 {memLabel(blizza)} → 結果{" "}
              <b className="text-foreground">{finLabel(blizzaFinal)}</b>
            </span>
          </div>
        )}
        <ActionBar text={thundaAction} />
        <ActionBar text={blizzaAction} />
      </div>
    </>
  );
}

/** イベントカード */
export function EventCard({
  index,
  event,
  get,
  set,
  inputPhase = false,
}: {
  index: number;
  event: EventDef;
  get: (k: string) => string;
  set: (k: string, v: string) => void;
  /** 判定入力フェーズか（GC3 を担当選択のみに絞る） */
  inputPhase?: boolean;
}) {
  return (
    <div className="rounded-lg border bg-card/40 p-2">
      <div className="mb-1.5 flex items-center gap-1.5">
        <span className="flex size-5 shrink-0 items-center justify-center rounded-full bg-primary text-[11px] font-bold text-primary-foreground">
          {index}
        </span>
        <span className="truncate text-xs font-bold">{event.name}</span>
      </div>
      <div className="flex flex-col gap-1.5">
        {event.id === "gc3" ? (
          inputPhase ? (
            <Gc3RolePicker get={get} set={set} />
          ) : (
            <Gc3Body get={get} set={set} />
          )
        ) : event.id === "magic" ? (
          <MagicBody get={get} set={set} />
        ) : (
          event.judges.map((j) => <JudgeRow key={j.id} judge={j} get={get} set={set} />)
        )}
      </div>
    </div>
  );
}
