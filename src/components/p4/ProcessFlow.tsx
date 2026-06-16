import { useMemo } from "react";
import { ActionBar, TruthToggle, TruthInputRow, MarkerNote, ProcessStep } from "@/components/p4/primitives";
import { raiMizuAction, tsunamiHonooAction, juso, accel } from "@/p4/logic";
import type { Choice } from "@/p4/types";

/** 処理フローフェーズ本体（記事タイムライン準拠の処理順） */
export function ProcessFlow({
  get,
  set,
}: {
  get: (k: string) => string;
  set: (k: string, v: string) => void;
}) {
  // --- 状態の読み出し ---
  const gc3Role = get("gc3_role__role"); // "aragan" | "shi" | ""
  const gc3Mu = get("gc3_mu") as Choice; // 無の氾濫

  const thunda = get("magic_thunda") as Choice; // サンダガ記憶
  const blizza = get("magic_blizza") as Choice; // ブリザガ記憶
  const magicOut = get("magic_out") as Choice; // マジックアウト

  const gc1Role = get("gc1_role__role");
  const gc1RoleTruth = get("gc1_role") as Choice; // 雷/水 散開・頭割り判定
  const gc1Juso = get("gc1_juso") as Choice;
  const gc1Accel = get("gc1_accel") as Choice;

  const gc2Role = get("gc2_role__role");
  const gc2RoleTruth = get("gc2_role") as Choice;
  const gc2Juso = get("gc2_juso") as Choice;
  const gc2Accel = get("gc2_accel") as Choice;

  const wave1Role = get("wave1_type__role");
  const wave1Truth = get("wave1_type") as Choice;
  const wave2Role = get("wave2_type__role");
  const wave2Truth = get("wave2_type") as Choice;

  // --- 派生 ---
  // ① 生者の傷（GC3）: 既存 Gc3Body と同一ロジック
  const gc3Result = useMemo(() => {
    if (!gc3Role || !gc3Mu) return null;
    if (gc3Role === "aragan") {
      return gc3Mu === "shin"
        ? "🎯 異色に当たる（生きる）"
        : "🎯 同色に当たる（生きる）";
    }
    return gc3Mu === "shin"
      ? "🎯 同色に当たる（瀕死/死を回避）"
      : "🎯 異色に当たる（瀕死/死を回避）";
  }, [gc3Role, gc3Mu]);

  // ④ もりもりサンダガ＝記憶値で直接
  const thundaDirect: string | null = !thunda
    ? null
    : thunda === "shin"
    ? "⚡ 直線を踏まない"
    : "⚡ 直線を踏む";

  // ⑦ ひろげるブリザガ＝記憶値で直接
  const blizzaDirect: string | null = !blizza
    ? null
    : blizza === "shin"
    ? "❄ 扇を踏まない"
    : "❄ 扇を踏む";

  // ⑨ XNOR(記憶 × マジックアウト) 一致=本当→踏まない / 不一致=嘘→踏む
  const xnorTruth = (memory: Choice): "shin" | "gi" | null => {
    if (!memory || !magicOut) return null;
    return memory === magicOut ? "shin" : "gi";
  };
  const thundaFinal = xnorTruth(thunda);
  const blizzaFinal = xnorTruth(blizza);
  const thundaOutAction =
    thundaFinal === null
      ? null
      : thundaFinal === "shin"
      ? "⚡ 直線を踏まない"
      : "⚡ 直線を踏む";
  const blizzaOutAction =
    blizzaFinal === null
      ? null
      : blizzaFinal === "shin"
      ? "❄ 扇を踏まない"
      : "❄ 扇を踏む";

  const memLabel = (c: Choice) => (c === "shin" ? "真" : c === "gi" ? "偽" : "—");

  return (
    <div className="flex flex-col gap-2">
      {/* 1. 生者の傷（GC3）処理 */}
      <ProcessStep index={1} name="生者の傷（GC3）処理">
        {!gc3Role ? (
          <div className="rounded-md border border-dashed px-2 py-1.5 text-[11px] text-muted-foreground">
            判定入力で担当を選択してください
          </div>
        ) : (
          <div className="rounded-md border bg-card px-2 py-1.5">
            <div className="flex items-center justify-between gap-2">
              <span className="min-w-0 flex-1 text-xs font-semibold">
                無の氾濫{" "}
                <span className="text-[10px] text-muted-foreground">
                  （担当: {gc3Role === "aragan" ? "アラガン" : "死の超越"}）
                </span>
              </span>
              <TruthToggle value={gc3Mu} onChange={(v) => set("gc3_mu", v)} />
            </div>
            <ActionBar text={gc3Result} />
          </div>
        )}
      </ProcessStep>

      {/* 2. マジックチャージ（記憶） */}
      <ProcessStep index={2} name="マジックチャージ（記憶）">
        <TruthInputRow
          label="⚡ もりもりサンダガ（記憶）"
          value={thunda}
          onChange={(v) => set("magic_thunda", v)}
        />
        <TruthInputRow
          label="❄ ひろげるブリザガ（記憶）"
          value={blizza}
          onChange={(v) => set("magic_blizza", v)}
        />
        <div className="rounded-md border border-dashed bg-muted/30 px-2 py-1 text-[11px] text-muted-foreground">
          記憶 → ⚡サンダガ: <b className="text-foreground">{memLabel(thunda)}</b>
          {"　"}❄ブリザガ: <b className="text-foreground">{memLabel(blizza)}</b>
        </div>
      </ProcessStep>

      {/* 3. 水属性圧縮＋フォークライトニング＋加速度爆弾（GC1） */}
      <ProcessStep
        index={3}
        name="水属性圧縮＋フォークライトニング＋加速度爆弾（GC1）処理"
      >
        <ActionBar text={raiMizuAction(gc1Role, gc1RoleTruth)} />
        {accel(gc1Accel) && <ActionBar text={accel(gc1Accel)} />}
      </ProcessStep>

      {/* 4. もりもりサンダガ＋呪詛の叫声（GC1） */}
      <ProcessStep index={4} name="もりもりサンダガ＋呪詛の叫声（GC1）処理">
        <ActionBar text={thundaDirect} />
        <ActionBar text={juso(gc1Juso)} />
      </ProcessStep>

      {/* 5. どきどきアルテマ＋混沌（1回目） */}
      <ProcessStep index={5} name="どきどきアルテマ＋混沌（1回目）処理">
        <ActionBar text={tsunamiHonooAction(wave1Role, wave1Truth)} />
      </ProcessStep>

      {/* 6. 全体攻撃 */}
      <ProcessStep index={6} name="全体攻撃">
        <MarkerNote text="💥 全体攻撃（受けるだけ）" />
      </ProcessStep>

      {/* 7. ひろげるブリザガ＋水＋雷＋加速度（GC2） */}
      <ProcessStep index={7} name="ひろげるブリザガ＋水＋雷＋加速度（GC2）処理">
        <ActionBar text={blizzaDirect} />
        <ActionBar text={raiMizuAction(gc2Role, gc2RoleTruth)} />
        {accel(gc2Accel) && <ActionBar text={accel(gc2Accel)} />}
      </ProcessStep>

      {/* 8. 呪詛の叫声（GC2） */}
      <ProcessStep index={8} name="呪詛の叫声（GC2）処理">
        <ActionBar text={juso(gc2Juso)} />
      </ProcessStep>

      {/* 9. マジックアウト＋混沌（2回目） */}
      <ProcessStep index={9} name="マジックアウト＋混沌（2回目）処理">
        <TruthInputRow
          label="🎭 マジックアウト"
          value={magicOut}
          onChange={(v) => set("magic_out", v)}
        />
        {magicOut && (
          <div className="rounded-md border border-dashed bg-muted/30 px-2 py-1 text-[10px] text-muted-foreground">
            ⚡記憶 {memLabel(thunda)} × アウト {memLabel(magicOut)} →{" "}
            <b className="text-foreground">
              {thundaFinal === "shin" ? "本当" : thundaFinal === "gi" ? "嘘" : "—"}
            </b>
            {"　"}❄記憶 {memLabel(blizza)} × アウト {memLabel(magicOut)} →{" "}
            <b className="text-foreground">
              {blizzaFinal === "shin" ? "本当" : blizzaFinal === "gi" ? "嘘" : "—"}
            </b>
          </div>
        )}
        <ActionBar text={thundaOutAction} />
        <ActionBar text={blizzaOutAction} />
        <ActionBar text={tsunamiHonooAction(wave2Role, wave2Truth)} />
      </ProcessStep>

      {/* 10. どきどきアルテマ */}
      <ProcessStep index={10} name="どきどきアルテマ">
        <MarkerNote text="🔥 24.9% 以下で最終フェーズ" />
      </ProcessStep>
    </div>
  );
}
