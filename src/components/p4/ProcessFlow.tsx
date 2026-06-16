import { useMemo } from "react";
import { ActionBar, TruthToggle, TruthInputRow, MarkerNote, ProcessStep } from "@/components/p4/primitives";
import { raiMizuAction, tsunamiHonooAction, juso, accel, seishi } from "@/p4/logic";
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
  const gc3Truth = get("gc3_truth") as Choice; // アラガン/死の超越 真偽（生死）
  const gc3Seishi = seishi(gc3Role, gc3Truth); // 生死テキスト

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

  // 踏む/踏まない（本当=踏まない / 嘘=踏む）
  const fumu = (f: Choice | null) => (f === "shin" ? "踏まない" : f === "gi" ? "踏む" : null);

  // ④ もりもりサンダガ＝記憶値で直接
  const thundaDirect: string | null = !thunda ? null : `⚡ サンダガ ${fumu(thunda)}`;

  // ⑦ ひろげるブリザガ＝記憶値で直接
  const blizzaDirect: string | null = !blizza ? null : `❄ ブリザガ ${fumu(blizza)}`;

  // ⑨ XNOR(記憶 × マジックアウト) 一致=本当→踏まない / 不一致=嘘→踏む
  const xnorTruth = (memory: Choice): "shin" | "gi" | null => {
    if (!memory || !magicOut) return null;
    return memory === magicOut ? "shin" : "gi";
  };
  const thundaFinal = xnorTruth(thunda);
  const blizzaFinal = xnorTruth(blizza);
  // 両方が同じ（両方踏む／両方踏まない）なら1行に集約、違えば2行
  const magicOutBars: string[] =
    thundaFinal === null || blizzaFinal === null
      ? []
      : thundaFinal === blizzaFinal
      ? [`⚡❄ サンダガ・ブリザガ 両方${fumu(thundaFinal)}`]
      : [`⚡ サンダガ ${fumu(thundaFinal)}`, `❄ ブリザガ ${fumu(blizzaFinal)}`];

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
            <div className="mt-1 rounded-md border border-dashed px-2 py-1 text-[11px]">
              {gc3Seishi ? (
                <span className="font-semibold text-foreground">あなた: {gc3Seishi}</span>
              ) : (
                <span className="text-muted-foreground/60">生死: 判定入力で真偽を選択…</span>
              )}
            </div>
            <ActionBar text={gc3Result} />
          </div>
        )}
      </ProcessStep>

      {/* 2. 水属性圧縮＋フォークライトニング＋加速度爆弾（GC1） */}
      <ProcessStep
        index={2}
        name="水属性圧縮＋フォークライトニング＋加速度爆弾（GC1）処理"
      >
        <ActionBar text={raiMizuAction(gc1Role, gc1RoleTruth)} />
        {accel(gc1Accel) && <ActionBar text={accel(gc1Accel)} />}
      </ProcessStep>

      {/* 3. もりもりサンダガ＋呪詛の叫声（GC1） */}
      <ProcessStep index={3} name="もりもりサンダガ＋呪詛の叫声（GC1）処理">
        <TruthInputRow
          label="⚡ もりもりサンダガ（真偽）"
          value={thunda}
          onChange={(v) => set("magic_thunda", v)}
        />
        <ActionBar text={thundaDirect} />
        <ActionBar text={juso(gc1Juso)} />
      </ProcessStep>

      {/* 4. どきどきアルテマ＋混沌（1回目） */}
      <ProcessStep index={4} name="どきどきアルテマ＋混沌（1回目）処理">
        <ActionBar text={tsunamiHonooAction(wave1Role, wave1Truth)} />
      </ProcessStep>

      {/* 5. ひろげるブリザガ＋水＋雷＋加速度（GC2） */}
      <ProcessStep index={5} name="ひろげるブリザガ＋水＋雷＋加速度（GC2）処理">
        <TruthInputRow
          label="❄ ひろげるブリザガ（真偽）"
          value={blizza}
          onChange={(v) => set("magic_blizza", v)}
        />
        <ActionBar text={blizzaDirect} />
        <ActionBar text={raiMizuAction(gc2Role, gc2RoleTruth)} />
        {accel(gc2Accel) && <ActionBar text={accel(gc2Accel)} />}
      </ProcessStep>

      {/* 6. 呪詛の叫声（GC2） */}
      <ProcessStep index={6} name="呪詛の叫声（GC2）処理">
        <ActionBar text={juso(gc2Juso)} />
      </ProcessStep>

      {/* 7. マジックアウト＋混沌（2回目） */}
      <ProcessStep index={7} name="マジックアウト＋混沌（2回目）処理">
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
        {magicOutBars.length === 0 ? (
          <ActionBar text={null} />
        ) : (
          magicOutBars.map((t, i) => <ActionBar key={i} text={t} />)
        )}
        <ActionBar text={tsunamiHonooAction(wave2Role, wave2Truth)} />
      </ProcessStep>

      {/* 8. どきどきアルテマ（全体攻撃） */}
      <ProcessStep index={8} name="どきどきアルテマ（全体攻撃）">
        <MarkerNote text="🔥 24.9% 以下で最終フェーズ" />
      </ProcessStep>
    </div>
  );
}
