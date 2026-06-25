import { useEffect, useState } from "react";
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
import { generateSim, toMinState } from "@/p4/simulation";
import type { SimSetup } from "@/p4/simulation";
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
import type { SessionApi, SeatSlot } from "@/p4/session";

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

/** プレイするロール（TH=席0相当 / DPS=席4相当）。ソロ/セッション共通で永続化。 */
type PlayRole = "TH" | "DPS";

const PLAY_ROLE_KEY = "playRole";

function loadPlayRole(): PlayRole {
  try {
    const v = localStorage.getItem(PLAY_ROLE_KEY);
    if (v === "TH" || v === "DPS") return v;
  } catch {
    // ignore
  }
  return "TH";
}

function savePlayRole(r: PlayRole) {
  try {
    localStorage.setItem(PLAY_ROLE_KEY, r);
  } catch {
    // ignore
  }
}

type SimMode = "solo" | "session";

/** 練習モードのトップ。ソロ/セッションの選択と画面切替を行う。 */
export function SimulationMode() {
  const [mode, setMode] = useState<SimMode>("solo");
  // プレイロール（TH/DPS）はソロ・セッション両方で共有・永続化する。
  const [playRole, setPlayRole] = useState<PlayRole>(loadPlayRole);

  const changePlayRole = (r: PlayRole) => {
    setPlayRole(r);
    savePlayRole(r);
  };

  return (
    <div className="flex flex-col gap-2">
      <ModePicker mode={mode} onChange={setMode} />
      <PlayRolePicker role={playRole} onChange={changePlayRole} />
      {mode === "solo" ? (
        <SoloRunner playRole={playRole} />
      ) : (
        <SessionRunner playRole={playRole} />
      )}
    </div>
  );
}

/** TH/DPS のロール切替セグメント（ModePicker と同じ見た目）。 */
function PlayRolePicker({
  role,
  onChange,
}: {
  role: PlayRole;
  onChange: (r: PlayRole) => void;
}) {
  return (
    <div className="flex justify-center">
      <div className="flex rounded-lg border overflow-hidden">
        {(["TH", "DPS"] as PlayRole[]).map((r) => (
          <button
            key={r}
            type="button"
            onClick={() => onChange(r)}
            className={`px-4 py-1.5 text-xs font-bold transition-colors ${
              role === r
                ? "bg-primary text-primary-foreground"
                : "bg-transparent text-muted-foreground hover:text-foreground"
            }`}
          >
            {r}
          </button>
        ))}
      </div>
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

function SoloRunner({ playRole }: { playRole: PlayRole }) {
  const [soloKind, setSoloKind] = useState<SoloKind>("kanpe");

  return (
    <div className="flex flex-col gap-2">
      <SoloKindPicker kind={soloKind} onChange={setSoloKind} />
      {soloKind === "kanpe" ? <KanpeRunner /> : <PlayRunner playRole={playRole} />}
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
function PlayRunner({ playRole }: { playRole: PlayRole }) {
  // 操作プレイ中はキー操作のためフォーカス可能にする（デスクトップ）。
  useOverlayFocus(true);
  // ロール → 席（TH=0 / DPS=4）。アリーナ判定もカンペも同じ席で扱う。
  const seat = playRole === "TH" ? 0 : 4;
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
      {/* 広い画面では アリーナ（大・左）とカンペ入力（細・右）を横並び、狭い/モバイルでは縦積み。
          サンダガ/ブリザガより下の導出タイムラインは下部全幅へ分離する。 */}
      <div className="flex flex-col gap-2 md:flex-row">
        {/* 左カラム: アリーナ（大きく伸びる。canvas はコンテナにスケール）。 */}
        <div className="min-w-0 flex-1">
          <PlayArena setup={setup} seat={seat} startAt={startAt} onNewTopic={start} />
        </div>
        {/* 右カラム: 自分で書き込むカンペ「入力」のみ（細幅固定。アリーナのキー/ポインタ操作とは独立）。
            導出タイムラインは下部に分離するので view="input"。 */}
        <div className="shrink-0 border-t pt-2 md:w-[230px] md:basis-[230px] md:border-l md:border-t-0 md:pl-2 md:pt-0">
          <p className="px-0.5 pb-1 text-[10px] font-semibold text-muted-foreground">
            カンペ入力（デバフが付いたら入力）
          </p>
          <MinimumMode
            view="input"
            value={minState}
            set={(id, v) => setMinState((s) => ({ ...s, [id]: v }))}
          />
        </div>
      </div>
      {/* 下部全幅: サンダガ/ブリザガより下の導出処理タイムライン。 */}
      <div className="border-t pt-2">
        <MinimumMode
          view="timeline"
          value={minState}
          set={(id, v) => setMinState((s) => ({ ...s, [id]: v }))}
        />
      </div>
    </div>
  );
}

/** ソロ・カンペ練習（従来動作・1バイトも挙動を変えない）。 */
function KanpeRunner() {
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
      seat={0}
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

// セッションのプレイロールは「共有・永続化」要件のみ（トップのトグルが担う）。
// セッション席は mySeat のままで、ロール由来の席変更は後フェーズで対応する。
function SessionRunner(_props: { playRole: PlayRole }) {
  // セッション中の練習状態。
  const [setup, setSetup] = useState<SimSetup | null>(null);
  const [startedAt, setStartedAt] = useState<number | null>(null);
  const [phase, setPhase] = useState<"idle" | "playing" | "process">("idle");
  const [inputMode, setInputMode] = useState<InputMode>(loadInputMode);

  const changeInputMode = (m: InputMode) => {
    setInputMode(m);
    saveInputMode(m);
  };

  // start 受信: 各クライアントが受信時刻 + startInMs を開始時刻とする（簡易同期）。
  const session = useSession({
    onStart: ({ setup: s, startInMs }) => {
      setSetup(s);
      setStartedAt(Date.now() + startInMs);
      setPhase("playing");
    },
    onReset: () => {
      setSetup(null);
      setStartedAt(null);
      setPhase("idle");
    },
  });

  // ロビー入力。
  const [sessionId, setSessionId] = useState("");
  const [name, setName] = useState("");

  const joined = session.status === "joined";

  // 未参加（セッションID/名前の入力画面）の間だけフォーカス可能に（デスクトップ）。
  useOverlayFocus(!joined);

  // 未接続 or 練習が始まっていない → ロビー。
  if (!joined || phase === "idle" || setup == null || startedAt == null) {
    return (
      <SessionLobby
        session={session}
        sessionId={sessionId}
        setSessionId={setSessionId}
        name={name}
        setName={setName}
        onStart={() => {
          // ホストのみ: お題生成して 3秒リードで全員へ送る（onStart で各自開始）。
          const s = generateSim();
          session.sendStart(s, 3000);
        }}
        inputMode={inputMode}
        onChangeInputMode={changeInputMode}
      />
    );
  }

  // mySeat は joined 時に必ず存在。
  const seat = session.mySeat ?? 0;

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

/** セッションのロビー（接続前 + ロスター待機）。 */
function SessionLobby({
  session,
  sessionId,
  setSessionId,
  name,
  setName,
  onStart,
  inputMode,
  onChangeInputMode,
}: {
  session: SessionApi;
  sessionId: string;
  setSessionId: (s: string) => void;
  name: string;
  setName: (s: string) => void;
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
          <Button
            variant="default"
            className="h-11 w-full text-sm font-bold"
            disabled={!sessionId.trim() || !name.trim() || connecting}
            onClick={() => session.connect(sessionId.trim(), name.trim() || "Player")}
          >
            <Wifi className="size-4" /> {connecting ? "接続中…" : "参加"}
          </Button>
          {session.status === "full" && (
            <p className="text-center text-[11px] text-destructive">
              満席です（8人）。別のIDで試してください。
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
      <InputModeToggle mode={inputMode} onChange={onChangeInputMode} compact />
      <p className="px-0.5 text-[11px] font-bold text-muted-foreground">参加者（8席）</p>
      <RosterList roster={session.roster} />
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

/** 8席ロスター表示（占有/NPC・★ホスト・あなた）。 */
function RosterList({ roster }: { roster: SeatSlot[] }) {
  return (
    <div className="grid grid-cols-2 gap-1">
      {roster.map((slot) => (
        <div
          key={slot.seat}
          className={`flex items-center gap-1.5 rounded-md border px-2 py-1 text-[11px] ${
            slot.occupied && slot.isMe
              ? "border-primary bg-primary/10"
              : "bg-card/40"
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
      ))}
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
