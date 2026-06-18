import { raiMizuAction, tsunamiHonooAction, juso, accel, magicFinal } from "@/p4/logic";
import type { Choice, Role } from "@/p4/types";

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
  // ずんだもんクリップ再生のためのオーディオ解錠（iOS Safari 対策）。
  // 読み上げON のユーザー操作内で呼ばれる前提なので、ここで volume 0 の
  // 短い play()→pause() を行いオーディオコンテキストを解錠しておく。
  try {
    const a = new Audio(`${CLIP_BASE}${CLIP.s001}`);
    a.volume = 0;
    const p = a.play();
    if (p && typeof p.then === "function") {
      p.then(() => {
        try {
          a.pause();
          a.currentTime = 0;
        } catch {
          /* 無視 */
        }
      }).catch(() => {
        /* 自動再生ブロック等は無視 */
      });
    }
  } catch {
    /* 無視 */
  }
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

/** 読み上げ音量（0〜1）。スライダーから設定。Web Speech / クリップ再生で共用。 */
let speakVolume = 1;
export function setSpeechVolume(v: number): void {
  speakVolume = Math.max(0, Math.min(1, v));
}

/** ずんだもん音声クリップのベースパス（public 配下、ルート絶対参照）。 */
const CLIP_BASE = "/voice/";
/** クリップ id → ファイル名。public/voice/sNNN.wav。 */
const CLIP: Record<string, string> = {
  s001: "s001.wav",
  s002: "s002.wav",
  s003: "s003.wav",
  s004: "s004.wav",
  s005: "s005.wav",
  s006: "s006.wav",
  s007: "s007.wav",
  s008: "s008.wav",
  s009: "s009.wav",
  s010: "s010.wav",
  s011: "s011.wav",
  s012: "s012.wav",
  s013: "s013.wav",
  s014: "s014.wav",
  s015: "s015.wav",
  s016: "s016.wav",
  s017: "s017.wav",
  s018: "s018.wav",
  s019: "s019.wav",
  s020: "s020.wav",
  s021: "s021.wav",
};

/** 現在再生中のクリップ Audio（停止用に保持）。 */
let currentAudio: HTMLAudioElement | null = null;

/**
 * クリップ id 配列を逐次再生（連結読み上げ）。
 * 現在の再生（Web Speech / クリップ）を止めてから、id 順に onended で連結。
 * volume は現在の読み上げ音量を流用。失敗した id はログしてスキップ。
 */
export function playClips(ids: string[], textForLog: string): void {
  if (typeof window === "undefined" || typeof Audio === "undefined") {
    // クリップ再生不可ならフォールバック（Web Speech）。
    if (textForLog) speak(textForLog);
    return;
  }
  // 進行中の再生をすべて停止（クリップ・Web Speech とも）。
  stopClips();
  stopSpeak();
  logSpeech("発話", textForLog);
  let i = 0;
  let started = false;
  const playNext = () => {
    if (i >= ids.length) {
      currentAudio = null;
      return;
    }
    const id = ids[i++];
    const file = CLIP[id];
    if (!file) {
      logSpeech("失敗", id);
      playNext();
      return;
    }
    try {
      const a = new Audio(`${CLIP_BASE}${file}`);
      a.volume = speakVolume;
      currentAudio = a;
      a.onended = () => {
        if (currentAudio === a) playNext();
      };
      a.onerror = () => {
        logSpeech("失敗", id);
        if (currentAudio === a) playNext();
      };
      if (!started) {
        started = true;
        logSpeech("開始", textForLog);
      }
      const p = a.play();
      if (p && typeof p.then === "function") {
        p.catch(() => {
          logSpeech("失敗", id);
          if (currentAudio === a) playNext();
        });
      }
    } catch {
      logSpeech("失敗", id);
      playNext();
    }
  };
  playNext();
}

/** クリップ再生を停止し、連結チェーンを中断。 */
export function stopClips(): void {
  const a = currentAudio;
  currentAudio = null;
  if (!a) return;
  try {
    a.onended = null;
    a.onerror = null;
    a.pause();
    a.currentTime = 0;
  } catch {
    /* 無視 */
  }
}

/** 読み上げログ。どの発話がいつ開始/失敗したか診断するための購読フック。 */
export type SpeechLogEntry = { atMs: number; event: string; text: string };
let logger: ((e: SpeechLogEntry) => void) | null = null;
export function setSpeechLogger(fn: ((e: SpeechLogEntry) => void) | null): void {
  logger = fn;
}
function logSpeech(event: string, text: string): void {
  try {
    logger?.({ atMs: Date.now(), event, text });
  } catch {
    /* 無視 */
  }
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
      logSpeech("開始", text);
    };
    u.onerror = (ev) => {
      logSpeech("失敗", `${text}（${(ev as SpeechSynthesisErrorEvent).error ?? "error"}）`);
    };
    const stuck = s.speaking || s.pending;
    if (stuck) {
      s.cancel();
      logSpeech("詰まり解消", text);
    }
    logSpeech(retry ? "再試行" : "発話", text);
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
  /** ずんだもんクリップ id 配列（null/空なら無し→text にフォールバック）。 */
  clips?: (get: (k: string) => string) => string[] | null;
};

/** 各ステップの既定秒数（読み上げ時刻）。全体を 2 秒前倒し済み。 */
export const DEFAULT_TIMINGS: Record<string, number> = {
  seija: 1, // 生者の傷（超越/アラガン）
  haya: 13, // 水属性圧縮＋フォークライトニング＋加速度（早）
  thunda: 20, // もりもりサンダガ＋呪詛（早）
  chaosHaya: 33, // どきどきアルテマ＋混沌（早）
  oso: 38, // ひろげるブリザガ＋水＋雷＋加速度（遅）
  jusoOso: 45, // 呪詛の叫声（GC2）
  magicOut: 50, // マジックアウト＋混沌（遅）
};

/** 読み上げは処理着弾の何秒前か（着弾＝読み上げ時刻＋このオフセット）。 */
export const IMPACT_OFFSET = 5;

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
    7: t("magicOut") + off,
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

/** raiMizuAction の結果テキスト → クリップ id 配列（散開→s006 / 頭割り→s007）。 */
function raiMizuClips(role: Role, truth: Choice): string[] {
  const a = raiMizuAction(role, truth);
  if (a === "散開（1人）") return ["s006"];
  if (a === "頭割り") return ["s007"];
  return [];
}
/** accel の結果テキスト → クリップ（止まる→s008 / 動く→s009）。+ s010(加速度)。 */
function accelClips(truth: Choice): string[] {
  const a = accel(truth);
  const head = a === "止まる" ? ["s008"] : a === "動く" ? ["s009"] : [];
  return [...head, "s010"];
}
/** juso の結果テキスト → クリップ（見ない→s012 / 見る→s011）。 */
function jusoClips(truth: Choice): string[] {
  const j = juso(truth);
  if (j === "見ない") return ["s012"];
  if (j === "見る") return ["s011"];
  return [];
}
/** tsunamiHonooAction の結果 → クリップ（タケノコ→s013 / ドーナツ→s014,s015）。 */
function waveClips(role: Role, truth: Choice): string[] {
  const w = tsunamiHonooAction(role, truth);
  if (w === "タケノコ回避") return ["s013"];
  if (w === "ドーナツ＝中央で動かない") return ["s014", "s015"];
  return [];
}

/** マジックアウトのサンダガ/ブリザガが「踏む(gi)」か。記憶×アウトの XNOR で判定。 */
function magicSteps(get: (k: string) => string) {
  const thunda = get("magic_thunda") as Choice;
  const blizza = get("magic_blizza") as Choice;
  const mof = get("magic_out_false");
  const outThunda: Choice = mof === "rai" || mof === "both" ? "gi" : "shin";
  const outBlizza: Choice = mof === "koori" || mof === "both" ? "gi" : "shin";
  return {
    tStep: magicFinal(thunda, outThunda) === "gi",
    bStep: magicFinal(blizza, outBlizza) === "gi",
  };
}

/** タイムライン順の読み上げステップ定義。 */
export function buildSpeechSteps(
  timings: Record<string, number>,
  opts?: { readSanBuri?: boolean }
): SpeechStep[] {
  const t = (k: string) => timings[k] ?? DEFAULT_TIMINGS[k];
  // マジックアウトでサンダガ/ブリザガの踏む/踏まないを読み上げるか（既定OFF）。
  const readSanBuri = opts?.readSanBuri === true;
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
      clips: (get) => {
        const role = get("gc3_role__role");
        if (role === "aragan") return ["s001", "s002", "s003"];
        if (role === "shi") return ["s001", "s004", "s005"];
        return ["s001"];
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
      clips: (get) => {
        const { earlyGcRole, earlyGcTruth } = gcTimings(get);
        const { hayaActive, hayaTruth } = accelTimings(get);
        const ids = [
          ...raiMizuClips(earlyGcRole, earlyGcTruth),
          ...(hayaActive ? accelClips(hayaTruth) : []),
        ];
        return ids.length ? ids : null;
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
        return parts.length ? parts.join("。") : null;
      },
      clips: (get) => {
        const gc1Truth = get("gc1_role") as Choice;
        return [...jusoClips(gc1Truth), "s017", "s016"];
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
      clips: (get) => {
        const { earlyWaveRole, earlyWaveTruth } = waveTimings(get);
        const ids = waveClips(earlyWaveRole, earlyWaveTruth);
        return ids.length ? ids : null;
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
        return parts.length ? parts.join("。") : null;
      },
      clips: (get) => {
        const { lateGcRole, lateGcTruth } = gcTimings(get);
        const { osoActive, osoTruth } = accelTimings(get);
        return [
          ...raiMizuClips(lateGcRole, lateGcTruth),
          ...(osoActive ? accelClips(osoTruth) : []),
          "s018",
          "s016",
        ];
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
      clips: (get) => {
        const gc2Truth = get("gc2_role") as Choice;
        const ids = jusoClips(gc2Truth);
        return ids.length ? ids : null;
      },
    },
    {
      key: "magicOut",
      atSec: t("magicOut"),
      label: "マジックアウト＋混沌（遅）",
      // 混沌（遅）＝後半の つなみ/ほのお（タケノコ/ドーナツ）を読み上げ。
      // readSanBuri が ON のときのみ、サンダガ/ブリザガの踏む/踏まないも読み上げる。
      text: (get) => {
        const parts: string[] = [];
        const { lateWaveRole, lateWaveTruth } = waveTimings(get);
        const w = simplify(tsunamiHonooAction(lateWaveRole, lateWaveTruth));
        if (w) parts.push(w);
        if (readSanBuri) {
          // 踏む（final==="gi"）だけを読み上げる。踏まない・未確定は出さない。
          const { tStep, bStep } = magicSteps(get);
          if (tStep && bStep) parts.push("サンダガブリザガ両方踏む");
          else if (tStep) parts.push("サンダガ踏む");
          else if (bStep) parts.push("ブリザガ踏む");
        }
        return parts.length ? parts.join("。") : null;
      },
      clips: (get) => {
        const { lateWaveRole, lateWaveTruth } = waveTimings(get);
        const ids = [...waveClips(lateWaveRole, lateWaveTruth)];
        if (readSanBuri) {
          // 踏む（gi）だけ: 両方→[s017,s018,s019,s020] / サンダガ→[s017,s020] /
          // ブリザガ→[s018,s020] / 無し→[]
          const { tStep, bStep } = magicSteps(get);
          if (tStep && bStep) ids.push("s017", "s018", "s019", "s020");
          else if (tStep) ids.push("s017", "s020");
          else if (bStep) ids.push("s018", "s020");
        }
        return ids.length ? ids : null;
      },
    },
  ];
}
