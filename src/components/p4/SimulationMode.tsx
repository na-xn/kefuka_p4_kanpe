import { useEffect, useRef, useState } from "react";
import { Play, RotateCcw, FastForward, Gauge, CheckCircle, XCircle } from "lucide-react";
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

/**
 * 練習モード（シミュレーション）。ソロ用・バックエンドなし。
 *
 * 「お題開始」で generateSim() のお題を生成し、実戦タイムに沿って席0の割当を
 * 順次リビール（t=8/16/24/32/40）。t=50（または「処理へスキップ」）で
 * toMinState(setup,0) を MinState 化し、既存 <MinimumMode> で処理タイムラインを表示する。
 *
 * 入力モード:
 *   auto   — 自動でカンペに反映（従来動作）。
 *   manual — 自分でポチポチ入力し、「答え合わせ」で正誤チェック。
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

export function SimulationMode() {
  const [setup, setSetup] = useState<SimSetup | null>(null);
  const [startedAt, setStartedAt] = useState<number | null>(null);
  const [now, setNow] = useState(0);
  const [phase, setPhase] = useState<"idle" | "playing" | "process">("idle");
  const [minState, setMinState] = useState<MinState>(INITIAL_MIN);
  const [speed, setSpeed] = useState(1); // 1 | 2（スケジュールを speed で割る）
  const [inputMode, setInputMode] = useState<InputMode>(loadInputMode);
  /** 答え合わせ結果（manual モードで「答え合わせ」ボタン後にセット）。 */
  const [compareResult, setCompareResult] = useState<FieldCompare[] | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const stop = () => {
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
  };
  useEffect(() => stop, []);

  // playing 中は startedAt を基準に ~5x/秒 で経過秒を刻む。
  useEffect(() => {
    if (phase !== "playing" || startedAt == null) return;
    const id = setInterval(() => {
      setNow((Date.now() - startedAt) / 1000);
    }, 200);
    timerRef.current = id;
    return () => clearInterval(id);
  }, [phase, startedAt]);

  const changeInputMode = (m: InputMode) => {
    setInputMode(m);
    saveInputMode(m);
  };

  /** 新しいお題を生成して実戦タイム開始。 */
  const start = () => {
    stop();
    const s = generateSim();
    setSetup(s);
    setMinState(INITIAL_MIN);
    setCompareResult(null);
    const t0 = Date.now();
    setStartedAt(t0);
    setNow(0);
    setPhase("playing");
  };

  /** アイドルへ戻す（お題/タイマー/処理状態をクリア）。 */
  const reset = () => {
    stop();
    setSetup(null);
    setStartedAt(null);
    setNow(0);
    setMinState(INITIAL_MIN);
    setCompareResult(null);
    setPhase("idle");
  };

  /** 処理フェーズへ。タイマー停止。auto なら MinState を自動充填、manual なら空欄のまま。 */
  const toProcess = (s: SimSetup) => {
    stop();
    if (inputMode === "auto") {
      setMinState(toMinState(s, 0));
    } else {
      setMinState({ ...INITIAL_MIN });
      setCompareResult(null);
    }
    setPhase("process");
  };

  // speed を反映した経過秒（リビール/しきい値判定に使う）。
  const elapsed = now * speed;

  // playing 中、t=PROCESS_AT_SEC を超えたら自動で処理フェーズへ。
  useEffect(() => {
    if (phase === "playing" && setup && elapsed >= PROCESS_AT_SEC) {
      toProcess(setup);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase, setup, elapsed]);

  // --- アイドル ---
  if (phase === "idle" || !setup) {
    return (
      <div className="flex flex-col items-center gap-3 py-6">
        <div className="px-2 text-center text-xs text-muted-foreground">
          <p className="font-bold text-foreground">練習モード（シミュレーション）</p>
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

  const schedule = buildRevealSchedule(setup);

  // --- 処理フェーズ（解決ビュー） ---
  if (phase === "process") {
    const correct = toMinState(setup, 0);

    const handleCompare = () => {
      setCompareResult(compareMinState(minState, correct));
    };

    const handleFillCorrect = () => {
      setMinState(correct);
      setCompareResult(compareMinState(correct, correct));
    };

    const handleRetry = () => {
      setMinState({ ...INITIAL_MIN });
      setCompareResult(null);
    };

    return (
      <div className="flex flex-col gap-2">
        <div className="flex items-center justify-between px-0.5">
          <span className="text-xs font-bold text-muted-foreground">処理タイムライン</span>
          <Button variant="default" size="xs" onClick={start}>
            <RotateCcw /> 新しいお題
          </Button>
        </div>
        {/* 割当サマリ（コンパクト） */}
        <div className="flex flex-wrap gap-1.5">
          {schedule.map((r) => (
            <SummaryChip key={r.key} row={r} />
          ))}
        </div>
        <div className="border-t" />
        <MinimumMode
          value={minState}
          set={(id, v) => setMinState((s) => ({ ...s, [id]: v }))}
        />

        {/* manual モード専用: 答え合わせ + 結果パネル */}
        {inputMode === "manual" && (
          <div className="flex flex-col gap-2">
            <div className="border-t" />
            {compareResult == null ? (
              <Button
                variant="default"
                className="h-11 w-full font-bold"
                onClick={handleCompare}
              >
                答え合わせ
              </Button>
            ) : (
              <>
                <ComparePanel results={compareResult} />
                <div className="flex gap-2">
                  <Button
                    variant="secondary"
                    className="h-10 flex-1 text-sm font-bold"
                    onClick={handleFillCorrect}
                  >
                    正解を入れる
                  </Button>
                  <Button
                    variant="outline"
                    className="h-10 flex-1 text-sm font-bold"
                    onClick={handleRetry}
                  >
                    もう一度
                  </Button>
                  <Button
                    variant="default"
                    className="h-10 flex-1 text-sm font-bold"
                    onClick={start}
                  >
                    <RotateCcw className="size-4" /> 新しいお題
                  </Button>
                </div>
              </>
            )}
          </div>
        )}
      </div>
    );
  }

  // --- 実戦タイム（playing） ---
  const revealed = schedule.filter((r) => elapsed >= r.atSec / 1);
  const progress = Math.min(1, elapsed / PROCESS_AT_SEC);
  const mm = Math.floor(elapsed / 60);
  const ss = Math.floor(elapsed % 60);

  return (
    <div className="flex flex-col gap-2">
      {/* 入力モード表示（playing 中も lit で表示） */}
      <InputModeToggle mode={inputMode} onChange={changeInputMode} compact />

      {/* 経過クロック + 進捗 */}
      <div className="flex items-center justify-between px-0.5">
        <span className="inline-flex items-center gap-1 text-xs font-bold tabular-nums text-foreground">
          <Gauge className="size-3.5 shrink-0" />
          {mm}:{String(ss).padStart(2, "0")}
        </span>
        <span className="text-[10px] text-muted-foreground">
          {speed}x ・ {revealed.length}/{schedule.length}
        </span>
      </div>
      <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
        <div
          className="h-full rounded-full bg-primary transition-all"
          style={{ width: `${progress * 100}%` }}
        />
      </div>

      {/* リビール行（到来順に表示・既出は残る） */}
      <div className="flex flex-col gap-1.5">
        {revealed.length === 0 ? (
          <p className="px-2 py-3 text-center text-xs text-muted-foreground">
            実戦タイム開始… デバフが付くのを待っています。
          </p>
        ) : (
          revealed.map((r) => <RevealCard key={r.key} row={r} />)
        )}
      </div>

      {/* 操作 */}
      <div className="mt-1 flex items-center gap-2">
        <Button variant="secondary" className="h-11 flex-1 text-sm font-bold" onClick={() => toProcess(setup)}>
          <FastForward className="size-4" /> 処理へスキップ
        </Button>
        <Button variant="destructive" size="icon" className="h-11 w-11" onClick={reset} aria-label="新しいお題">
          <RotateCcw />
        </Button>
      </div>
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
          {mode === "auto"
            ? "自動でカンペに反映"
            : "自分で入力して答え合わせ"}
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

/** リビール1行（アイコン＋見出し＋ラベル＋真偽）。 */
function RevealCard({ row }: { row: RevealRow }) {
  return (
    <div className="flex items-center gap-2 rounded-md border bg-card/40 px-2 py-1.5">
      <img src={row.icon} alt="" className="h-6 w-auto shrink-0 rounded-[2px]" draggable={false} />
      <div className="flex min-w-0 flex-1 flex-col">
        <span className="text-[10px] font-semibold text-muted-foreground">{row.caption}</span>
        <span className="truncate text-xs font-bold text-foreground">{row.label}</span>
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
