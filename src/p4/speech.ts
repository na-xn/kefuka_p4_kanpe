import { raiMizuAction, tsunamiHonooAction, juso, accel } from "@/p4/logic";
import type { Choice } from "@/p4/types";

/** speechSynthesis で日本語読み上げ。利用不可環境では何もしない。 */
export function speak(text: string): void {
  try {
    if (typeof window === "undefined" || !("speechSynthesis" in window)) return;
    window.speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(text);
    u.lang = "ja-JP";
    window.speechSynthesis.speak(u);
  } catch {
    /* 読み上げ不可環境では無視 */
  }
}

/** 読み上げを停止。 */
export function stopSpeak(): void {
  try {
    if (typeof window === "undefined" || !("speechSynthesis" in window)) return;
    window.speechSynthesis.cancel();
  } catch {
    /* 無視 */
  }
}

/** 読み上げステップ定義。text(get) は状態から読み上げ文を生成（未確定なら最低限の指示）。 */
export type SpeechStep = {
  key: string;
  atSec: number;
  label: string;
  /** hideEdge のとき呼び出し側でスキップするステップか */
  edgeOnly?: boolean;
  text: (get: (k: string) => string) => string | null;
};

/** 各ステップの既定秒数。 */
export const DEFAULT_TIMINGS: Record<string, number> = {
  seija: 3, // 生者の傷（超越/アラガン）
  haya: 15, // 水属性圧縮＋フォークライトニング＋加速度（早）
  thunda: 22, // もりもりサンダガ＋呪詛（早）
  chaosHaya: 35, // どきどきアルテマ＋混沌（早）
  oso: 40, // ひろげるブリザガ＋水＋雷＋加速度（遅）
  jusoOso: 47, // 呪詛の叫声（GC2）
};

/** 散開→「散開、1人」のように読み上げ用に簡潔化。 */
function simplify(s: string | null): string | null {
  if (!s) return null;
  return s
    .replace("散開（1人）", "散開、1人")
    .replace("ドーナツ＝中央で動かない", "ドーナツ。中央で動かない")
    .replace("タケノコ回避", "タケノコ");
}

const opp = (w: string) => (w === "haya" ? "oso" : w === "oso" ? "haya" : "");

/** 早側/遅側の水雷(担当/真偽)を導出。ProcessFlow と同じ。 */
function gcTimings(get: (k: string) => string) {
  const gc1Role = get("gc1_role__role");
  const gc1Truth = get("gc1_role") as Choice;
  const gc2Role = get("gc2_role__role");
  const gc2Truth = get("gc2_role") as Choice;
  const gc1When = get("gc1_when");
  const gc2When = get("gc2_when");
  const gc1Timing = gc1Role === "rai" || gc1Role === "mizu" ? gc1When : opp(gc2When);
  const gc2Timing = gc2Role === "rai" || gc2Role === "mizu" ? gc2When : opp(gc1When);
  const earlyGcRole = gc1Timing === "haya" ? gc1Role : gc2Timing === "haya" ? gc2Role : "";
  const earlyGcTruth: Choice =
    gc1Timing === "haya" ? gc1Truth : gc2Timing === "haya" ? gc2Truth : "";
  const lateGcRole = gc1Timing === "oso" ? gc1Role : gc2Timing === "oso" ? gc2Role : "";
  const lateGcTruth: Choice =
    gc1Timing === "oso" ? gc1Truth : gc2Timing === "oso" ? gc2Truth : "";
  return { earlyGcRole, earlyGcTruth, lateGcRole, lateGcTruth };
}

/** 加速度の早/遅アクティブと真偽。ProcessFlow と同じ。 */
function accelTimings(get: (k: string) => string) {
  const gc1Role = get("gc1_role__role");
  const gc1Truth = get("gc1_role") as Choice;
  const gc1Accel = get("gc1_accel");
  const gc2Role = get("gc2_role__role");
  const gc2Truth = get("gc2_role") as Choice;
  const gc2Accel = get("gc2_accel");
  const gc1HasAccel = gc1Role === "nashi" && gc1Accel !== "" && gc1Accel !== "none";
  const gc2HasAccel = gc2Role === "nashi" && gc2Accel !== "" && gc2Accel !== "none";
  const hayaActive =
    (gc1HasAccel && gc1Accel === "haya") || (gc2HasAccel && gc2Accel === "haya");
  const osoActive =
    (gc1HasAccel && gc1Accel === "oso") || (gc2HasAccel && gc2Accel === "oso");
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
  return { hayaActive, osoActive, hayaTruth, osoTruth };
}

/** つなみ/ほのおの早/遅(種類/真偽)を導出。ProcessFlow と同じ。 */
function waveTimings(get: (k: string) => string) {
  const wave1Role = get("wave1_type__role");
  const wave1Truth = get("wave1_type") as Choice;
  const wave1When = get("wave1_when");
  const wave2Role = get("wave2_type__role");
  const wave2Truth = get("wave2_type") as Choice;
  const wave2When = get("wave2_when");
  const earlyWaveRole = wave1When === "haya" ? wave1Role : wave2When === "haya" ? wave2Role : "";
  const earlyWaveTruth: Choice =
    wave1When === "haya" ? wave1Truth : wave2When === "haya" ? wave2Truth : "";
  const lateWaveRole = wave1When === "oso" ? wave1Role : wave2When === "oso" ? wave2Role : "";
  const lateWaveTruth: Choice =
    wave1When === "oso" ? wave1Truth : wave2When === "oso" ? wave2Truth : "";
  return { earlyWaveRole, earlyWaveTruth, lateWaveRole, lateWaveTruth };
}

/** タイムライン順の読み上げステップ定義。 */
export function buildSpeechSteps(timings: Record<string, number>): SpeechStep[] {
  const t = (k: string) => timings[k] ?? DEFAULT_TIMINGS[k];
  return [
    {
      key: "seija",
      atSec: t("seija"),
      label: "生者の傷",
      edgeOnly: true,
      text: (get) => {
        const role = get("gc3_role__role");
        if (role === "aragan") return "生者の傷。アラガン。生きる";
        if (role === "shi") return "生者の傷。死の超越。死ぬ";
        return "生者の傷";
      },
    },
    {
      key: "haya",
      atSec: t("haya"),
      label: "水属性圧縮＋フォークライトニング＋加速度（早）",
      text: (get) => {
        const { earlyGcRole, earlyGcTruth } = gcTimings(get);
        const { hayaActive, hayaTruth } = accelTimings(get);
        const parts: string[] = [];
        const rm = simplify(raiMizuAction(earlyGcRole, earlyGcTruth));
        if (rm) parts.push(rm);
        if (hayaActive) {
          const a = accel(hayaTruth);
          parts.push(a ? `${a}。加速度` : "加速度");
        }
        return parts.length ? parts.join("。") : null;
      },
    },
    {
      key: "thunda",
      atSec: t("thunda"),
      label: "もりもりサンダガ＋呪詛（早）",
      text: (get) => {
        const gc1Truth = get("gc1_role") as Choice;
        const parts: string[] = [];
        const j = juso(gc1Truth);
        if (j) parts.push(j);
        parts.push("サンダガの真偽を押してください");
        return parts.join("。");
      },
    },
    {
      key: "chaosHaya",
      atSec: t("chaosHaya"),
      label: "どきどきアルテマ＋混沌（早）",
      text: (get) => {
        const { earlyWaveRole, earlyWaveTruth } = waveTimings(get);
        return simplify(tsunamiHonooAction(earlyWaveRole, earlyWaveTruth));
      },
    },
    {
      key: "oso",
      atSec: t("oso"),
      label: "ひろげるブリザガ＋水＋雷＋加速度（遅）",
      text: (get) => {
        const { lateGcRole, lateGcTruth } = gcTimings(get);
        const { osoActive, osoTruth } = accelTimings(get);
        const parts: string[] = [];
        const rm = simplify(raiMizuAction(lateGcRole, lateGcTruth));
        if (rm) parts.push(rm);
        if (osoActive) {
          const a = accel(osoTruth);
          parts.push(a ? `${a}。加速度` : "加速度");
        }
        parts.push("ブリザガの真偽を押してください");
        return parts.join("。");
      },
    },
    {
      key: "jusoOso",
      atSec: t("jusoOso"),
      label: "呪詛の叫声（GC2）",
      text: (get) => {
        const gc2Truth = get("gc2_role") as Choice;
        return juso(gc2Truth);
      },
    },
  ];
}
