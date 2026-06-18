import { useEffect, useRef, useState } from "react";
import { X, Lock, LockOpen, RotateCcw, ChevronLeft } from "lucide-react";
import { Button } from "@/components/ui/button";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { LogicalSize } from "@tauri-apps/api/dpi";
import { getVersion } from "@tauri-apps/api/app";
import { openUrl } from "@tauri-apps/plugin-opener";
import { EventCard } from "@/components/p4/EventCard";
import { ProcessFlow } from "@/components/p4/ProcessFlow";
import { INPUT_EVENTS } from "@/p4/events";
import type { State, Phase, MenuState } from "@/p4/types";
import {
  buildSpeechSteps,
  speak,
  stopSpeak,
  primeSpeech,
  startKeepAlive,
  stopKeepAlive,
  stepImpactSec,
  resetSec,
  setSpeechVolume,
  setSpeechLogger,
  DEFAULT_TIMINGS,
} from "@/p4/speech";
import type { SpeechLogEntry } from "@/p4/speech";
import { register, unregister } from "@tauri-apps/plugin-global-shortcut";

const REPO = "na-xn/kefuka_p4_kanpe";
const RELEASES_URL = `https://github.com/${REPO}/releases/latest`;

/** "v0.4.1" 等を数値配列に。 */
function parseVer(s: string): number[] {
  return s.replace(/^v/i, "").split(".").map((n) => parseInt(n, 10) || 0);
}
/** latest が current より新しいか。 */
function isNewer(latest: string, current: string): boolean {
  const a = parseVer(latest);
  const b = parseVer(current);
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    const x = a[i] || 0;
    const y = b[i] || 0;
    if (x !== y) return x > y;
  }
  return false;
}

type UpdateState =
  | { s: "idle" }
  | { s: "checking" }
  | { s: "latest"; latest: string }
  | { s: "available"; latest: string }
  | { s: "error" };

/** 入力ウィザードのステップ構成: ①GC1+つなみ/ほのお1 ②GC2+つなみ/ほのお2 ③GC3 */
const STEP_GROUPS: string[][] = [
  ["gc1", "wave1"],
  ["gc2", "wave2"],
  ["gc3"],
];

const EVENT_BY_ID = Object.fromEntries(INPUT_EVENTS.map((e) => [e.id, e]));

/**
 * キー入力(F1〜F3)の選択肢。WebView2 は F キーをシステムキーとして横取りするため
 * アプリ内「記録」では F キーを拾えない。ドロップダウンで選ばせる（フォーカス不要）。
 * ゲームのホットバーと衝突する場合に備え、修飾キー付きの候補も用意。
 */
const KEY_CHOICES = [
  "F1", "F2", "F3", "F4", "F5", "F6", "F7", "F8", "F9", "F10", "F11", "F12",
  "Control+Shift+F1", "Control+Shift+F2", "Control+Shift+F3",
  "Control+Shift+1", "Control+Shift+2", "Control+Shift+3",
  "Alt+1", "Alt+2", "Alt+3",
  "Control+Shift+Z", "Control+Shift+X", "Control+Shift+C",
];

/** 読み上げ開始ホットキーの候補（修飾キー付きの単一キー。記録不可な F キーも選べる）。 */
const TTS_KEY_CHOICES = [
  "Control+Shift+F1", "Control+Shift+F2", "Control+Shift+F3", "Control+Shift+F4",
  "Control+Shift+F5", "Control+Shift+F6", "Control+Shift+F7", "Control+Shift+F8",
  "Control+Shift+F9", "Control+Shift+F10", "Control+Shift+F11", "Control+Shift+F12",
  "Control+Shift+R", "Control+Shift+Space", "Control+Shift+Enter",
];

/** 1イベント分の関連状態キー（自動確定の監視用）。 */
function eventKeys(id: string, state: State): string[] {
  if (id === "gc3") return ["gc3_role__role"];
  if (id === "gc1" || id === "gc2") {
    const n = id === "gc1" ? "1" : "2";
    const keys = [`gc${n}_role__role`, `gc${n}_role`];
    const r = state[`gc${n}_role__role`];
    // 担当=なし は加速度・呪詛 / 雷水は処理タイミング(早遅) も監視対象に含める
    if (r === "nashi") keys.push(`gc${n}_accel`, `gc${n}_juso`);
    if (r === "rai" || r === "mizu") keys.push(`gc${n}_when`);
    return keys;
  }
  if (id === "wave1" || id === "wave2") {
    const n = id === "wave1" ? "1" : "2";
    return [`wave${n}_type__role`, `wave${n}_type`, `wave${n}_when`];
  }
  return [];
}

/** ステップ（複数イベント）の関連キーをまとめて返す。 */
function relatedKeys(step: number, state: State): string[] {
  return (STEP_GROUPS[step] ?? []).flatMap((id) => eventKeys(id, state));
}

/** 1イベント分の必須未入力ラベル。 */
function eventMissing(id: string, get: (k: string) => string): string[] {
  const missing: string[] = [];
  const need = (k: string, l: string) => {
    if (!get(k)) missing.push(l);
  };
  if (id === "gc1" || id === "gc2") {
    const n = id === "gc1" ? "1" : "2";
    need(`gc${n}_role__role`, `GC${n} 担当`);
    need(`gc${n}_role`, `GC${n} 真偽`);
    const r = get(`gc${n}_role__role`);
    if (r === "nashi") {
      need(`gc${n}_accel`, `GC${n} 加速度（早/遅）`);
      need(`gc${n}_juso`, `GC${n} 呪詛（有/無）`);
    }
    if (r === "rai" || r === "mizu") {
      need(`gc${n}_when`, `GC${n} 水雷の処理（早/遅）`);
    }
  } else if (id === "wave1" || id === "wave2") {
    const n = id === "wave1" ? "1" : "2";
    need(`wave${n}_type__role`, `つなみ/ほのお${n} 種類`);
    need(`wave${n}_type`, `つなみ/ほのお${n} 真偽`);
    need(`wave${n}_when`, `つなみ/ほのお${n} 処理（早/遅）`);
  } else if (id === "gc3") {
    need("gc3_role__role", "GC3 担当（アラガン/死の超越）");
  }
  return missing;
}

export default function App() {
  const [state, setState] = useState<State>({});
  const [phase, setPhase] = useState<Phase>("input");
  const [inputStep, setInputStep] = useState(0);
  const [opacity, setOpacity] = useState(1);
  const [locked, setLocked] = useState(false);
  const [menu, setMenu] = useState<MenuState>(null);
  const [errors, setErrors] = useState<string[]>([]);
  const [autoConfirm, setAutoConfirm] = useState(false);
  const [autoConfirmSec, setAutoConfirmSec] = useState(1);
  const [hideEdgeSteps, setHideEdgeSteps] = useState(false); // ①生者の傷・⑧アルテマを隠す
  const [appVersion, setAppVersion] = useState("");
  const [update, setUpdate] = useState<UpdateState>({ s: "idle" });
  // 読み上げ（TTS）
  const [ttsOn, setTtsOn] = useState(false);
  const [readSanBuri, setReadSanBuri] = useState(false); // マジックアウトで踏む/踏まないを読み上げる
  const [ttsTimings, setTtsTimings] = useState<Record<string, number>>(DEFAULT_TIMINGS);
  const [showTtsSettings, setShowTtsSettings] = useState(false);
  const [ttsHotkey, setTtsHotkey] = useState("Control+Shift+F4");
  const [ttsVolume, setTtsVolume] = useState(1); // 読み上げ音量 0〜1
  const [showSpeechLog, setShowSpeechLog] = useState(false); // 読み上げログ表示
  const [speechLog, setSpeechLog] = useState<SpeechLogEntry[]>([]);
  // キー入力（位置キー F1/F2/F3 でアクティブ入力欄の1/2/3番目の選択肢を選ぶ）
  const [keyInputOn, setKeyInputOn] = useState(false);
  const [posKey1, setPosKey1] = useState("Control+Shift+F1");
  const [posKey2, setPosKey2] = useState("Control+Shift+F2");
  const [posKey3, setPosKey3] = useState("Control+Shift+F3");
  const [keyRegMsg, setKeyRegMsg] = useState(""); // キー登録の成否（診断表示）
  const [keyHit, setKeyHit] = useState(""); // 直近に受信した位置キー（発火診断）
  const keyHitTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const lastHeight = useRef(0);
  const ttsTimers = useRef<ReturnType<typeof setTimeout>[]>([]);
  const [ttsStartMs, setTtsStartMs] = useState<number | null>(null); // 読み上げ開始時刻
  const [elapsedSec, setElapsedSec] = useState(0); // 読み上げ開始からの経過秒
  // 最新の state を読み上げ発火時に参照するための ref
  const stateRef = useRef<State>(state);
  stateRef.current = state;

  // ウィンドウ高さをコンテンツに合わせて自動可変（最大＝画面高さ）。最大時のみ本体スクロール。
  useEffect(() => {
    const el = contentRef.current;
    if (!el) return;
    let raf = 0;
    const apply = () => {
      // ヘッダー(32) + 外周padding(12) + カード枠(2) + 本体padding(16) ≒ 62 + 余白
      const chrome = 64;
      const screenH = window.screen.availHeight || window.innerHeight;
      const target = Math.min(el.scrollHeight + chrome, screenH);
      if (Math.abs(target - lastHeight.current) < 2) return;
      lastHeight.current = target;
      try {
        // getCurrentWindow() は Tauri ランタイム外（ブラウザ）では同期例外を投げる
        getCurrentWindow()
          .setSize(new LogicalSize(window.innerWidth, Math.round(target)))
          .catch(() => {});
      } catch {
        /* ブラウザプレビュー等では無視 */
      }
    };
    const ro = new ResizeObserver(() => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(apply);
    });
    ro.observe(el);
    apply();
    return () => {
      ro.disconnect();
      cancelAnimationFrame(raf);
    };
  }, []);

  // 右クリックメニュー/設定パネルは縦長で小さい窓からはみ出すため、開いている間は窓を一時的に拡大。
  // 閉じたら内容に合わせて元の高さへ戻す。
  const grewRef = useRef(false);
  useEffect(() => {
    const open = !!menu || showTtsSettings;
    const screenH = window.screen.availHeight || window.innerHeight;
    try {
      const win = getCurrentWindow();
      if (open) {
        grewRef.current = true;
        const tall = Math.round(Math.min(screenH, 760));
        lastHeight.current = tall;
        win.setSize(new LogicalSize(window.innerWidth, tall)).catch(() => {});
      } else if (grewRef.current) {
        // 開いていたものを閉じたときだけ、内容高さへ戻す（初回マウントでは縮めない）。
        grewRef.current = false;
        const el = contentRef.current;
        const target = Math.min((el?.scrollHeight ?? 360) + 64, screenH);
        lastHeight.current = Math.round(target);
        win.setSize(new LogicalSize(window.innerWidth, Math.round(target))).catch(() => {});
      }
    } catch {
      /* ブラウザプレビュー等では無視 */
    }
  }, [menu, showTtsSettings]);

  // メニュー外クリック / Esc で閉じる
  useEffect(() => {
    if (!menu) return;
    const onDown = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setMenu(null);
    };
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setMenu(null);
    window.addEventListener("mousedown", onDown);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("mousedown", onDown);
      window.removeEventListener("keydown", onKey);
    };
  }, [menu]);

  const openMenu = (e: React.MouseEvent) => {
    e.preventDefault();
    const w = 184;
    // メニューは項目が多く縦長。なるべく上寄せで開き、入りきらなければ縦スクロール。
    const h = 480;
    setMenu({
      x: Math.min(e.clientX, window.innerWidth - w - 8),
      y: Math.max(8, Math.min(e.clientY, window.innerHeight - h - 8)),
    });
  };

  const closeWindow = async () => {
    try {
      await getCurrentWindow().close();
    } catch {
      /* ブラウザプレビューでは無視 */
    }
  };

  // 起動時に現在のアプリバージョンを取得（Tauri 外では空）。
  useEffect(() => {
    getVersion()
      .then(setAppVersion)
      .catch(() => {});
  }, []);

  // 読み上げ設定を localStorage から読み込み（初回のみ）。
  useEffect(() => {
    try {
      const on = localStorage.getItem("ttsOn");
      if (on != null) setTtsOn(on === "true");
      const rsb = localStorage.getItem("readSanBuri");
      if (rsb != null) setReadSanBuri(rsb === "true");
      const tm = localStorage.getItem("ttsTimings");
      if (tm) {
        let saved = JSON.parse(tm) as Record<string, number>;
        // 既存ユーザーの保存秒数も一度だけ 2 秒前倒し（新デフォルトに揃える）。
        if (localStorage.getItem("ttsTimingsShiftV2") !== "1") {
          saved = Object.fromEntries(
            Object.entries(saved).map(([k, v]) => [k, Math.max(0, Number(v) - 2)])
          );
        }
        setTtsTimings({ ...DEFAULT_TIMINGS, ...saved });
      }
      // 新規ユーザーは DEFAULT が既に前倒し済みなので shift 不要。フラグは必ず立てる。
      localStorage.setItem("ttsTimingsShiftV2", "1");
      const hk = localStorage.getItem("ttsHotkey");
      if (hk) setTtsHotkey(hk);
      const vol = localStorage.getItem("ttsVolume");
      if (vol != null) setTtsVolume(Math.max(0, Math.min(1, Number(vol))));
      const sl = localStorage.getItem("showSpeechLog");
      if (sl != null) setShowSpeechLog(sl === "true");
      const tk = localStorage.getItem("truthKeysOn");
      if (tk != null) setKeyInputOn(tk === "true");
      const pk1 = localStorage.getItem("posKey1");
      if (pk1) setPosKey1(pk1);
      const pk2 = localStorage.getItem("posKey2");
      if (pk2) setPosKey2(pk2);
      const pk3 = localStorage.getItem("posKey3");
      if (pk3) setPosKey3(pk3);
    } catch {
      /* 無視 */
    }
  }, []);

  // 読み上げ設定を localStorage に永続化。
  useEffect(() => {
    try {
      localStorage.setItem("ttsOn", String(ttsOn));
    } catch {
      /* 無視 */
    }
  }, [ttsOn]);
  useEffect(() => {
    try {
      localStorage.setItem("readSanBuri", String(readSanBuri));
    } catch {
      /* 無視 */
    }
  }, [readSanBuri]);
  useEffect(() => {
    try {
      localStorage.setItem("ttsTimings", JSON.stringify(ttsTimings));
    } catch {
      /* 無視 */
    }
  }, [ttsTimings]);
  useEffect(() => {
    try {
      localStorage.setItem("ttsHotkey", ttsHotkey);
    } catch {
      /* 無視 */
    }
  }, [ttsHotkey]);
  // 音量を speech モジュールへ反映＆永続化。
  useEffect(() => {
    setSpeechVolume(ttsVolume);
    try {
      localStorage.setItem("ttsVolume", String(ttsVolume));
    } catch {
      /* 無視 */
    }
  }, [ttsVolume]);
  useEffect(() => {
    try {
      localStorage.setItem("showSpeechLog", String(showSpeechLog));
    } catch {
      /* 無視 */
    }
  }, [showSpeechLog]);
  // 読み上げログの購読（speak() の各イベントを受信して蓄積、最新50件保持）。
  useEffect(() => {
    setSpeechLogger((e) => setSpeechLog((prev) => [...prev.slice(-49), e]));
    return () => setSpeechLogger(null);
  }, []);
  useEffect(() => {
    try {
      localStorage.setItem("truthKeysOn", String(keyInputOn));
    } catch {
      /* 無視 */
    }
  }, [keyInputOn]);
  useEffect(() => {
    try {
      localStorage.setItem("posKey1", posKey1);
    } catch {
      /* 無視 */
    }
  }, [posKey1]);
  useEffect(() => {
    try {
      localStorage.setItem("posKey2", posKey2);
    } catch {
      /* 無視 */
    }
  }, [posKey2]);
  useEffect(() => {
    try {
      localStorage.setItem("posKey3", posKey3);
    } catch {
      /* 無視 */
    }
  }, [posKey3]);

  // GitHub の最新リリースを確認。
  const checkUpdate = async () => {
    setUpdate({ s: "checking" });
    try {
      const res = await fetch(`https://api.github.com/repos/${REPO}/releases/latest`, {
        headers: { Accept: "application/vnd.github+json" },
      });
      if (!res.ok) throw new Error(String(res.status));
      const data = (await res.json()) as { tag_name?: string };
      const latest = (data.tag_name || "").replace(/^v/i, "");
      if (!latest) throw new Error("no tag");
      if (appVersion && isNewer(latest, appVersion)) {
        setUpdate({ s: "available", latest });
      } else {
        setUpdate({ s: "latest", latest });
      }
    } catch {
      setUpdate({ s: "error" });
    }
  };

  const openReleases = async () => {
    try {
      await openUrl(RELEASES_URL);
    } catch {
      window.open(RELEASES_URL, "_blank");
    }
  };

  const get = (key: string): string => state[key] ?? "";
  const set = (key: string, value: string) =>
    setState((s) => ({ ...s, [key]: value }));

  /** 全読み上げタイマーを解除し、発話を停止。 */
  const stopTts = () => {
    ttsTimers.current.forEach((t) => clearTimeout(t));
    ttsTimers.current = [];
    stopKeepAlive();
    stopSpeak();
    setTtsStartMs(null);
    setElapsedSec(0);
  };

  /** 現在時刻を 0:00 として読み上げスケジュールを開始。 */
  const startTts = () => {
    stopTts();
    startKeepAlive();
    setSpeechLog([]);
    setTtsStartMs(Date.now());
    setElapsedSec(0);
    const steps = buildSpeechSteps(ttsTimings, { readSanBuri });
    const getLatest = (k: string) => stateRef.current[k] ?? "";
    for (const step of steps) {
      // hideEdge のとき生者の傷ステップはスキップ
      if (step.edgeOnly && hideEdgeSteps) continue;
      const ms = Math.max(0, step.atSec) * 1000;
      const timer = setTimeout(() => {
        const text = step.text(getLatest);
        if (text) speak(text);
      }, ms);
      ttsTimers.current.push(timer);
    }
    // 全処理が終わったら ALLリセット（次の周回に備えて画面を初期化）。
    const reset = setTimeout(() => resetAllRef.current(), resetSec(ttsTimings) * 1000);
    ttsTimers.current.push(reset);
  };

  /**
   * 読み上げ開始トリガーの一本化。GC3担当選択・開始ボタン・ホットキーすべてここを呼ぶ。
   * 処理画面へ遷移すると phase 変化を拾った effect が読み上げを開始する。
   * 既に処理画面なら（ホットキー等）その場で 0:00 から再スタート。
   */
  const startTtsByTrigger = () => {
    if (phase === "process") startTts();
    else setPhase("process");
  };
  // ホットキーコールバックが古い closure を掴まないよう、最新の関数を ref で参照。
  const startTtsByTriggerRef = useRef(startTtsByTrigger);
  startTtsByTriggerRef.current = startTtsByTrigger;

  // 読み上げ中は経過秒を刻む（着弾済みステップの非活性化に使う）。
  useEffect(() => {
    if (ttsStartMs == null) return;
    const id = setInterval(() => {
      setElapsedSec((Date.now() - ttsStartMs) / 1000);
    }, 500);
    return () => clearInterval(id);
  }, [ttsStartMs]);

  // 着弾済み（読み上げ＋5秒経過）の処理ステップ番号。
  const passedSteps =
    ttsStartMs == null
      ? []
      : Object.entries(stepImpactSec(ttsTimings))
          .filter(([, sec]) => elapsedSec >= sec)
          .map(([idx]) => Number(idx));

  const resetAll = () => {
    stopTts();
    setState({});
    setErrors([]);
    setInputStep(0);
    setPhase("input");
  };
  // 読み上げタイマー（最後のリセット）から最新の resetAll を呼ぶための ref。
  const resetAllRef = useRef(resetAll);
  resetAllRef.current = resetAll;

  // 処理画面に遷移したら読み上げを開始、処理画面を離れたら停止。
  useEffect(() => {
    if (phase === "process") {
      if (ttsOn) startTts();
    } else {
      stopTts();
    }
    // アンマウント時も停止
    return () => {
      if (phase !== "process") stopTts();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase]);

  // 読み上げ ON で音声エンジンをウォームアップ（初回遅延対策）、OFF で即停止。
  useEffect(() => {
    if (ttsOn) primeSpeech();
    else stopTts();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ttsOn]);

  // グローバルホットキー登録: ttsOn && ttsHotkey のとき登録、依存変化/OFF/アンマウントで解除。
  // Tauri 外（ブラウザ）や重複登録では例外になり得るので try/catch で握りつぶす。
  useEffect(() => {
    if (!ttsOn || !ttsHotkey) return;
    (async () => {
      try {
        await register(ttsHotkey, (e) => {
          if (e.state === "Pressed") startTtsByTriggerRef.current();
        });
      } catch {
        /* Tauri 外 / 重複登録 などは無視 */
      }
    })();
    return () => {
      unregister(ttsHotkey).catch(() => {});
    };
  }, [ttsOn, ttsHotkey]);

  // キー入力のグローバルホットキー登録: keyInputOn のとき posKey1/2/3 を登録、
  // OFF/キー変更/アンマウントで解除。ttsHotkey と同じ作法（try/catch・最新ハンドラは ref）。
  useEffect(() => {
    if (!keyInputOn) {
      setKeyRegMsg("");
      return;
    }
    const keys: string[] = [];
    const ok: string[] = [];
    const ng: string[] = [];
    const reg = async (accel: string, idx: 1 | 2 | 3) => {
      if (!accel) return;
      try {
        // 既に登録済みなら一旦解除してから登録（取りこぼし防止）
        await unregister(accel).catch(() => {});
        await register(accel, (e) => {
          if (e.state === "Pressed") chooseAtCursorRef.current(idx);
        });
        keys.push(accel);
        ok.push(accel);
      } catch (err) {
        ng.push(`${accel}(${String(err).slice(0, 24)})`);
      }
    };
    (async () => {
      await reg(posKey1, 1);
      await reg(posKey2, 2);
      await reg(posKey3, 3);
      setKeyRegMsg(ng.length ? `登録失敗: ${ng.join(", ")}` : `登録OK: ${ok.join(" ")}`);
    })();
    return () => {
      for (const k of keys) unregister(k).catch(() => {});
    };
  }, [keyInputOn, posKey1, posKey2, posKey3]);

  /** 現在の入力ステップ（複数イベント）の必須未入力を検証。不足ラベルの配列を返す。 */
  const validateStep = (step: number): string[] =>
    (STEP_GROUPS[step] ?? []).flatMap((id) => eventMissing(id, get));

  // ①⑧を隠す設定のときは GC3 ステップ（最後）も入力ウィザードから省く。
  const activeStepGroups = hideEdgeSteps ? STEP_GROUPS.slice(0, -1) : STEP_GROUPS;

  // --- キー入力: 画面の入力欄を順序通りに列挙したフィールド記述子 ---
  // values=位置順の選択肢値（F1→values[0]…） / filled=入力済み / choose(idx)=values[idx]を反映。
  type Field = { id: string; values: string[]; filled: boolean; choose: (idx: number) => void };
  const fieldOrder = (g: (k: string) => string): Field[] => {
    // 入力フェーズは「真偽を先（GC真偽→つなみ/ほのお真偽）」、その後に担当・早遅・種類・呪詛。
    const truth: Field[] = [];
    const rest: Field[] = [];
    const mk = (
      id: string,
      values: string[],
      filled: boolean,
      choose: (idx: number) => void
    ): Field => ({ id, values, filled, choose });

    const gcFields = (n: "1" | "2") => {
      const roleKey = `gc${n}_role__role`;
      const role = g(roleKey);
      const isGc2 = n === "2";
      const gc1Role = g("gc1_role__role");
      // GC2 の側（GC1の担当に応じ自動排他）
      const gc2Side = !isGc2
        ? null
        : !gc1Role
        ? "wait"
        : gc1Role === "nashi"
        ? "raimizu"
        : "nashi";
      if (gc2Side === "wait") return; // GC1未入力なら何も列挙しない
      // 真偽（先頭グループ）
      truth.push(
        mk(`gc${n}_role`, ["shin", "gi"], g(`gc${n}_role`) !== "", (idx) =>
          set(`gc${n}_role`, ["shin", "gi"][idx])
        )
      );
      // 担当（GC2加速度固定側は省略）
      if (gc2Side !== "nashi") {
        const values = gc2Side === "raimizu" ? ["rai", "mizu"] : ["rai", "mizu", "accel"];
        rest.push(
          mk(roleKey, values, role !== "", (idx) => {
            const v = values[idx];
            if (v === "rai" || v === "mizu") {
              set(roleKey, v);
              if (g(`gc${n}_accel`)) set(`gc${n}_accel`, "");
            } else {
              set(roleKey, "nashi");
              if (g(`gc${n}_when`)) set(`gc${n}_when`, "");
            }
          })
        );
      }
      const isNashi = role === "nashi";
      const isRaiMizu = role === "rai" || role === "mizu";
      if (isNashi || isRaiMizu) {
        const earlyKey = isNashi ? `gc${n}_accel` : `gc${n}_when`;
        rest.push(
          mk(`gc${n}_early`, ["haya", "oso"], g(earlyKey) !== "", (idx) =>
            set(earlyKey, ["haya", "oso"][idx])
          )
        );
      }
      if (isNashi) {
        rest.push(
          mk(`gc${n}_juso`, ["yes", "no"], g(`gc${n}_juso`) !== "", (idx) =>
            set(`gc${n}_juso`, ["yes", "no"][idx])
          )
        );
      }
    };

    const waveFields = (n: "1" | "2") => {
      const typeRoleKey = `wave${n}_type__role`;
      // 真偽（先頭グループ）→ 種類・早遅は後ろ
      truth.push(
        mk(`wave${n}_type`, ["shin", "gi"], g(`wave${n}_type`) !== "", (idx) =>
          set(`wave${n}_type`, ["shin", "gi"][idx])
        )
      );
      rest.push(
        mk(typeRoleKey, ["honoo", "tsunami"], g(typeRoleKey) !== "", (idx) =>
          set(typeRoleKey, ["honoo", "tsunami"][idx])
        )
      );
      // wave2 の早遅は自動設定なので順序に含めない
      if (n === "1") {
        rest.push(
          mk(`wave${n}_when`, ["haya", "oso"], g(`wave${n}_when`) !== "", (idx) =>
            set(`wave${n}_when`, ["haya", "oso"][idx])
          )
        );
      }
    };

    if (phase === "process") {
      const proc: Field[] = [];
      if (!hideEdgeSteps)
        proc.push(
          mk("gc3_mu", ["shin", "gi"], g("gc3_mu") !== "", (idx) =>
            set("gc3_mu", ["shin", "gi"][idx])
          )
        );
      proc.push(
        mk("magic_thunda", ["shin", "gi"], g("magic_thunda") !== "", (idx) =>
          set("magic_thunda", ["shin", "gi"][idx])
        )
      );
      proc.push(
        mk("magic_blizza", ["shin", "gi"], g("magic_blizza") !== "", (idx) =>
          set("magic_blizza", ["shin", "gi"][idx])
        )
      );
      proc.push(
        mk("magic_out_false", ["rai", "koori", "both"], g("magic_out_false") !== "", (idx) =>
          set("magic_out_false", ["rai", "koori", "both"][idx])
        )
      );
      return proc;
    }

    // 入力フェーズ
    for (const id of activeStepGroups[inputStep] ?? []) {
      if (id === "gc1") gcFields("1");
      else if (id === "gc2") gcFields("2");
      else if (id === "wave1") waveFields("1");
      else if (id === "wave2") waveFields("2");
      else if (id === "gc3")
        rest.push(
          mk("gc3_role__role", ["aragan", "shi"], g("gc3_role__role") !== "", (idx) =>
            set("gc3_role__role", ["aragan", "shi"][idx])
          )
        );
    }
    // 真偽（GC→つなみ/ほのお）を先に、その他を後ろに。
    return [...truth, ...rest];
  };

  // アクティブ欄＝最初に filled=false の欄。全部埋まっていれば null。
  const activeFieldKey: string | null = (() => {
    const first = fieldOrder(get).find((fd) => !fd.filled);
    return first ? first.id : null;
  })();
  // keyInputOn が false のときは強調しない（null 扱い）。
  const shownActiveFieldKey = keyInputOn ? activeFieldKey : null;

  /** 最新stateで最初の未入力欄を取り、values[n-1] があれば choose(n-1)。 */
  const chooseAtCursor = (n: 1 | 2 | 3) => {
    const g = (k: string) => stateRef.current[k] ?? "";
    const first = fieldOrder(g).find((fd) => !fd.filled);
    // キーが届いたことを画面に可視化（発火診断）。欄が無くても受信は表示。
    const flash = first
      ? first.values[n - 1] !== undefined
        ? `F${n}受信 → ${first.id}`
        : `F${n}受信（${n}番目の選択肢なし）`
      : `F${n}受信（入力欄なし）`;
    setKeyHit(flash);
    if (keyHitTimer.current) clearTimeout(keyHitTimer.current);
    keyHitTimer.current = setTimeout(() => setKeyHit(""), 1800);
    if (!first) return;
    if (first.values[n - 1] !== undefined) first.choose(n - 1);
  };
  // ホットキーコールバックが古い closure を掴まないよう、最新の関数を ref で参照。
  const chooseAtCursorRef = useRef(chooseAtCursor);
  chooseAtCursorRef.current = chooseAtCursor;

  // hideEdge 切替で現在ステップが範囲外になったらクランプ。
  useEffect(() => {
    if (inputStep > activeStepGroups.length - 1) {
      setInputStep(activeStepGroups.length - 1);
    }
  }, [activeStepGroups.length, inputStep]);

  /** 現在ステップの確定処理（検証して次へ。最終ステップなら処理フェーズへ）。 */
  const confirmStep = () => {
    const missing = validateStep(inputStep);
    if (missing.length > 0) {
      setErrors(missing);
      return;
    }
    setErrors([]);
    if (inputStep >= activeStepGroups.length - 1) {
      // 読み上げON & ①⑧非表示 → 「開始」ボタン画面を挟む（押下を 0:00 とする）。
      // それ以外（読み上げOFF / 読み上げON&①⑧表示）→ そのまま処理画面へ。
      //   ①⑧表示時の 0:00 は GC3 担当選択トリガー(別 effect)が拾うため、
      //   確定ボタンで process に来たときは既に読み上げ開始済み。
      if (ttsOn && hideEdgeSteps) {
        setPhase("start");
      } else {
        setPhase("process");
      }
    } else {
      setInputStep((s) => s + 1);
    }
  };

  const goBackStep = () => {
    if (inputStep > 0) {
      setErrors([]);
      setInputStep((s) => s - 1);
    }
  };

  // 自動確定: 入力フェーズ & autoConfirm ON のとき、現在ステップの関連キーに
  // 何か値が入っていれば autoConfirmSec 秒後に確定処理を実行（入力ごとにデバウンス）。
  const stepKeys = relatedKeys(inputStep, state);
  const stepValid = validateStep(inputStep).length === 0;
  const stepValues = stepKeys.map((k) => get(k)).join(" ");
  useEffect(() => {
    if (!autoConfirm || phase !== "input" || !stepValid) return;
    const hasInput = stepValues.split(" ").some((v) => v !== "");
    if (!hasInput) return;
    const ms = Math.max(1, Math.min(60, autoConfirmSec)) * 1000;
    const t = setTimeout(() => confirmStep(), ms);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoConfirm, phase, inputStep, autoConfirmSec, stepValid, stepValues]);

  // GC3 担当選択トリガー（読み上げON & ①⑧表示）:
  // 入力フェーズの最終ステップ(GC3)で gc3_role__role が設定された瞬間を 0:00 とし、
  // 処理画面へ遷移して読み上げを開始する。
  const gc3Role = state["gc3_role__role"] ?? "";
  useEffect(() => {
    if (!ttsOn || hideEdgeSteps) return;
    if (phase !== "input") return;
    if (inputStep !== activeStepGroups.length - 1) return;
    if (!gc3Role) return;
    startTtsByTrigger();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ttsOn, hideEdgeSteps, phase, inputStep, gc3Role]);

  const dragProps = locked ? {} : { "data-tauri-drag-region": true };

  return (
    <div
      className="flex h-screen w-screen items-center justify-center bg-transparent p-1.5"
      onContextMenu={openMenu}
    >
      <div
        className="flex h-full w-full flex-col overflow-hidden rounded-xl border bg-background shadow-lg"
        style={{ opacity }}
      >
        {/* ヘッダー兼ドラッグバー */}
        <div
          {...dragProps}
          className="flex h-8 shrink-0 items-center justify-between gap-2 border-b px-2"
        >
          {phase === "process" ? (
            <Button
              variant="secondary"
              size="xs"
              onClick={() => setPhase("input")}
              className="shrink-0"
            >
              <ChevronLeft />
              判定を編集
            </Button>
          ) : (
            <span
              {...dragProps}
              className="flex min-w-0 items-center gap-1.5 truncate text-xs font-bold select-none"
            >
              <img
                src="/icon/kefuka.png"
                alt=""
                className="size-4 shrink-0 rounded-[3px]"
                draggable={false}
              />
              絶妖星乱舞 P4 真偽判定
            </span>
          )}
          <div className="flex items-center gap-1">
            <Button variant="destructive" size="xs" onClick={resetAll}>
              <RotateCcw />
              ALLリセット
            </Button>
            <Button
              variant="ghost"
              size="icon-xs"
              onClick={() => setLocked((l) => !l)}
              aria-label={locked ? "位置ロック解除" : "位置ロック"}
              title={locked ? "位置ロック中" : "位置ロック"}
            >
              {locked ? <Lock /> : <LockOpen />}
            </Button>
            <Button variant="ghost" size="icon-xs" onClick={closeWindow} aria-label="閉じる">
              <X />
            </Button>
          </div>
        </div>

        {/* 本体（高さはウィンドウ自動可変。最大時のみスクロール） */}
        <div className="flex-1 overflow-y-auto px-2 py-2">
          <div ref={contentRef}>
          {phase === "input" ? (
            <div className="flex flex-col gap-2">
              {/* 進捗表示 */}
              <div className="flex items-center justify-between px-0.5">
                <span className="text-xs font-bold text-muted-foreground">
                  判定 {inputStep + 1} / {activeStepGroups.length}
                </span>
                {autoConfirm && (
                  <span className="text-[11px] text-muted-foreground">
                    ⏱ 自動確定 ON（{autoConfirmSec}秒）
                  </span>
                )}
              </div>

              {(activeStepGroups[inputStep] ?? []).map((id, i) => (
                <EventCard
                  key={id}
                  index={i + 1}
                  event={EVENT_BY_ID[id]}
                  get={get}
                  set={set}
                  activeFieldKey={shownActiveFieldKey}
                />
              ))}

              {errors.length > 0 && (
                <div className="mt-1 rounded-md border border-destructive/50 bg-destructive/10 px-2 py-1.5 text-destructive">
                  <p className="text-xs font-bold">未入力の項目があります:</p>
                  <ul className="mt-1 list-disc pl-4 text-[11px]">
                    {errors.map((e) => (
                      <li key={e}>{e}</li>
                    ))}
                  </ul>
                </div>
              )}

              <div className="mt-1 flex items-center gap-2">
                {inputStep > 0 && (
                  <Button
                    variant="secondary"
                    className="h-11 shrink-0 text-sm font-bold"
                    onClick={goBackStep}
                  >
                    ← 戻る
                  </Button>
                )}
                <Button
                  variant="default"
                  className="h-11 flex-1 text-sm font-bold"
                  onClick={confirmStep}
                >
                  {inputStep >= activeStepGroups.length - 1 ? "確定 → 処理フローへ →" : "確定 →"}
                </Button>
              </div>
            </div>
          ) : phase === "start" ? (
            <div className="flex flex-col items-center gap-3 py-6">
              <p className="px-2 text-center text-xs text-muted-foreground">
                GC3 のデバフが付いた瞬間に「開始」を押してください。
                <br />
                押した時刻を 0:00 として読み上げが始まります。
              </p>
              <Button
                variant="default"
                className="h-16 w-40 text-lg font-bold"
                onClick={startTtsByTrigger}
              >
                ▶ 開始
              </Button>
            </div>
          ) : (
            <ProcessFlow
              get={get}
              set={set}
              hideEdge={hideEdgeSteps}
              passedSteps={passedSteps}
              activeFieldKey={shownActiveFieldKey}
            />
          )}

          {/* 読み上げログ（診断用。右クリックメニューで表示切替） */}
          {showSpeechLog && (
            <div className="mt-2 rounded-md border bg-card/40 p-2">
              <div className="mb-1 flex items-center justify-between text-[11px] font-bold text-muted-foreground">
                <span>📜 読み上げログ</span>
                <button
                  type="button"
                  onClick={() => setSpeechLog([])}
                  className="rounded border bg-background px-1.5 py-0.5 text-[10px] hover:bg-accent"
                >
                  クリア
                </button>
              </div>
              {speechLog.length === 0 ? (
                <p className="text-[10px] text-muted-foreground/70">
                  読み上げ開始後にここへ発話の記録が出ます。
                </p>
              ) : (
                <ul className="flex max-h-40 flex-col gap-0.5 overflow-y-auto text-[10px] leading-tight">
                  {speechLog.map((e, i) => (
                    <li key={i} className="flex gap-1.5">
                      <span className="shrink-0 tabular-nums text-muted-foreground">
                        {ttsStartMs != null
                          ? `${((e.atMs - ttsStartMs) / 1000).toFixed(1)}s`
                          : "-"}
                      </span>
                      <span
                        className={`shrink-0 font-bold ${
                          e.event === "失敗"
                            ? "text-red-500"
                            : e.event === "開始"
                            ? "text-green-600"
                            : e.event === "再試行" || e.event === "詰まり解消"
                            ? "text-amber-500"
                            : "text-foreground"
                        }`}
                      >
                        {e.event}
                      </span>
                      <span className="min-w-0 flex-1 truncate text-muted-foreground">
                        {e.text}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}
          </div>
        </div>
      </div>

      {/* キー受信インジケータ（発火診断: グローバルキーが届いたか可視化） */}
      {keyInputOn && keyHit && (
        <div className="pointer-events-none fixed left-1/2 top-1 z-[70] -translate-x-1/2 rounded bg-primary px-2 py-0.5 text-[10px] font-bold text-primary-foreground shadow">
          🎹 {keyHit}
        </div>
      )}

      {/* 右クリックメニュー: 透過度スライダー */}
      {menu && (
        <div
          ref={menuRef}
          className="fixed z-50 overflow-y-auto rounded-lg border bg-popover p-2 text-popover-foreground shadow-xl"
          style={{
            left: menu.x,
            top: menu.y,
            width: 184,
            maxHeight: `calc(100vh - ${menu.y + 12}px)`,
          }}
          onContextMenu={(e) => e.preventDefault()}
        >
          <div className="mb-1.5 flex items-center justify-between text-[11px] font-medium text-muted-foreground">
            <span>透過度</span>
            <span className="tabular-nums">{Math.round(opacity * 100)}%</span>
          </div>
          <input
            type="range"
            min={0.2}
            max={1}
            step={0.05}
            value={opacity}
            onChange={(e) => setOpacity(Number(e.target.value))}
            className="w-full accent-primary"
          />

          {/* 自動確定 */}
          <div className="mt-2 border-t pt-2">
            <label className="flex cursor-pointer items-center justify-between text-[11px] font-medium text-muted-foreground">
              <span>自動確定</span>
              <input
                type="checkbox"
                checked={autoConfirm}
                onChange={(e) => setAutoConfirm(e.target.checked)}
                className="size-3.5 accent-primary"
              />
            </label>
            <div className="mt-1.5 flex items-center justify-between gap-2 text-[11px] text-muted-foreground">
              <input
                type="number"
                min={1}
                max={60}
                value={autoConfirmSec}
                onChange={(e) =>
                  setAutoConfirmSec(
                    Math.max(1, Math.min(60, Number(e.target.value) || 1))
                  )
                }
                className="w-12 rounded border bg-background px-1 py-0.5 text-right tabular-nums text-foreground"
              />
              <span>秒後に自動確定</span>
            </div>
          </div>

          {/* 処理画面の表示オプション */}
          <div className="mt-2 border-t pt-2">
            <label className="flex cursor-pointer items-center justify-between text-[11px] font-medium text-muted-foreground">
              <span>①生者の傷・⑧アルテマを隠す</span>
              <input
                type="checkbox"
                checked={hideEdgeSteps}
                onChange={(e) => setHideEdgeSteps(e.target.checked)}
                className="size-3.5 accent-primary"
              />
            </label>
          </div>

          {/* 読み上げ（TTS） */}
          <div className="mt-2 border-t pt-2">
            <label className="flex cursor-pointer items-center justify-between text-[11px] font-medium text-muted-foreground">
              <span>読み上げ</span>
              <input
                type="checkbox"
                checked={ttsOn}
                onChange={(e) => setTtsOn(e.target.checked)}
                className="size-3.5 accent-primary"
              />
            </label>
            <button
              type="button"
              onClick={() => {
                setShowTtsSettings(true);
                setMenu(null);
              }}
              className="mt-1.5 w-full rounded border bg-background px-2 py-1 text-[11px] text-foreground hover:bg-accent"
            >
              ⚙ 設定
            </button>
            <label className="mt-1.5 flex cursor-pointer items-center justify-between text-[11px] font-medium text-muted-foreground">
              <span>マジックアウトで踏む/踏まないを読み上げる</span>
              <input
                type="checkbox"
                checked={readSanBuri}
                onChange={(e) => setReadSanBuri(e.target.checked)}
                className="size-3.5 accent-primary"
              />
            </label>
            <label className="mt-1.5 flex cursor-pointer items-center justify-between text-[11px] font-medium text-muted-foreground">
              <span>読み上げログを表示</span>
              <input
                type="checkbox"
                checked={showSpeechLog}
                onChange={(e) => setShowSpeechLog(e.target.checked)}
                className="size-3.5 accent-primary"
              />
            </label>
            {ttsOn && (
              <p className="mt-1 text-[10px] text-muted-foreground">
                開始ホットキー: <span className="tabular-nums">{ttsHotkey || "(未設定)"}</span>
              </p>
            )}
          </div>

          {/* キー入力（F1〜F3 でアクティブ入力欄の選択肢を選ぶ） */}
          <div className="mt-2 border-t pt-2">
            <label className="flex cursor-pointer items-center justify-between text-[11px] font-medium text-muted-foreground">
              <span>キー入力（F1〜F3）</span>
              <input
                type="checkbox"
                checked={keyInputOn}
                onChange={(e) => setKeyInputOn(e.target.checked)}
                className="size-3.5 accent-primary"
              />
            </label>
            {keyInputOn && keyRegMsg && (
              <p
                className={`mt-1 text-[10px] ${
                  keyRegMsg.startsWith("登録失敗") ? "text-red-500" : "text-green-600"
                }`}
              >
                {keyRegMsg}
              </p>
            )}
            {keyInputOn && (
              <p className="mt-1 text-[10px] text-muted-foreground">
                キーの変更は「⚙ 設定」内。押すと上部に🎹受信表示。
              </p>
            )}
          </div>

          {/* 更新確認 */}
          <div className="mt-2 border-t pt-2">
            <div className="flex items-center justify-between gap-2">
              <Button
                variant="secondary"
                size="xs"
                onClick={checkUpdate}
                disabled={update.s === "checking"}
              >
                {update.s === "checking" ? "確認中…" : "更新を確認"}
              </Button>
              <span className="text-[10px] text-muted-foreground tabular-nums">
                {appVersion ? `v${appVersion}` : ""}
              </span>
            </div>
            {update.s === "latest" && (
              <p className="mt-1 text-[10px] text-muted-foreground">最新です（v{update.latest}）</p>
            )}
            {update.s === "error" && (
              <p className="mt-1 text-[10px] text-destructive">確認に失敗しました</p>
            )}
            {update.s === "available" && (
              <button
                type="button"
                onClick={openReleases}
                className="mt-1 w-full rounded bg-primary px-2 py-1 text-[11px] font-bold text-primary-foreground"
              >
                新バージョン v{update.latest} → ダウンロード
              </button>
            )}
          </div>
        </div>
      )}

      {/* 読み上げ秒数設定パネル（オーバーレイ） */}
      {showTtsSettings && (
        <div
          className="fixed inset-0 z-[60] flex items-center justify-center bg-black/50 p-3"
          onClick={() => setShowTtsSettings(false)}
          onContextMenu={(e) => e.preventDefault()}
        >
          <div
            className="w-full max-w-[300px] rounded-lg border bg-popover p-3 text-popover-foreground shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="mb-2 flex items-center justify-between">
              <span className="text-xs font-bold">読み上げ設定</span>
              <Button
                variant="ghost"
                size="icon-xs"
                onClick={() => setShowTtsSettings(false)}
                aria-label="閉じる"
              >
                <X />
              </Button>
            </div>
            {/* 音量 */}
            <div className="mb-2 rounded-md border bg-card/40 p-2">
              <div className="mb-1 flex items-center justify-between text-[11px] font-medium text-muted-foreground">
                <span>🔊 音量</span>
                <span className="tabular-nums">{Math.round(ttsVolume * 100)}%</span>
              </div>
              <input
                type="range"
                min={0}
                max={1}
                step={0.05}
                value={ttsVolume}
                onChange={(e) => setTtsVolume(Number(e.target.value))}
                className="w-full accent-primary"
              />
            </div>
            <p className="mb-2 text-[10px] text-muted-foreground">
              開始(0:00)から各処理までの秒数。
            </p>
            <div className="flex flex-col gap-1.5">
              {buildSpeechSteps(ttsTimings).map((step) => (
                <label
                  key={step.key}
                  className="flex items-center justify-between gap-2 text-[11px] text-muted-foreground"
                >
                  <span className="min-w-0 flex-1 truncate">{step.label}</span>
                  <input
                    type="number"
                    min={0}
                    max={600}
                    value={ttsTimings[step.key] ?? DEFAULT_TIMINGS[step.key] ?? 0}
                    onChange={(e) => {
                      const v = Math.max(0, Math.min(600, Number(e.target.value) || 0));
                      setTtsTimings((t) => ({ ...t, [step.key]: v }));
                    }}
                    className="w-14 shrink-0 rounded border bg-background px-1 py-0.5 text-right tabular-nums text-foreground"
                  />
                </label>
              ))}
            </div>
            {/* 開始ホットキー */}
            <div className="mt-3 border-t pt-2">
              <div className="flex items-center justify-between gap-2">
                <span className="min-w-0 flex-1 text-[11px] font-medium text-muted-foreground">
                  開始ホットキー（グローバル）
                </span>
                <select
                  value={ttsHotkey}
                  onChange={(e) => setTtsHotkey(e.target.value)}
                  className="shrink-0 rounded border bg-background px-2 py-1 text-[11px] tabular-nums text-foreground"
                >
                  {(TTS_KEY_CHOICES.includes(ttsHotkey)
                    ? TTS_KEY_CHOICES
                    : [ttsHotkey, ...TTS_KEY_CHOICES]
                  ).map((c) => (
                    <option key={c} value={c}>
                      {c}
                    </option>
                  ))}
                </select>
              </div>
              <p className="mt-1 text-[10px] text-muted-foreground">
                読み上げONのとき、このキーで処理画面へ移動し読み上げを開始します。
              </p>
            </div>

            {/* キー入力（F1〜F3 でアクティブ入力欄の選択肢を選ぶ） */}
            <div className="mt-3 border-t pt-2">
              <label className="flex cursor-pointer items-center justify-between text-[11px] font-medium text-muted-foreground">
                <span>キー入力</span>
                <input
                  type="checkbox"
                  checked={keyInputOn}
                  onChange={(e) => setKeyInputOn(e.target.checked)}
                  className="size-3.5 accent-primary"
                />
              </label>
              <p className="mt-1 text-[10px] text-muted-foreground">
                F1〜F3で、いまの入力欄(強調枠)の1/2/3番目の選択肢を選び順に進みます。
              </p>
              {keyInputOn && keyRegMsg && (
                <p
                  className={`mt-1 text-[10px] ${
                    keyRegMsg.startsWith("登録失敗") ? "text-red-500" : "text-green-600"
                  }`}
                >
                  {keyRegMsg}
                </p>
              )}

              {([
                { label: "キー1（1番目の選択肢）", val: posKey1, set: setPosKey1 },
                { label: "キー2（2番目の選択肢）", val: posKey2, set: setPosKey2 },
                { label: "キー3（3番目の選択肢）", val: posKey3, set: setPosKey3 },
              ]).map((k) => {
                const opts = KEY_CHOICES.includes(k.val) ? KEY_CHOICES : [k.val, ...KEY_CHOICES];
                return (
                  <div key={k.label} className="mt-2 flex items-center justify-between gap-2">
                    <span className="min-w-0 flex-1 text-[11px] font-medium text-muted-foreground">
                      {k.label}
                    </span>
                    <select
                      value={k.val}
                      onChange={(e) => k.set(e.target.value)}
                      className="shrink-0 rounded border bg-background px-2 py-1 text-[11px] tabular-nums text-foreground"
                    >
                      {opts.map((c) => (
                        <option key={c} value={c}>
                          {c}
                        </option>
                      ))}
                    </select>
                  </div>
                );
              })}
              <p className="mt-1.5 text-[10px] text-muted-foreground">
                ※記録ではなく選択式（WebView2 が F キーを横取りするため）。ON の間、選んだキーはゲーム側へ渡らないので、ホットバーと重複しないキーを推奨。
              </p>
            </div>

            <div className="mt-3 flex justify-end gap-2">
              <Button
                variant="secondary"
                size="xs"
                onClick={() => setTtsTimings(DEFAULT_TIMINGS)}
              >
                秒数を既定に戻す
              </Button>
              <Button variant="default" size="xs" onClick={() => setShowTtsSettings(false)}>
                閉じる
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
