import { raiMizuAction, tsunamiHonooAction, juso, accel } from "@/p4/logic";
import type { Choice } from "@/p4/types";

function synth(): SpeechSynthesis | null {
  if (typeof window === "undefined" || !("speechSynthesis" in window)) return null;
  return window.speechSynthesis;
}

let jaVoice: SpeechSynthesisVoice | null = null;
function pickVoice(): void {
  const s = synth();
  if (!s) return;
  try {
    const vs = s.getVoices();
    jaVoice =
      vs.find((v) => v.lang === "ja-JP") ||
      vs.find((v) => v.lang && v.lang.toLowerCase().startsWith("ja")) ||
      null;
  } catch {
    /* 無視 */
  }
}

/**
 * 音声エンジンの初期化（ウォームアップ）。読み上げONや戦闘前に呼ぶと
 * 初回の遅延（音声リスト未ロード・コールドスタート）を軽減できる。
 */
export function primeSpeech(): void {
  const s = synth();
  if (!s) return;
  try {
    pickVoice();
    s.onvoiceschanged = pickVoice;
    // 無音の短い発話でエンジンを温める（Windows/WebView2 の初回遅延対策）
    const u = new SpeechSynthesisUtterance(" ");
    u.lang = "ja-JP";
    u.volume = 0;
    s.speak(u);
  } catch {
    /* 無視 */
  }
}

/** 読み上げ音量（0〜1）。スライダーから設定。 */
let speakVolume = 1;
export function setSpeechVolume(v: number): void {
  speakVolume = Math.max(0, Math.min(1, v));
}

/**
 * 日本語読み上げ。各読み上げは時間的に離れている前提。
 *
 * 終盤（マジックアウト付近）で読み上げが止まる症状の対策:
 * WebView2/SAPI では稀に発話の onend が来ず `speaking` が true のまま固着し、
 * 以降の speak() が全てキュー待ちになって無音になる。読み上げ間隔は数秒空くので、
 * このタイミングで speaking/pending が残っていれば固着とみなして cancel() でクリアしてから話す。
 * （cancel 直後は Windows で speak が取りこぼされるため少し待ってから発話する。）
 */
export function speak(text: string, retry = false): void {
  const s = synth();
  if (!s) return;
  try {
    if (!jaVoice) pickVoice();
    const u = new SpeechSynthesisUtterance(text);
    u.lang = "ja-JP";
    u.volume = speakVolume;
    if (jaVoice) u.voice = jaVoice;
    let started = false;
    u.onstart = () => {
      started = true;
    };
    const stuck = s.speaking || s.pending;
    if (stuck) s.cancel();
    const go = () => {
      try {
        s.resume();
        s.speak(u);
      } catch {
        /* 無視 */
      }
    };
    if (stuck) setTimeout(go, 150);
    else go();
    // ウォッチドッグ: 一定時間たっても一度も発話開始せず無音のままなら
    // 取りこぼしとみなして 1 回だけ再試行（最後の読み上げ＝呪詛 も拾えるように）。
    if (!retry) {
      setTimeout(() => {
        try {
          if (!started && !s.speaking) {
            s.cancel();
            setTimeout(() => speak(text, true), 120);
          }
        } catch {
          /* 無視 */
        }
      }, 1400);
    }
  } catch {
    /* 無視 */
  }
}

/** 読み上げを停止（キュー含め全クリア）。 */
export function stopSpeak(): void {
  const s = synth();
  if (!s) return;
  try {
    s.cancel();
  } catch {
    /* 無視 */
  }
}

/**
 * エンジンが勝手に止まる/眠るのを防ぐキープアライブ。
 * 発話中は pause()→resume() の定番ハックで眠りを防ぎ、アイドル時は resume() で
 * 一時停止状態を解除しておく。（0 音量の温存発話は逆にキューを詰まらせうるため使わない。）
 */
let keepAliveId: ReturnType<typeof setInterval> | null = null;
export function startKeepAlive(): void {
  const s = synth();
  if (!s || keepAliveId != null) return;
  keepAliveId = setInterval(() => {
    try {
      if (s.speaking) {
        s.pause();
        s.resume();
      } else {
        s.resume();
      }
    } catch {
      /* 無視 */
    }
  }, 5000);
}
export function stopKeepAlive(): void {
  if (keepAliveId != null) {
    clearInterval(keepAliveId);
    keepAliveId = null;
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

/** 各ステップの既定秒数（読み上げ時刻）。 */
export const DEFAULT_TIMINGS: Record<string, number> = {
  seija: 3, // 生者の傷（超越/アラガン）
  haya: 15, // 水属性圧縮＋フォークライトニング＋加速度（早）
  thunda: 22, // もりもりサンダガ＋呪詛（早）
  chaosHaya: 35, // どきどきアルテマ＋混沌（早）
  oso: 40, // ひろげるブリザガ＋水＋雷＋加速度（遅）
  jusoOso: 47, // 呪詛の叫声（GC2）
};

/** 読み上げは処理着弾の何秒前か（着弾＝読み上げ時刻＋このオフセット）。 */
export const IMPACT_OFFSET = 5;
/** マジックアウト（読み上げ無し）の着弾相当の読み上げ時刻。 */
const MAGIC_OUT_SEC = 52;

/**
 * 処理画面の各ステップ(1〜7)の「着弾秒数」（＝読み上げ時刻＋5秒）。
 * elapsed がこの値を超えたら非活性化する。step8(最終アルテマ)は対象外。
 */
export function stepImpactSec(timings: Record<string, number>): Record<number, number> {
  const t = (k: string) => timings[k] ?? DEFAULT_TIMINGS[k];
  const off = IMPACT_OFFSET;
  return {
    1: t("seija") + off,
    2: t("haya") + off,
    3: t("thunda") + off,
    4: t("chaosHaya") + off,
    5: t("oso") + off,
    6: t("jusoOso") + off,
    7: MAGIC_OUT_SEC + off,
  };
}

/**
 * 全処理が着弾し終わったあと ALLリセットを走らせる秒数。
 * 最後の着弾（マジックアウト）＋最終アルテマぶんの余裕を見て少し後ろに置く。
 */
export function resetSec(timings: Record<string, number>): number {
  const impacts = Object.values(stepImpactSec(timings));
  return Math.max(...impacts) + 8;
}

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
