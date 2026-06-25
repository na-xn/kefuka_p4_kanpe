import { useEffect, useRef, useState } from "react";
import {
  Play,
  RotateCcw,
  FastForward,
  Gauge,
  CheckCircle,
  XCircle,
  Zap,
  Snowflake,
  Users,
  Eye,
  Wifi,
  WifiOff,
  Crown,
  User,
  LogOut,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { MinimumMode, INITIAL_MIN } from "@/components/p4/MinimumMode";
import type { MinState } from "@/components/p4/MinimumMode";
import { generateSim, toMinState, seatJob } from "@/p4/simulation";
import type { SimSetup, Job } from "@/p4/simulation";
import {
  buildRevealSchedule,
  truthLabel,
  PROCESS_AT_SEC,
} from "@/p4/simSchedule";
import type { RevealRow } from "@/p4/simSchedule";
import { compareMinState } from "@/p4/simCompare";
import type { FieldCompare } from "@/p4/simCompare";
import { buildAnswerTimeline } from "@/p4/timeline";
import type { AnswerRow } from "@/p4/timeline";
import { useSession, setOverlayPassive } from "@/p4/session";
import type { SessionApi, SeatSlot, PlayKind } from "@/p4/session";

/**
 * Tauri デスクトップで、active の間だけウィンドウをフォーカス可能にする
 * （操作プレイ中・セッションID入力画面のみ）。アンマウント時はオーバーレイへ戻す。
 */
function useOverlayFocus(active: boolean) {
  useEffect(() => {
    setOverlayPassive(!active);
    return () => setOverlayPassive(true);
  }, [active]);
}

/** md(768px)以上の幅か（PC=横並び＋ドラッグ比率 / モバイル=縦積みの切替）。 */
function useIsWide() {
  const [wide, setWide] = useState(
    typeof window !== "undefined" && window.matchMedia
      ? window.matchMedia("(min-width: 768px)").matches
      : true,
  );
  useEffect(() => {
    if (typeof window === "undefined" || !window.matchMedia) return;
    const mq = window.matchMedia("(min-width: 768px)");
    const on = () => setWide(mq.matches);
    mq.addEventListener("change", on);
    return () => mq.removeEventListener("change", on);
  }, []);
  return wide;
}
import { PlayArena } from "@/components/p4/PlayArena";

/**
 * 練習モード（シミュレーション）。
 *
 * 「ソロ」: バックエンドなし。generateSim() のお題を生成し、席0視点で実戦タイムに
 * 沿ってリビール → 処理タイムライン。速度トグル(1x/2x)あり。
 *
 * 「セッション(8人)」: Cloudflare Durable Object へ WebSocket 接続。空席は NPC。
 * ホスト（最小席）が generateSim() でお題を作り、`start` で全員へブロードキャスト。
 * 各クライアントは自分の席視点で同じお題を回す。速度は 1x 固定（端末間の desync 回避）。
 */

type InputMode = "auto" | "manual";

const INPUT_MODE_KEY = "simInputMode";

function loadInputMode(): InputMode {
  try {
    const v = localStorage.getItem(INPUT_MODE_KEY);
    if (v === "auto" || v === "manual") return v;
  } catch {
    // ignore
  }
  return "auto";
}

function saveInputMode(m: InputMode) {
  try {
    localStorage.setItem(INPUT_MODE_KEY, m);
  } catch {
    // ignore
  }
}

const PLAY_JOB_KEY = "playJob";

function loadPlayJob(): Job {
  try {
    const v = localStorage.getItem(PLAY_JOB_KEY);
    if (v === "tank" || v === "healer" || v === "dps") return v;
  } catch {
    // ignore
  }
  return "tank";
}

function savePlayJob(j: Job) {
  try {
    localStorage.setItem(PLAY_JOB_KEY, j);
  } catch {
    // ignore
  }
}

type SimMode = "solo" | "session";

/** 練習モードのトップ。ソロ/セッションの選択と画面切替を行う。 */
export function SimulationMode() {
  const [mode, setMode] = useState<SimMode>("solo");
  const [playJob, setPlayJob] = useState<Job>(loadPlayJob);

  const changePlayJob = (j: Job) => {
    setPlayJob(j);
    savePlayJob(j);
  };

  return (
    <div className="flex flex-col gap-2">
      <ModePicker mode={mode} onChange={setMode} />
      {mode === "solo" ? (
        <SoloRunner playJob={playJob} onChangePlayJob={changePlayJob} />
      ) : (
        <SessionRunner />
      )}
    </div>
  );
}

/** ソロ/セッションの切替セグメント。 */
function ModePicker({
  mode,
  onChange,
}: {
  mode: SimMode;
  onChange: (m: SimMode) => void;
}) {
  return (
    <div className="flex justify-center">
      <div className="flex rounded-lg border overflow-hidden">
        {(["solo", "session"] as SimMode[]).map((m) => (
          <button
            key={m}
            type="button"
            onClick={() => onChange(m)}
            className={`px-4 py-1.5 text-xs font-bold transition-colors ${
              mode === m
                ? "bg-primary text-primary-foreground"
                : "bg-transparent text-muted-foreground hover:text-foreground"
            }`}
          >
            {m === "solo" ? "ソロ" : "セッション(8人)"}
          </button>
        ))}
      </div>
    </div>
  );
}

/* ============================================================
 * ソロ（従来動作・1バイトも挙動を変えない）
 * ========================================================== */

type SoloKind = "kanpe" | "play";

function SoloRunner({
  playJob,
  onChangePlayJob,
}: {
  playJob: Job;
  onChangePlayJob: (j: Job) => void;
}) {
  const [soloKind, setSoloKind] = useState<SoloKind>("kanpe");
  const seat = ({ tank: 0, healer: 2, dps: 4 } as Record<Job, number>)[playJob];

  return (
    <div className="flex flex-col gap-2">
      <JobPicker selected={playJob} onChange={onChangePlayJob} />
      <SoloKindPicker kind={soloKind} onChange={setSoloKind} />
      {soloKind === "kanpe" ? <KanpeRunner seat={seat} /> : <PlayRunner seat={seat} />}
    </div>
  );
}

/** ソロ内: カンペ練習 / 操作プレイ の切替セグメント。 */
function SoloKindPicker({
  kind,
  onChange,
}: {
  kind: SoloKind;
  onChange: (k: SoloKind) => void;
}) {
  return (
    <div className="flex justify-center">
      <div className="flex rounded-lg border overflow-hidden">
        {(["kanpe", "play"] as SoloKind[]).map((k) => (
          <button
            key={k}
            type="button"
            onClick={() => onChange(k)}
            className={`px-4 py-1.5 text-xs font-bold transition-colors ${
              kind === k
                ? "bg-primary text-primary-foreground"
                : "bg-transparent text-muted-foreground hover:text-foreground"
            }`}
          >
            {k === "kanpe" ? "カンペ練習" : "操作プレイ"}
          </button>
        ))}
      </div>
    </div>
  );
}

/** ソロ・操作プレイ: 円形アリーナでドットを動かして機構を処理する。 */
function PlayRunner({ seat }: { seat: number }) {
  // 操作プレイ中はキー操作のためフォーカス可能にする（デスクトップ）。
  useOverlayFocus(true);
  const [setup, setSetup] = useState<SimSetup | null>(null);
  const [startAt, setStartAt] = useState<number | null>(null);
  // プレイヤーが自分で書き込むカンペ（解答データから自動補完しない）。
  const [minState, setMinState] = useState<MinState>({ ...INITIAL_MIN });

  // 新しいお題（setup 変化）でカンペ入力をリセット。
  useEffect(() => {
    setMinState({ ...INITIAL_MIN });
  }, [setup]);

  const start = () => {
    setSetup(generateSim());
    setStartAt(Date.now());
  };

  // PC: アリーナとカンペ入力の比率（アリーナ %）をドラッグ仕切りで調整。
  const isWide = useIsWide();
  const rowRef = useRef<HTMLDivElement | null>(null);
  const pctRef = useRef(62);
  const dragging = useRef(false);
  const [arenaPct, setArenaPct] = useState(() => {
    const v = Number(localStorage.getItem("playArenaPct"));
    const pct = v >= 30 && v <= 85 ? v : 62;
    pctRef.current = pct;
    return pct;
  });
  const onSplitDown = (e: React.PointerEvent) => {
    dragging.current = true;
    (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
  };
  const onSplitMove = (e: React.PointerEvent) => {
    if (!dragging.current || !rowRef.current) return;
    const rect = rowRef.current.getBoundingClientRect();
    const pct = Math.max(30, Math.min(85, ((e.clientX - rect.left) / rect.width) * 100));
    pctRef.current = pct;
    setArenaPct(pct);
  };
  const onSplitUp = () => {
    if (!dragging.current) return;
    dragging.current = false;
    try {
      localStorage.setItem("playArenaPct", String(Math.round(pctRef.current)));
    } catch {
      // ignore
    }
  };
  const setMin = (id: string, v: string) =>
    setMinState((s) => ({ ...s, [id]: v }));

  if (!setup || startAt == null) {
    return (
      <div className="flex flex-col items-center gap-3 py-6">
        <div className="px-2 text-center text-xs text-muted-foreground">
          <p className="font-bold text-foreground">操作プレイ（ソロ）</p>
          <p className="mt-1">
            円形アリーナでドット（あなた＝席1相当）を動かし、実戦タイムラインの
            各機構の解決時刻に「正しい位置・移動・視線・色」に入れるか練習します。
            中央サンダガ/ブリザガ十字とセッション相乗りは後日対応。
          </p>
        </div>
        <Button variant="default" className="h-14 w-44 text-base font-bold" onClick={start}>
          <Play className="size-5" /> お題開始
        </Button>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-2">
      <div className="flex justify-end">
        <Button variant="default" size="xs" onClick={start}>
          <RotateCcw /> 新しいお題
        </Button>
      </div>
      {isWide ? (
        <>
          {/* PC: アリーナ｜ドラッグ仕切り｜カンペ入力（比率可変）。導出タイムラインは下部全幅。 */}
          <div ref={rowRef} className="flex items-stretch">
            <div className="min-w-0" style={{ width: `${arenaPct}%` }}>
              <PlayArena setup={setup} seat={seat} startAt={startAt} onNewTopic={start} />
            </div>
            <div
              onPointerDown={onSplitDown}
              onPointerMove={onSplitMove}
              onPointerUp={onSplitUp}
              title="ドラッグでアリーナとカンペの比率を調整"
              className="mx-1 w-1.5 shrink-0 cursor-col-resize self-stretch rounded bg-border transition-colors hover:bg-primary"
            />
            <div className="min-w-0 overflow-hidden" style={{ width: `${100 - arenaPct}%` }}>
              <p className="px-0.5 pb-1 text-[10px] font-semibold text-muted-foreground">
                カンペ入力（デバフが付いたら入力）
              </p>
              <MinimumMode view="input" value={minState} set={setMin} />
            </div>
          </div>
          <div className="border-t pt-2">
            <MinimumMode view="timeline" value={minState} set={setMin} />
          </div>
        </>
      ) : (
        <>
          {/* モバイル: アリーナの下にカンペ（入力＋導出タイムライン＝従来の下部全表示）。 */}
          <PlayArena setup={setup} seat={seat} startAt={startAt} onNewTopic={start} />
          <div className="border-t pt-2">
            <p className="px-0.5 pb-1 text-[10px] font-semibold text-muted-foreground">
              カンペ入力（デバフが付いたら入力）
            </p>
            <MinimumMode view="full" value={minState} set={setMin} />
          </div>
        </>
      )}
    </div>
  );
}

/** ソロ・カンペ練習（従来動作・1バイトも挙動を変えない）。 */
function KanpeRunner({ seat }: { seat: number }) {
  const [setup, setSetup] = useState<SimSetup | null>(null);
  const [startedAt, setStartedAt] = useState<number | null>(null);
  const [phase, setPhase] = useState<"idle" | "playing" | "process">("idle");
  const [inputMode, setInputMode] = useState<InputMode>(loadInputMode);
  const [speed, setSpeed] = useState(1); // 1 | 2

  const changeInputMode = (m: InputMode) => {
    setInputMode(m);
    saveInputMode(m);
  };

  /** 新しいお題を生成して実戦タイム開始。 */
  const start = () => {
    const s = generateSim();
    setSetup(s);
    const t0 = Date.now();
    setStartedAt(t0);
    setPhase("playing");
  };

  /** アイドルへ戻す。 */
  const reset = () => {
    setSetup(null);
    setStartedAt(null);
    setPhase("idle");
  };

  if (phase === "idle" || !setup || startedAt == null) {
    return (
      <div className="flex flex-col items-center gap-3 py-6">
        <div className="px-2 text-center text-xs text-muted-foreground">
          <p className="font-bold text-foreground">練習モード（ソロ）</p>
          <p className="mt-1">
            ソロ用のお題練習です。「お題開始」を押すと実戦タイムに沿って
            自分（席1相当）のデバフが順番に開示されます。
            t=50秒で処理タイムラインへ移ります。
          </p>
        </div>
        <InputModeToggle mode={inputMode} onChange={changeInputMode} />
        <SpeedToggle speed={speed} setSpeed={setSpeed} />
        <Button variant="default" className="h-14 w-44 text-base font-bold" onClick={start}>
          <Play className="size-5" /> お題開始
        </Button>
      </div>
    );
  }

  return (
    <PracticeRun
      setup={setup}
      seat={seat}
      startedAt={startedAt}
      setStartedAt={setStartedAt}
      phase={phase}
      setPhase={setPhase}
      inputMode={inputMode}
      onChangeInputMode={changeInputMode}
      speed={speed}
      onNewTopic={start}
      onAbort={reset}
      allowSkip
      allowSpeedHint
    />
  );
}

/* ============================================================
 * セッション(8人)
 * ========================================================== */

/** ジョブ枠のメタ（アイコン・ラベル・席数）。 */
const JOB_META: Record<Job, { label: string; icon: string; slots: number }> = {
  tank: { label: "Tank", icon: "/icon/TankRole.png", slots: 2 },
  healer: { label: "Healer", icon: "/icon/HealerRole.png", slots: 2 },
  dps: { label: "DPS", icon: "/icon/DPSRole.png", slots: 4 },
};

const JOB_ORDER: Job[] = ["tank", "healer", "dps"];

function SessionRunner() {
  // セッション中の練習状態。
  const [setup, setSetup] = useState<SimSetup | null>(null);
  const [startedAt, setStartedAt] = useState<number | null>(null);
  const [phase, setPhase] = useState<"idle" | "playing" | "process">("idle");
  const [inputMode, setInputMode] = useState<InputMode>(loadInputMode);
  // 受信したプレイ種別（ホストの選択が配信される）。
  const [runKind, setRunKind] = useState<PlayKind>("kanpe");
  // ロビーでホストが選ぶプレイ種別（kanpe/play）。
  const [sessionKind, setSessionKind] = useState<PlayKind>("kanpe");
  // 参加時に選ぶジョブ枠（tank/healer/dps）。
  const [selectedJob, setSelectedJob] = useState<Job>("dps");

  const changeInputMode = (m: InputMode) => {
    setInputMode(m);
    saveInputMode(m);
  };

  // 他席の実位置（seat → {x,y,fx,fy}）。ミュータブルに更新し PlayArena は毎フレーム参照。
  const posMapRef = useRef<Map<number, { x: number; y: number; fx: number; fy: number }>>(
    new Map(),
  );
  // 自席 pos の送信スロットル（~12Hz）。
  const lastSentRef = useRef(0);

  // start 受信: 各クライアントが受信時刻 + startInMs を開始時刻とする（簡易同期）。
  const session = useSession({
    onStart: ({ setup: s, startInMs, kind }) => {
      setSetup(s);
      setStartedAt(Date.now() + startInMs);
      setPhase("playing");
      setRunKind(kind);
      posMapRef.current.clear();
    },
    onReset: () => {
      setSetup(null);
      setStartedAt(null);
      setPhase("idle");
      posMapRef.current.clear();
    },
    onPos: ({ seat, x, y, fx, fy }) => {
      posMapRef.current.set(seat, { x, y, fx, fy });
    },
  });

  // ロビー入力。
  const [sessionId, setSessionId] = useState("");
  const [name, setName] = useState("");

  const joined = session.status === "joined";
  const playing = phase !== "idle";

  // フォーカス: 未参加（ID入力）か、操作プレイ中（キー操作が要る）の間だけ可能に。
  useOverlayFocus(!joined || (playing && runKind === "play"));

  // ロスター変化で、もう占有していない席の実位置を掃除する。
  useEffect(() => {
    const occ = new Set(
      session.roster.filter((s) => s.occupied).map((s) => s.seat),
    );
    for (const k of [...posMapRef.current.keys()]) {
      if (!occ.has(k)) posMapRef.current.delete(k);
    }
  }, [session.roster]);

  // 未接続 or 練習が始まっていない → ロビー。
  if (!joined || phase === "idle" || setup == null || startedAt == null) {
    return (
      <SessionLobby
        session={session}
        sessionId={sessionId}
        setSessionId={setSessionId}
        name={name}
        setName={setName}
        selectedJob={selectedJob}
        setSelectedJob={setSelectedJob}
        sessionKind={sessionKind}
        setSessionKind={setSessionKind}
        onStart={() => {
          // ホストのみ: お題生成して 3秒リードで全員へ送る（onStart で各自開始）。
          session.sendStart(generateSim(), 3000, sessionKind);
        }}
        inputMode={inputMode}
        onChangeInputMode={changeInputMode}
      />
    );
  }

  // mySeat は joined 時に必ず存在。
  const seat = session.mySeat ?? 0;

  // 操作プレイ: PlayArena でセッション相乗り。
  if (runKind === "play") {
    const occSet = new Set(
      session.roster.filter((s) => s.occupied).map((s) => s.seat),
    );
    const throttledSend = (x: number, y: number, fx: number, fy: number) => {
      const t = Date.now();
      if (t - lastSentRef.current < 80) return;
      lastSentRef.current = t;
      session.sendPos(x, y, fx, fy);
    };
    return (
      <div className="flex flex-col gap-2">
        <SessionStatusBar session={session} />
        <PlayArena
          setup={setup}
          seat={seat}
          startAt={startedAt}
          remotePositions={posMapRef.current}
          occupiedSeats={occSet}
          onLocalPos={throttledSend}
          onNewTopic={session.isHost ? () => session.sendReset() : undefined}
        />
      </div>
    );
  }

  // カンペ練習: 従来どおり PracticeRun。
  return (
    <div className="flex flex-col gap-2">
      <SessionStatusBar session={session} />
      <PracticeRun
        setup={setup}
        seat={seat}
        startedAt={startedAt}
        setStartedAt={setStartedAt}
        phase={phase}
        setPhase={setPhase}
        inputMode={inputMode}
        onChangeInputMode={changeInputMode}
        speed={1}
        // 新しいお題は「ホストのみ」reset → 全員ロビーへ。非ホストはボタンを出さない。
        onNewTopic={session.isHost ? () => session.sendReset() : undefined}
        onAbort={undefined}
        allowSkip={false}
        allowSpeedHint={false}
      />
    </div>
  );
}

/** 参加前のジョブ枠ピッカー（Tank/Healer/DPS をアイコン付きで選ぶ）。 */
function JobPicker({
  selected,
  onChange,
}: {
  selected: Job;
  onChange: (j: Job) => void;
}) {
  return (
    <div className="flex w-full gap-1.5">
      {JOB_ORDER.map((j) => {
        const meta = JOB_META[j];
        const active = selected === j;
        return (
          <button
            key={j}
            type="button"
            onClick={() => onChange(j)}
            className={`flex flex-1 flex-col items-center gap-1 rounded-md border px-2 py-2 text-xs font-bold transition-colors ${
              active
                ? "border-primary bg-primary/10 text-foreground"
                : "bg-card/40 text-muted-foreground hover:text-foreground"
            }`}
          >
            <img
              src={meta.icon}
              alt=""
              className="h-6 w-6"
              draggable={false}
              onError={(e) => {
                (e.currentTarget as HTMLImageElement).style.display = "none";
              }}
            />
            <span>{meta.label}</span>
          </button>
        );
      })}
    </div>
  );
}

/** ロビー内: カンペ練習 / 操作プレイ の切替（ホストのみ操作可）。 */
function SessionKindPicker({
  kind,
  onChange,
}: {
  kind: PlayKind;
  onChange: (k: PlayKind) => void;
}) {
  return (
    <div className="flex justify-center">
      <div className="flex rounded-lg border overflow-hidden">
        {(["kanpe", "play"] as PlayKind[]).map((k) => (
          <button
            key={k}
            type="button"
            onClick={() => onChange(k)}
            className={`px-4 py-1.5 text-xs font-bold transition-colors ${
              kind === k
                ? "bg-primary text-primary-foreground"
                : "bg-transparent text-muted-foreground hover:text-foreground"
            }`}
          >
            {k === "kanpe" ? "カンペ練習" : "操作プレイ"}
          </button>
        ))}
      </div>
    </div>
  );
}

/** セッションのロビー（接続前 + ロスター待機）。 */
function SessionLobby({
  session,
  sessionId,
  setSessionId,
  name,
  setName,
  selectedJob,
  setSelectedJob,
  sessionKind,
  setSessionKind,
  onStart,
  inputMode,
  onChangeInputMode,
}: {
  session: SessionApi;
  sessionId: string;
  setSessionId: (s: string) => void;
  name: string;
  setName: (s: string) => void;
  selectedJob: Job;
  setSelectedJob: (j: Job) => void;
  sessionKind: PlayKind;
  setSessionKind: (k: PlayKind) => void;
  onStart: () => void;
  inputMode: InputMode;
  onChangeInputMode: (m: InputMode) => void;
}) {
  const joined = session.status === "joined";

  if (!joined) {
    const connecting = session.status === "connecting";
    return (
      <div className="flex flex-col items-center gap-3 py-4">
        <div className="px-2 text-center text-xs text-muted-foreground">
          <p className="font-bold text-foreground">セッション練習（8人）</p>
          <p className="mt-1">
            同じ<strong>セッションID</strong>を共有して参加します。空席はNPC。
            最小席のホストが「開始」を押すと全員同時に同じお題を回せます。
          </p>
        </div>
        <div className="flex w-full max-w-xs flex-col gap-2">
          <input
            value={sessionId}
            onChange={(e) => setSessionId(e.target.value)}
            placeholder="セッションID（例: party1）"
            className="rounded-md border bg-background px-2 py-2 text-sm text-foreground"
          />
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="名前"
            className="rounded-md border bg-background px-2 py-2 text-sm text-foreground"
          />
          <p className="px-0.5 text-[11px] font-bold text-muted-foreground">
            ロール選択
          </p>
          <JobPicker selected={selectedJob} onChange={setSelectedJob} />
          <Button
            variant="default"
            className="h-11 w-full text-sm font-bold"
            disabled={!sessionId.trim() || !name.trim() || connecting}
            onClick={() =>
              session.connect(sessionId.trim(), name.trim() || "Player", selectedJob)
            }
          >
            <Wifi className="size-4" /> {connecting ? "接続中…" : "参加"}
          </Button>
          {session.status === "full" && (
            <p className="text-center text-[11px] text-destructive">
              {JOB_META[selectedJob].label}枠は満席です。別のロール/IDで試してください。
            </p>
          )}
          {session.status === "error" && (
            <p className="text-center text-[11px] text-destructive">
              接続に失敗しました。IDとネットワークを確認してください。
            </p>
          )}
        </div>
      </div>
    );
  }

  // 参加済み → ロスター + ホストの開始ボタン。
  return (
    <div className="flex flex-col gap-2 py-2">
      <SessionStatusBar session={session} />
      {session.isHost ? (
        <div className="flex flex-col items-center gap-1">
          <p className="text-[11px] font-bold text-muted-foreground">
            プレイ種別（ホスト）
          </p>
          <SessionKindPicker kind={sessionKind} onChange={setSessionKind} />
        </div>
      ) : (
        <p className="px-2 text-center text-[11px] text-muted-foreground">
          プレイ種別はホストが選びます。
        </p>
      )}
      {sessionKind === "kanpe" && (
        <InputModeToggle mode={inputMode} onChange={onChangeInputMode} compact />
      )}
      <p className="px-0.5 text-[11px] font-bold text-muted-foreground">参加者（8席）</p>
      <GroupedRoster roster={session.roster} />
      {session.isHost ? (
        <Button
          variant="default"
          className="h-12 w-full text-base font-bold"
          onClick={onStart}
        >
          <Play className="size-5" /> 開始（全員に配信）
        </Button>
      ) : (
        <p className="px-2 py-2 text-center text-xs text-muted-foreground">
          ホストの「開始」を待っています…
        </p>
      )}
    </div>
  );
}

/** 接続状態 + 退出ボタンの小バー。 */
function SessionStatusBar({ session }: { session: SessionApi }) {
  const occupied = session.roster.filter((s) => s.occupied).length;
  return (
    <div className="flex items-center justify-between rounded-md border bg-card/40 px-2 py-1">
      <span className="inline-flex items-center gap-1.5 text-[11px] font-bold text-foreground">
        {session.status === "joined" ? (
          <Wifi className="size-3.5 text-green-500" />
        ) : (
          <WifiOff className="size-3.5 text-muted-foreground" />
        )}
        {occupied}/8 接続
        {session.mySeat != null && (
          <span className="text-muted-foreground">・席{session.mySeat + 1}</span>
        )}
        {session.isHost && <Crown className="size-3.5 text-amber-500" />}
      </span>
      <Button variant="ghost" size="xs" onClick={session.disconnect} aria-label="退出">
        <LogOut className="size-3.5" /> 退出
      </Button>
    </div>
  );
}

/** ロスターをジョブ枠（Tank 2 / Healer 2 / DPS 4）でグループ表示。 */
function GroupedRoster({ roster }: { roster: SeatSlot[] }) {
  return (
    <div className="flex flex-col gap-1.5">
      {JOB_ORDER.map((job) => {
        const meta = JOB_META[job];
        const slots = roster.filter((s) => seatJob(s.seat) === job);
        const filled = slots.filter((s) => s.occupied).length;
        return (
          <div key={job} className="flex flex-col gap-1">
            <div className="flex items-center gap-1.5 px-0.5">
              <img
                src={meta.icon}
                alt=""
                className="h-4 w-4"
                draggable={false}
                onError={(e) => {
                  (e.currentTarget as HTMLImageElement).style.display = "none";
                }}
              />
              <span className="text-[11px] font-bold text-foreground">
                {meta.label}
              </span>
              <span className="text-[10px] tabular-nums text-muted-foreground">
                {filled}/{meta.slots}
              </span>
            </div>
            <div className="grid grid-cols-2 gap-1">
              {slots.map((slot) => (
                <RosterSlot key={slot.seat} slot={slot} />
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
}

/** ロスター1スロット（占有/NPC・★ホスト・あなた）。 */
function RosterSlot({ slot }: { slot: SeatSlot }) {
  return (
    <div
      className={`flex items-center gap-1.5 rounded-md border px-2 py-1 text-[11px] ${
        slot.occupied && slot.isMe ? "border-primary bg-primary/10" : "bg-card/40"
      }`}
    >
      <span className="w-8 shrink-0 font-bold tabular-nums text-muted-foreground">
        席{slot.seat + 1}
      </span>
      {slot.occupied ? (
        <>
          {slot.isHost ? (
            <Crown className="size-3.5 shrink-0 text-amber-500" />
          ) : (
            <User className="size-3.5 shrink-0 text-muted-foreground" />
          )}
          <span className="min-w-0 flex-1 truncate font-bold text-foreground">
            {slot.name}
          </span>
          {slot.isMe && (
            <span className="shrink-0 rounded bg-primary px-1 py-0.5 text-[9px] font-bold text-primary-foreground">
              あなた
            </span>
          )}
        </>
      ) : (
        <span className="min-w-0 flex-1 truncate text-muted-foreground/70">
          NPC（空席）
        </span>
      )}
    </div>
  );
}

/* ============================================================
 * 共有: 練習ラン（実戦タイム → 処理タイムライン）
 * ソロ/セッション両方がこの1本を席・速度・操作の差分だけで使う。
 * ========================================================== */

function PracticeRun({
  setup,
  seat,
  startedAt,
  setStartedAt,
  phase,
  setPhase,
  inputMode,
  onChangeInputMode,
  speed,
  onNewTopic,
  onAbort,
  allowSkip,
  allowSpeedHint,
}: {
  setup: SimSetup;
  seat: number;
  startedAt: number;
  setStartedAt: (n: number) => void;
  phase: "playing" | "process" | "idle";
  setPhase: (p: "playing" | "process" | "idle") => void;
  inputMode: InputMode;
  onChangeInputMode: (m: InputMode) => void;
  speed: number;
  /** 「新しいお題」操作（無いとボタン非表示）。 */
  onNewTopic?: () => void;
  /** 「中断」操作（無いとボタン非表示）。 */
  onAbort?: () => void;
  allowSkip: boolean;
  allowSpeedHint: boolean;
}) {
  const [now, setNow] = useState(0);
  const [minState, setMinState] = useState<MinState>(INITIAL_MIN);
  const [compareResult, setCompareResult] = useState<FieldCompare[] | null>(null);
  const [revealAll, setRevealAll] = useState(false);

  // お題が変わったら入力/採点/開示状態をリセット。
  useEffect(() => {
    setMinState({ ...INITIAL_MIN });
    setCompareResult(null);
    setRevealAll(false);
  }, [setup]);

  // 経過秒を刻む（playing / process 通して）。startedAt は未来時刻のこともある（セッションのリード）。
  useEffect(() => {
    if (phase !== "playing" && phase !== "process") return;
    const id = setInterval(() => {
      setNow((Date.now() - startedAt) / 1000);
    }, 200);
    return () => clearInterval(id);
  }, [phase, startedAt]);

  const elapsed = Math.max(0, now * speed);

  const toProcess = () => {
    setRevealAll(false);
    setPhase("process");
  };

  // playing 中 t>=PROCESS_AT_SEC で自動的に処理フェーズへ。
  useEffect(() => {
    if (phase === "playing" && elapsed >= PROCESS_AT_SEC) {
      setRevealAll(false);
      setPhase("process");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase, elapsed]);

  /** 処理へスキップ（クロックを 51秒へ進める。ソロのみ）。 */
  const skipToProcess = () => {
    setStartedAt(Date.now() - ((PROCESS_AT_SEC + 1) * 1000) / speed);
    toProcess();
  };

  const schedule = buildRevealSchedule(setup, seat);

  // --- 処理フェーズ ---
  if (phase === "process") {
    const correct = toMinState(setup, seat);
    const ordered = buildAnswerTimeline(setup, seat);
    const revealed = ordered.filter((it) => revealAll || elapsed >= it.sec);
    const upcoming = ordered.find((it) => !revealAll && elapsed < it.sec);
    const allShown = revealed.length === ordered.length;

    const mmP = Math.floor(elapsed / 60);
    const ssP = Math.floor(elapsed % 60);

    const handleCompare = () => {
      setCompareResult(compareMinState(minState, correct));
    };

    return (
      <div className="flex flex-col gap-2">
        <div className="flex items-center justify-between px-0.5">
          <span className="text-xs font-bold text-muted-foreground">処理タイムライン（解決）</span>
          {onNewTopic && (
            <Button variant="default" size="xs" onClick={onNewTopic}>
              <RotateCcw /> 新しいお題
            </Button>
          )}
        </div>

        <div className="flex items-center justify-between px-0.5">
          <span className="inline-flex items-center gap-1 text-xs font-bold tabular-nums text-foreground">
            <Gauge className="size-3.5 shrink-0" />
            {mmP}:{String(ssP).padStart(2, "0")}
          </span>
          <span className="text-[10px] text-muted-foreground">
            {allowSpeedHint && `${speed}x ・ `}
            {revealed.length}/{ordered.length}
            {upcoming && ` ・ 次 ${upcoming.sec}s`}
          </span>
        </div>

        <div className="flex flex-wrap gap-1.5">
          {schedule.map((r) => (
            <SummaryChip key={r.key} row={r} />
          ))}
        </div>
        <div className="border-t" />

        <div className="flex flex-col gap-1.5">
          {revealed.length === 0 ? (
            <p className="px-2 py-3 text-center text-xs text-muted-foreground">
              処理開始… 各アクションが処理時刻に順番に開示されます。
            </p>
          ) : (
            revealed.map((it) => <ResolvedRow key={it.key} item={it} />)
          )}
        </div>

        {!allShown && (
          <Button
            variant="secondary"
            className="h-10 w-full text-sm font-bold"
            onClick={() => setRevealAll(true)}
          >
            <FastForward className="size-4" /> 答えを全部表示
          </Button>
        )}

        {inputMode === "manual" && (
          <div className="flex flex-col gap-2">
            <div className="border-t" />
            {compareResult == null ? (
              <Button variant="default" className="h-11 w-full font-bold" onClick={handleCompare}>
                答え合わせ
              </Button>
            ) : (
              <>
                <ComparePanel results={compareResult} />
                {onNewTopic && (
                  <Button
                    variant="default"
                    className="h-10 w-full text-sm font-bold"
                    onClick={onNewTopic}
                  >
                    <RotateCcw className="size-4" /> 新しいお題
                  </Button>
                )}
              </>
            )}
          </div>
        )}
      </div>
    );
  }

  // --- 実戦タイム（playing） ---
  const revealed = schedule.filter((r) => elapsed >= r.atSec);
  const progress = Math.min(1, elapsed / PROCESS_AT_SEC);
  const mm = Math.floor(elapsed / 60);
  const ss = Math.floor(elapsed % 60);
  // セッションのリード中（startedAt が未来）はカウントダウン表示。
  const lead = Math.max(0, Math.ceil((startedAt - Date.now()) / 1000));

  return (
    <div className="flex flex-col gap-2">
      <InputModeToggle mode={inputMode} onChange={onChangeInputMode} compact />

      {lead > 0 && (
        <p className="rounded-md border border-primary/40 bg-primary/10 px-2 py-1 text-center text-xs font-bold text-foreground">
          開始まで {lead}…
        </p>
      )}

      <div className="flex items-center justify-between px-0.5">
        <span className="inline-flex items-center gap-1 text-xs font-bold tabular-nums text-foreground">
          <Gauge className="size-3.5 shrink-0" />
          {mm}:{String(ss).padStart(2, "0")}
        </span>
        <span className="text-[10px] text-muted-foreground">
          {allowSpeedHint && `${speed}x ・ `}
          {revealed.length}/{schedule.length}
        </span>
      </div>
      <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
        <div
          className="h-full rounded-full bg-primary transition-all"
          style={{ width: `${progress * 100}%` }}
        />
      </div>

      <div className="flex flex-col gap-1.5">
        {revealed.length === 0 ? (
          <p className="px-2 py-3 text-center text-xs text-muted-foreground">
            実戦タイム開始… デバフが付くのを待っています。
          </p>
        ) : (
          revealed.map((r) => <RevealCard key={r.key} row={r} elapsed={elapsed} />)
        )}
      </div>

      {inputMode === "manual" && (
        <>
          <div className="border-t" />
          <p className="px-0.5 text-[10px] font-semibold text-muted-foreground">
            カンペ入力（デバフが付いたら入力）
          </p>
          <MinimumMode
            value={minState}
            set={(id, v) => setMinState((s) => ({ ...s, [id]: v }))}
          />
        </>
      )}

      {(allowSkip || onAbort) && (
        <div className="mt-1 flex items-center gap-2">
          {allowSkip && (
            <Button
              variant="secondary"
              className="h-11 flex-1 text-sm font-bold"
              onClick={skipToProcess}
            >
              <FastForward className="size-4" /> 処理へスキップ
            </Button>
          )}
          {onAbort && (
            <Button
              variant="destructive"
              size="icon"
              className="h-11 w-11"
              onClick={onAbort}
              aria-label="中断"
            >
              <RotateCcw />
            </Button>
          )}
        </div>
      )}
    </div>
  );
}

/** 入力モードの切り替えセグメントコントロール。 */
function InputModeToggle({
  mode,
  onChange,
  compact = false,
}: {
  mode: InputMode;
  onChange: (m: InputMode) => void;
  compact?: boolean;
}) {
  return (
    <div className={`flex flex-col items-center gap-1 ${compact ? "" : ""}`}>
      <div className="flex rounded-lg border overflow-hidden">
        {(["auto", "manual"] as InputMode[]).map((m) => (
          <button
            key={m}
            type="button"
            onClick={() => onChange(m)}
            className={`px-3 py-1.5 text-xs font-bold transition-colors ${
              mode === m
                ? "bg-primary text-primary-foreground"
                : "bg-transparent text-muted-foreground hover:text-foreground"
            }`}
          >
            {m === "auto" ? "自動入力" : "手動入力"}
          </button>
        ))}
      </div>
      {!compact && (
        <p className="text-[10px] text-muted-foreground text-center max-w-xs">
          {mode === "auto" ? "自動でカンペに反映" : "自分で入力して答え合わせ"}
        </p>
      )}
    </div>
  );
}

/** 答え合わせ結果パネル。 */
function ComparePanel({ results }: { results: FieldCompare[] }) {
  const correct = results.filter((r) => r.ok).length;
  const total = results.length;

  return (
    <div className="flex flex-col gap-1.5 rounded-lg border bg-card/40 p-2">
      <div className="flex items-center justify-between px-0.5 pb-1">
        <span className="text-xs font-bold text-foreground">答え合わせ</span>
        <span
          className={`text-sm font-bold tabular-nums ${
            correct === total ? "text-green-500" : "text-destructive"
          }`}
        >
          {correct}/{total} 正解
        </span>
      </div>
      <div className="flex flex-col gap-1">
        {results.map((r) => (
          <CompareRow key={r.key} row={r} />
        ))}
      </div>
    </div>
  );
}

/** 答え合わせ1行。 */
function CompareRow({ row }: { row: FieldCompare }) {
  if (row.ok) {
    return (
      <div className="flex items-center gap-2 rounded-md border border-green-600/20 bg-green-500/10 px-2 py-1">
        <CheckCircle className="size-3.5 shrink-0 text-green-500" />
        <span className="text-[11px] font-semibold text-muted-foreground w-14 shrink-0">
          {row.label}
        </span>
        <span className="text-[11px] font-bold text-foreground">{row.your}</span>
      </div>
    );
  }
  return (
    <div className="flex items-center gap-2 rounded-md border border-destructive/40 bg-destructive/10 px-2 py-1">
      <XCircle className="size-3.5 shrink-0 text-destructive" />
      <span className="text-[11px] font-semibold text-muted-foreground w-14 shrink-0">
        {row.label}
      </span>
      <span className="text-[11px] font-bold text-destructive line-through">{row.your}</span>
      <span className="text-[10px] text-muted-foreground">→</span>
      <span className="text-[11px] font-bold text-foreground">{row.correct}</span>
    </div>
  );
}

/** 1x/2x スピードトグル。 */
function SpeedToggle({ speed, setSpeed }: { speed: number; setSpeed: (s: number) => void }) {
  return (
    <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
      <span>速度</span>
      {[1, 2].map((s) => (
        <button
          key={s}
          type="button"
          onClick={() => setSpeed(s)}
          className={`rounded-md border px-2 py-1 text-xs font-bold ${
            speed === s ? "border-primary bg-primary text-primary-foreground" : "opacity-40"
          }`}
        >
          {s}x
        </button>
      ))}
    </div>
  );
}

/** 処理フェーズの解決1行（読み取り専用）。 */
function ResolvedRow({ item }: { item: AnswerRow }) {
  return (
    <div className="flex items-center gap-2 rounded-md border bg-card/40 px-2 py-1.5">
      <span className="flex min-w-6 shrink-0 items-center justify-center gap-0.5">
        {item.icon ? (
          <img src={item.icon} alt="" className="h-5 w-auto rounded-[2px]" draggable={false} />
        ) : item.lucide === "zap" ? (
          <Zap className="size-5" />
        ) : item.lucide === "snow" ? (
          <Snowflake className="size-5" />
        ) : item.lucide === "users" ? (
          <Users className="size-5" />
        ) : (
          <Eye className="size-5" />
        )}
        {item.extraIcon && (
          <img src={item.extraIcon} alt="" className="h-5 w-auto rounded-[2px]" draggable={false} />
        )}
      </span>
      <span className="min-w-0 flex-1 truncate text-left text-xs font-bold text-foreground">
        {item.text || "—"}
      </span>
    </div>
  );
}

/** デバフ残り秒の表示。60s 以上は分表記(1m)で、59 になってから秒カウントダウン。 */
const fmtRemain = (s: number) => (s >= 60 ? `${Math.floor(s / 60)}m` : `${s}s`);

function RevealCard({ row, elapsed }: { row: RevealRow; elapsed: number }) {
  const remaining =
    row.resolveSec != null ? Math.max(0, Math.ceil(row.resolveSec - elapsed)) : null;
  return (
    <div className="flex items-center gap-2 rounded-md border bg-card/40 px-2 py-1.5">
      <img src={row.icon} alt="" className="h-6 w-auto shrink-0 rounded-[2px]" draggable={false} />
      <div className="flex min-w-0 flex-1 flex-col">
        <span className="text-[10px] font-semibold text-muted-foreground">{row.caption}</span>
        <span className="flex min-w-0 items-center gap-1.5">
          <span className="truncate text-xs font-bold text-foreground">{row.label}</span>
          {remaining != null && (
            <span className="shrink-0 tabular-nums text-[10px] text-muted-foreground">
              ⏱ {fmtRemain(remaining)}
            </span>
          )}
        </span>
      </div>
      {row.truth && (
        <span
          className={`shrink-0 rounded-md px-2 py-0.5 text-center text-xs font-bold ${
            row.truth === "shin" ? "bg-blue-600 text-white" : "bg-red-600 text-white"
          }`}
        >
          {truthLabel(row.truth)}
        </span>
      )}
    </div>
  );
}

/** 処理フェーズ上部の割当サマリ（小チップ）。 */
function SummaryChip({ row }: { row: RevealRow }) {
  return (
    <span className="inline-flex items-center gap-1 rounded-md border bg-card/40 px-1.5 py-1 text-[10px] font-bold">
      <img src={row.icon} alt="" className="h-4 w-auto rounded-[2px]" draggable={false} />
      <span className="text-foreground">{row.label}</span>
      {row.truth && (
        <span className={row.truth === "shin" ? "text-blue-500" : "text-red-500"}>
          {truthLabel(row.truth)}
        </span>
      )}
    </span>
  );
}
