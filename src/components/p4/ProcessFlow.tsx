import { useMemo } from "react";
import { ActionBar, TruthToggle, TruthInputRow, MarkerNote, ProcessStep } from "@/components/p4/primitives";
import { raiMizuAction, tsunamiHonooAction, juso, accel, seishi, magicFinal, fumuText } from "@/p4/logic";
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
  const outThunda = get("magic_out_thunda") as Choice; // マジックアウト（サンダガ）
  const outBlizza = get("magic_out_blizza") as Choice; // マジックアウト（ブリザガ）

  // 各GCの真偽は1つ（gc{n}_role）。呪詛・雷水・加速度すべてをこの真偽で決める。
  const gc1Role = get("gc1_role__role");
  const gc1Truth = get("gc1_role") as Choice;
  const gc1Accel = get("gc1_accel"); // none | haya | oso（担当=なし時のみ）
  const gc1Juso = get("gc1_juso"); // none | haya | oso（呪詛の発生源タイミング）

  const gc2Role = get("gc2_role__role");
  const gc2Truth = get("gc2_role") as Choice;
  const gc2Accel = get("gc2_accel");
  const gc2Juso = get("gc2_juso");

  // 水雷(散開/頭割り)の処理タイミング: 雷/水持ちのGCは入力値、なしGCはその逆（排他）。
  const opp = (w: string) => (w === "haya" ? "oso" : w === "oso" ? "haya" : "");
  const gc1When = get("gc1_when");
  const gc2When = get("gc2_when");
  const gc1Timing =
    gc1Role === "rai" || gc1Role === "mizu" ? gc1When : opp(gc2When);
  const gc2Timing =
    gc2Role === "rai" || gc2Role === "mizu" ? gc2When : opp(gc1When);
  const earlyGcRole = gc1Timing === "haya" ? gc1Role : gc2Timing === "haya" ? gc2Role : "";
  const earlyGcTruth: Choice =
    gc1Timing === "haya" ? gc1Truth : gc2Timing === "haya" ? gc2Truth : "";
  const lateGcRole = gc1Timing === "oso" ? gc1Role : gc2Timing === "oso" ? gc2Role : "";
  const lateGcTruth: Choice =
    gc1Timing === "oso" ? gc1Truth : gc2Timing === "oso" ? gc2Truth : "";

  // --- 加速度爆弾: プレイヤーが「なし」かつ accel!=="none" のGCが加速度持ち。 ---
  // 早→GC1グループステップ / 遅→GC2グループステップ に配置（早/遅で配置）。
  const gc1HasAccel = gc1Role === "nashi" && gc1Accel !== "" && gc1Accel !== "none";
  const gc2HasAccel = gc2Role === "nashi" && gc2Accel !== "" && gc2Accel !== "none";
  // 自分が早の加速度を持つか（どちらのGCが「なし」かに依らず、値で判定）
  const hayaActive =
    (gc1HasAccel && gc1Accel === "haya") || (gc2HasAccel && gc2Accel === "haya");
  const osoActive =
    (gc1HasAccel && gc1Accel === "oso") || (gc2HasAccel && gc2Accel === "oso");
  // 早/遅の加速度に対応する「そのGCの真偽」
  const hayaTruth: Choice =
    gc1HasAccel && gc1Accel === "haya"
      ? gc1Truth
      : gc2HasAccel && gc2Accel === "haya"
      ? gc2Truth
      : "";
  const osoTruth: Choice =
    gc1HasAccel && gc1Accel === "oso"
      ? gc1Truth
      : gc2HasAccel && gc2Accel === "oso"
      ? gc2Truth
      : "";

  // --- 呪詛の叫声: 見る/見ないは全員が対処（GC真偽で決まる）。 ---
  // 自分が「発生源」かどうかは有/無。早/遅は GC1=早・GC2=遅 で確定。
  const jusoSrcHaya = gc1Role === "nashi" && gc1Juso === "yes"; // GC1=早
  const jusoSrcOso = gc2Role === "nashi" && gc2Juso === "yes"; // GC2=遅

  const wave1Role = get("wave1_type__role");
  const wave1Truth = get("wave1_type") as Choice;
  const wave1When = get("wave1_when"); // haya | oso
  const wave2Role = get("wave2_type__role");
  const wave2Truth = get("wave2_type") as Choice;
  const wave2When = get("wave2_when");

  // ほのお/つなみは早遅が入れ替わる。処理タイミング(早/遅)で配置する。
  const earlyWaveRole = wave1When === "haya" ? wave1Role : wave2When === "haya" ? wave2Role : "";
  const earlyWaveTruth: Choice =
    wave1When === "haya" ? wave1Truth : wave2When === "haya" ? wave2Truth : "";
  const lateWaveRole = wave1When === "oso" ? wave1Role : wave2When === "oso" ? wave2Role : "";
  const lateWaveTruth: Choice =
    wave1When === "oso" ? wave1Truth : wave2When === "oso" ? wave2Truth : "";

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
  const fumu = fumuText;

  // ④ もりもりサンダガ＝記憶値で直接
  const thundaDirect: string | null = !thunda ? null : `⚡ サンダガ ${fumu(thunda)}`;

  // ⑦ ひろげるブリザガ＝記憶値で直接
  const blizzaDirect: string | null = !blizza ? null : `❄ ブリザガ ${fumu(blizza)}`;

  // ⑨ XNOR(記憶 × マジックアウト) 一致=本当→踏まない / 不一致=嘘→踏む。
  // マジックアウトはサンダガ・ブリザガそれぞれに真偽がある。
  const thundaFinal = magicFinal(thunda, outThunda);
  const blizzaFinal = magicFinal(blizza, outBlizza);
  // 両方が同じ（両方踏む／両方踏まない）なら1行に集約、違えば2行
  const magicOutBars: string[] =
    thundaFinal === null || blizzaFinal === null
      ? []
      : thundaFinal === blizzaFinal
      ? [`⚡❄ サンダガ・ブリザガ 両方${fumu(thundaFinal)}`]
      : [`⚡ サンダガ ${fumu(thundaFinal)}`, `❄ ブリザガ ${fumu(blizzaFinal)}`];

  const memLabel = (c: Choice) => (c === "shin" ? "真" : c === "gi" ? "偽" : "—");

  return (
    <div className="flex flex-col gap-0">
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

      {/* 2. 水属性圧縮＋フォークライトニング＋加速度爆弾（早） — 水雷は2回目(GC2)が早 */}
      <ProcessStep
        index={2}
        name="水属性圧縮＋フォークライトニング＋加速度爆弾（早）処理"
        highlight={hayaActive}
      >
        {/* 散開/頭割り（早側の水雷） */}
        <ActionBar text={raiMizuAction(earlyGcRole, earlyGcTruth)} />
        {/* 加速度（早）: 該当者のみ行を出す */}
        {hayaActive && (
          <ActionBar text={`${accel(hayaTruth)}（加速度・早）`} />
        )}
      </ProcessStep>

      {/* 3. もりもりサンダガ＋呪詛の叫声（GC1） */}
      <ProcessStep
        index={3}
        name="もりもりサンダガ＋呪詛の叫声（GC1）処理"
        highlight={jusoSrcHaya}
      >
        <TruthInputRow
          label="⚡ もりもりサンダガ（真偽）"
          value={thunda}
          onChange={(v) => set("magic_thunda", v)}
        />
        <ActionBar text={thundaDirect} />
        {/* 見る/見ないは全員が対処（GC1真偽） */}
        <ActionBar text={juso(gc1Truth) && `${juso(gc1Truth)}（呪詛・全員）`} />
        {jusoSrcHaya && (
          <div className="rounded-md border border-amber-400 bg-amber-400/10 px-2 py-1 text-[11px] font-bold text-amber-300">
            🔆 あなたが呪詛の発生源（早）
          </div>
        )}
      </ProcessStep>

      {/* 4. どきどきアルテマ＋混沌（早） */}
      <ProcessStep index={4} name="どきどきアルテマ＋混沌（早）処理">
        <ActionBar text={tsunamiHonooAction(earlyWaveRole, earlyWaveTruth)} />
      </ProcessStep>

      {/* 5. ひろげるブリザガ＋水＋雷＋加速度（遅） — 水雷は1回目(GC1)が遅 */}
      <ProcessStep
        index={5}
        name="ひろげるブリザガ＋水＋雷＋加速度（遅）処理"
        highlight={osoActive}
      >
        <TruthInputRow
          label="❄ ひろげるブリザガ（真偽）"
          value={blizza}
          onChange={(v) => set("magic_blizza", v)}
        />
        <ActionBar text={blizzaDirect} />
        {/* 散開/頭割り（遅側の水雷） */}
        <ActionBar text={raiMizuAction(lateGcRole, lateGcTruth)} />
        {/* 加速度（遅）: 該当者のみ行を出す */}
        {osoActive && <ActionBar text={`${accel(osoTruth)}（加速度・遅）`} />}
      </ProcessStep>

      {/* 6. 呪詛の叫声（GC2） */}
      <ProcessStep index={6} name="呪詛の叫声（GC2）処理" highlight={jusoSrcOso}>
        {/* 見る/見ないは全員が対処（GC2真偽） */}
        <ActionBar text={juso(gc2Truth) && `${juso(gc2Truth)}（呪詛・全員）`} />
        {jusoSrcOso && (
          <div className="rounded-md border border-amber-400 bg-amber-400/10 px-2 py-1 text-[11px] font-bold text-amber-300">
            🔆 あなたが呪詛の発生源（遅）
          </div>
        )}
      </ProcessStep>

      {/* 7. マジックアウト＋混沌（遅） */}
      <ProcessStep index={7} name="マジックアウト＋混沌（遅）処理">
        <TruthInputRow
          label="🎭 マジックアウト（サンダガ）"
          value={outThunda}
          onChange={(v) => set("magic_out_thunda", v)}
        />
        <TruthInputRow
          label="🎭 マジックアウト（ブリザガ）"
          value={outBlizza}
          onChange={(v) => set("magic_out_blizza", v)}
        />
        {(outThunda || outBlizza) && (
          <div className="rounded-md border border-dashed bg-muted/30 px-2 py-1 text-[10px] text-muted-foreground">
            ⚡記憶 {memLabel(thunda)} × アウト {memLabel(outThunda)} →{" "}
            <b className="text-foreground">
              {thundaFinal === "shin" ? "本当" : thundaFinal === "gi" ? "嘘" : "—"}
            </b>
            {"　"}❄記憶 {memLabel(blizza)} × アウト {memLabel(outBlizza)} →{" "}
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
        <ActionBar text={tsunamiHonooAction(lateWaveRole, lateWaveTruth)} />
      </ProcessStep>

      {/* 8. どきどきアルテマ（全体攻撃） */}
      <ProcessStep index={8} name="どきどきアルテマ（全体攻撃）" last>
        <MarkerNote text="🔥 24.9% 以下で最終フェーズ" />
      </ProcessStep>
    </div>
  );
}
