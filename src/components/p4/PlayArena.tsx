import { useEffect, useRef, useState, useCallback } from "react";
import { Gauge } from "lucide-react";
import type { SimSetup, Truth } from "@/p4/simulation";
import { toMinState } from "@/p4/simulation";
import {
  ARENA_SIZE,
  CENTER,
  ARENA_RADIUS,
  PLAYER_RADIUS,
  ZONE_RADIUS,
  ZONES,
  AOE_CIRCLE_RADIUS,
  AOE_DONUT_INNER,
  AOE_DONUT_OUTER,
  THUNDER_STRIP_W,
  clampToArena,
  gc3BossPos,
  requiredAction,
  evaluate,
  centerAoeSafe,
  MECHANIC_SEC,
  type MechanicKey,
  type Point,
  type RequiredAction,
} from "@/p4/arena";

/**
 * 操作プレイ・アリーナ。
 *
 * 円形アリーナ上でドットを動かし、実戦タイムラインの各機構の解決秒に
 * 「正しい位置/移動/視線/色」に居るかを参照ジオメトリで判定する。
 * 参照 sim.html の LOOK（常時ボス + キャストバー / 真偽インジケータ /
 * デバフアイコンスタック / 寛容な AoE 予告 / 中央サンダガ・ブリザガ十字）を再現し、
 * t=0 から画面が空にならないようにする。
 *
 * props:
 *  - setup: 共有セットアップ（generateSim 由来）
 *  - seat:  自分の席（既定 0）
 *  - startAt: 開始時刻（ms epoch。同期クロック用。未指定なら mount 時刻）
 *  - onResult: 各機構の判定結果コールバック（任意）
 */

export type PlayResult = { key: MechanicKey; ok: boolean; reason: string; label: string };

type Props = {
  setup: SimSetup;
  seat?: number;
  startAt?: number;
  onResult?: (r: PlayResult) => void;
};

/** 機構の表示名。 */
const MECH_NAME: Record<MechanicKey, string> = {
  gc3: "GC3 分断",
  early: "早 水雷/加速度",
  juso1: "視線①",
  honoo: "ほのお/つなみ",
  late: "遅 水雷/加速度",
  juso2: "視線②",
  tsunami: "つなみ",
};

const MECH_ORDER: MechanicKey[] = ["gc3", "early", "juso1", "honoo", "late", "juso2", "tsunami"];

/** 機構の解決前リードイン秒（事前にターゲットを描画して予告する）。 */
const LEAD_IN = 8;

/** キャストバーの長さ（秒）。解決の約7秒前にキャスト開始し、解決秒で満タン。 */
const CAST_LEN = 7;

/**
 * 中央ボス AoE の解決秒。
 *
 * 参照 sim.html では、中央ボス（boss[0], ~4s 詠唱）が完了した瞬間に
 * `checkSafety()` で十字（サンダガ）+ 象限（ブリザガ）を判定する。これは
 * GC/波フェーズの「最中・序盤」に各 GC ごと1回ずつ早期に解決され、
 * エクスデス（46s）より前に動作する。役割デバフは 8/16/24/32/40 で付与される。
 *
 * これに合わせ、GC1 中央 AoE を ≈12s、GC2 中央 AoE を ≈28s に置く。
 * 各々 CAST_LEN(7s) 前から詠唱バーが満ち、CENTER_LEAD(6s) 前から低アルファで
 * AoE を予告、解決秒で高アルファ → 直後にクリアする。これにより最初の ~40s
 * のあいだ十字/象限避けが能動的に働き、詠唱バーも序盤から動く（参照と同じ）。
 */
const CENTER_GC1_SEC = 12;
const CENTER_GC2_SEC = 28;
const CENTER_LEAD = 6;

/** 中央 AoE の擬似機構キー（HUD/結果には MECH_ORDER とは別に集計）。 */
type CenterKey = "centerGc1" | "centerGc2";

/* ============================================================
 * デバフアイコン定義（席視点の保有デバフ）
 * ========================================================== */

/** /play/<name>.png を引くためのアイコンキー集合。 */
const ICON_FILES = {
  mizu: "water_compression",
  rai: "forked_lightning",
  mushoku: "acceleration_bomb",
  shisen: "evil_eye",
  honoo: "fire",
  tsunami: "water",
  aragan: "allagan_field",
  shi: "living_transcendence",
  seija: "living_scar_pink",
  shisha: "dead_scar_blue",
  truth: "truth",
  fake: "fake",
} as const;
type IconKey = keyof typeof ICON_FILES;

const ICON_KEYS = Object.keys(ICON_FILES) as IconKey[];

/** 1デバフ表示エントリ。application で出現し resolveSec で消える。 */
type DebuffEntry = {
  iconKey: IconKey;
  /** 出現秒（APPLICATION）。 */
  applySec: number;
  /** 解決秒（カウントダウンの終点）。 */
  resolveSec: number;
  /** フォールバック矩形色。 */
  color: string;
};

/**
 * 席のタイムライン保有デバフを setup から導出する。
 * GC1役割@8 / wave1@16 / GC2役割@24 / wave2@32 / GC3役割+傷@40 で出現。
 */
function buildDebuffs(setup: SimSetup, seat: number): DebuffEntry[] {
  const p = setup.players.find((pl) => pl.seat === seat);
  if (!p) return [];
  const ms = toMinState(setup, seat);
  const out: DebuffEntry[] = [];

  // 各 GC 役割の解決秒（早/遅は waterWhen に従う）。
  const waterEarly = ms.waterWhen === "haya";
  // 水雷側 GC の解決秒。
  const waterSec = waterEarly ? MECHANIC_SEC.early : MECHANIC_SEC.late;
  // 加速度系側 GC の解決秒。
  const accelEarly = !waterEarly;
  const accelIsShisen = ms.shisen === "yes";
  const accelSec = accelIsShisen
    ? accelEarly
      ? MECHANIC_SEC.juso1
      : MECHANIC_SEC.juso2
    : accelEarly
      ? MECHANIC_SEC.early
      : MECHANIC_SEC.late;

  // GC1 役割は p.gc1Role、GC2 役割は p.gc2Role。各々の解決秒は水雷/加速度系で決まる。
  const gc1IsWater = p.gc1Role === "mizu" || p.gc1Role === "rai";
  const gc1Sec = gc1IsWater ? waterSec : accelSec;
  const gc2Sec = gc1IsWater ? accelSec : waterSec;

  const roleColor = (r: string): string => {
    if (r === "mizu") return "#00b4d8";
    if (r === "rai") return "#bf55ec";
    if (r === "shisen") return "#a2d2ff";
    return "#ffcc00"; // mushoku
  };

  // GC1 役割 @8。
  out.push({
    iconKey: p.gc1Role as IconKey,
    applySec: 8,
    resolveSec: gc1Sec,
    color: roleColor(p.gc1Role),
  });
  // wave1 @16（honoo/tsunami）。
  out.push({
    iconKey: setup.wave1Type as IconKey,
    applySec: 16,
    resolveSec: setup.wave1Type === "honoo" ? MECHANIC_SEC.honoo : MECHANIC_SEC.tsunami,
    color: setup.wave1Type === "honoo" ? "#ff4500" : "#00b4d8",
  });
  // GC2 役割 @24。
  out.push({
    iconKey: p.gc2Role as IconKey,
    applySec: 24,
    resolveSec: gc2Sec,
    color: roleColor(p.gc2Role),
  });
  // wave2 @32。
  out.push({
    iconKey: setup.wave2Type as IconKey,
    applySec: 32,
    resolveSec: setup.wave2Type === "honoo" ? MECHANIC_SEC.honoo : MECHANIC_SEC.tsunami,
    color: setup.wave2Type === "honoo" ? "#ff4500" : "#00b4d8",
  });
  // GC3 役割 + 傷 @40。
  out.push({
    iconKey: p.gc3Role as IconKey,
    applySec: 40,
    resolveSec: MECHANIC_SEC.gc3,
    color: p.gc3Role === "aragan" ? "#00f5d4" : "#ff4444",
  });
  out.push({
    iconKey: p.gc3Scar as IconKey,
    applySec: 40,
    resolveSec: MECHANIC_SEC.gc3,
    color: p.gc3Scar === "seija" ? "#ff69b4" : "#00b4d8",
  });

  return out;
}

/** 現在の GC ウィンドウに応じた中央 AoE パラメータ。 */
function centerParams(setup: SimSetup, which: CenterKey) {
  const g = which === "centerGc1" ? setup.centerAoE.gc1 : setup.centerAoE.gc2;
  return {
    thunderPattern: g.thunderPattern,
    blizzardPattern: g.blizzardPattern,
    sandagaShin: g.sandagaTruth === "shin",
    blizzagaShin: g.blizzagaTruth === "shin",
  };
}

/* ============================================================
 * 画像プリロード（モジュールレベルで一度だけ）
 * ========================================================== */

type ImgMap = Partial<Record<IconKey, HTMLImageElement>>;
type LoadedMap = Partial<Record<IconKey, boolean>>;

const imgCache: ImgMap = {};
const loadedCache: LoadedMap = {};
let preloadStarted = false;

function preloadImages(onLoad: () => void) {
  if (preloadStarted) return;
  preloadStarted = true;
  for (const key of ICON_KEYS) {
    const img = new Image();
    img.onload = () => {
      loadedCache[key] = true;
      onLoad();
    };
    img.onerror = () => {
      loadedCache[key] = false;
    };
    img.src = `/play/${ICON_FILES[key]}.png`;
    imgCache[key] = img;
  }
}

/* ============================================================
 * ボス配置（参照: 中央 + 外周2体）
 * ========================================================== */

const BOSS_RADIUS = 25;
const CENTER_BOSS = { x: CENTER.x, y: CENTER.y, color: "#9b5de5" };
const SUB_BOSSES = [
  {
    x: CENTER.x + Math.cos((4 * Math.PI) / 3) * (ARENA_RADIUS - 40),
    y: CENTER.y + Math.sin((4 * Math.PI) / 3) * (ARENA_RADIUS - 40),
    color: "#5c3d99",
  },
  {
    x: CENTER.x + Math.cos((5 * Math.PI) / 3) * (ARENA_RADIUS - 40),
    y: CENTER.y + Math.sin((5 * Math.PI) / 3) * (ARENA_RADIUS - 40),
    color: "#5c3d99",
  },
];

export function PlayArena({ setup, seat = 0, startAt, onResult }: Props) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const wrapRef = useRef<HTMLDivElement | null>(null);

  // 開始時刻（再生成で再スタート）。
  const startRef = useRef<number>(startAt ?? Date.now());
  useEffect(() => {
    startRef.current = startAt ?? Date.now();
  }, [startAt, setup]);

  // 画像ロード状態のトリガ（再描画用カウンタ）。
  const [, setImgTick] = useState(0);
  useEffect(() => {
    preloadImages(() => setImgTick((t) => t + 1));
  }, []);

  // プレイヤー状態は ref で保持（毎フレーム更新、再レンダリングを避ける）。
  const player = useRef({ x: 400, y: 550, lastDx: 0, lastDy: -1, dead: false, deadReason: "" });
  const keys = useRef<Record<string, boolean>>({});
  const pointer = useRef<{ active: boolean; tx: number; ty: number; moved: boolean }>({
    active: false,
    tx: 0,
    ty: 0,
    moved: false,
  });

  // 判定済み機構の結果（HUD 表示用、state）。
  const [results, setResults] = useState<Partial<Record<MechanicKey, PlayResult>>>({});
  const resultsRef = useRef(results);
  resultsRef.current = results;

  // 中央 AoE 判定済みフラグ（ref で十分）。
  const centerJudged = useRef<Record<CenterKey, boolean>>({ centerGc1: false, centerGc2: false });

  // AoE 原点（波を「置いた」瞬間のプレイヤー位置）。リードイン開始時に確定。
  const aoeOrigin = useRef<Partial<Record<MechanicKey, Point>>>({});

  // 席の保有デバフ。
  const debuffs = useRef<DebuffEntry[]>([]);
  debuffs.current = buildDebuffs(setup, seat);

  // HUD 用クロック（粗いティック）。
  const [clock, setClock] = useState(0);
  const [dead, setDead] = useState(false);

  // setup が変わったらリセット。
  useEffect(() => {
    player.current = { x: 400, y: 550, lastDx: 0, lastDy: -1, dead: false, deadReason: "" };
    aoeOrigin.current = {};
    centerJudged.current = { centerGc1: false, centerGc2: false };
    setResults({});
    setDead(false);
  }, [setup, seat]);

  const restart = useCallback(() => {
    startRef.current = Date.now();
    player.current = { x: 400, y: 550, lastDx: 0, lastDy: -1, dead: false, deadReason: "" };
    aoeOrigin.current = {};
    centerJudged.current = { centerGc1: false, centerGc2: false };
    setResults({});
    setDead(false);
  }, []);

  // --- キーボード入力 ---
  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      const k = e.key.toLowerCase();
      if (["w", "a", "s", "d", "arrowup", "arrowdown", "arrowleft", "arrowright"].includes(k)) {
        keys.current[k] = true;
        pointer.current.active = false;
        e.preventDefault();
      }
    };
    const up = (e: KeyboardEvent) => {
      keys.current[e.key.toLowerCase()] = false;
    };
    window.addEventListener("keydown", down);
    window.addEventListener("keyup", up);
    return () => {
      window.removeEventListener("keydown", down);
      window.removeEventListener("keyup", up);
    };
  }, []);

  // --- ポインタ/タッチ入力（論理座標へ変換） ---
  const toLogical = useCallback((clientX: number, clientY: number): Point => {
    const canvas = canvasRef.current;
    if (!canvas) return { x: player.current.x, y: player.current.y };
    const rect = canvas.getBoundingClientRect();
    const sx = ARENA_SIZE / rect.width;
    const sy = ARENA_SIZE / rect.height;
    return { x: (clientX - rect.left) * sx, y: (clientY - rect.top) * sy };
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const onDown = (e: PointerEvent) => {
      const p = toLogical(e.clientX, e.clientY);
      pointer.current = { active: true, tx: p.x, ty: p.y, moved: false };
      try {
        canvas.setPointerCapture(e.pointerId);
      } catch {
        // ignore
      }
      e.preventDefault();
    };
    const onMove = (e: PointerEvent) => {
      if (!pointer.current.active) return;
      const p = toLogical(e.clientX, e.clientY);
      pointer.current.tx = p.x;
      pointer.current.ty = p.y;
      e.preventDefault();
    };
    const onUp = (e: PointerEvent) => {
      pointer.current.active = false;
      try {
        canvas.releasePointerCapture(e.pointerId);
      } catch {
        // ignore
      }
    };
    canvas.addEventListener("pointerdown", onDown);
    canvas.addEventListener("pointermove", onMove);
    canvas.addEventListener("pointerup", onUp);
    canvas.addEventListener("pointercancel", onUp);
    return () => {
      canvas.removeEventListener("pointerdown", onDown);
      canvas.removeEventListener("pointermove", onMove);
      canvas.removeEventListener("pointerup", onUp);
      canvas.removeEventListener("pointercancel", onUp);
    };
  }, [toLogical]);

  // --- ゲームループ ---
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const SPEED = 4;
    let raf = 0;

    const loop = () => {
      const pl = player.current;
      let dx = 0;
      let dy = 0;
      let movedThisFrame = false;

      if (!pl.dead) {
        const k = keys.current;
        if (k["w"] || k["arrowup"]) {
          pl.y -= SPEED;
          dy = -1;
        }
        if (k["s"] || k["arrowdown"]) {
          pl.y += SPEED;
          dy = 1;
        }
        if (k["a"] || k["arrowleft"]) {
          pl.x -= SPEED;
          dx = -1;
        }
        if (k["d"] || k["arrowright"]) {
          pl.x += SPEED;
          dx = 1;
        }
        if (dx !== 0 || dy !== 0) movedThisFrame = true;

        // ポインタ追従（キー入力が無いときのみ）。
        if (dx === 0 && dy === 0 && pointer.current.active) {
          const tdx = pointer.current.tx - pl.x;
          const tdy = pointer.current.ty - pl.y;
          const td = Math.hypot(tdx, tdy);
          if (td <= SPEED) {
            pl.x = pointer.current.tx;
            pl.y = pointer.current.ty;
            movedThisFrame = td > 0.001;
          } else {
            dx = tdx / td;
            dy = tdy / td;
            pl.x += dx * SPEED;
            pl.y += dy * SPEED;
            movedThisFrame = true;
          }
        }

        if (dx !== 0 || dy !== 0) {
          pl.lastDx = dx;
          pl.lastDy = dy;
        }
        pointer.current.moved = movedThisFrame;

        // アリーナ内クランプ。
        const c = clampToArena({ x: pl.x, y: pl.y });
        pl.x = c.x;
        pl.y = c.y;
      }

      // --- タイムライン評価 ---
      const elapsed = (Date.now() - startRef.current) / 1000;
      const moving =
        !!keys.current["w"] ||
        !!keys.current["s"] ||
        !!keys.current["a"] ||
        !!keys.current["d"] ||
        !!keys.current["arrowup"] ||
        !!keys.current["arrowdown"] ||
        !!keys.current["arrowleft"] ||
        !!keys.current["arrowright"] ||
        pointer.current.moved;

      for (const key of MECH_ORDER) {
        const sec = MECHANIC_SEC[key];
        const req = requiredAction(setup, seat, key);
        // AoE 原点は「リードイン開始時」のプレイヤー位置（置き予約）。
        if (req.kind === "aoe" && !aoeOrigin.current[key] && elapsed >= sec - LEAD_IN) {
          aoeOrigin.current[key] = { x: pl.x, y: pl.y };
        }
        // 解決秒に未判定なら採点。
        if (elapsed >= sec && !resultsRef.current[key] && req.kind !== "none") {
          const boss = gc3BossPos(setup.gc3BossAngle);
          const r = evaluate(
            req,
            { x: pl.x, y: pl.y },
            { x: pl.lastDx, y: pl.lastDy },
            moving,
            aoeOrigin.current[key],
            boss,
          );
          const res: PlayResult = { key, ok: r.ok, reason: r.reason, label: req.label };
          setResults((prev) => ({ ...prev, [key]: res }));
          onResult?.(res);
          if (!r.ok && !pl.dead) {
            pl.dead = true;
            pl.deadReason = `${MECH_NAME[key]}: ${r.reason}`;
            setDead(true);
          }
        }
      }

      // --- 中央ボス AoE 判定（GC1@53 / GC2@76）---
      for (const ck of ["centerGc1", "centerGc2"] as CenterKey[]) {
        const sec = ck === "centerGc1" ? CENTER_GC1_SEC : CENTER_GC2_SEC;
        if (elapsed >= sec && !centerJudged.current[ck]) {
          centerJudged.current[ck] = true;
          const safe = centerAoeSafe({ x: pl.x, y: pl.y }, centerParams(setup, ck));
          if (!safe && !pl.dead) {
            pl.dead = true;
            pl.deadReason = "中央ボス AoE 被弾!";
            setDead(true);
          }
        }
      }

      // --- 描画 ---
      draw(ctx, setup, seat, elapsed, pl, aoeOrigin.current, debuffs.current);

      // HUD クロックを粗く反映。
      setClock((c0) => (Math.abs(c0 - elapsed) > 0.25 ? elapsed : c0));

      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [setup, seat]);

  const mm = Math.floor(clock / 60);
  const ss = Math.floor(clock % 60);
  const nextMech = MECH_ORDER.find((k) => clock < MECHANIC_SEC[k] && !results[k]);
  const curReq: RequiredAction | null = nextMech ? requiredAction(setup, seat, nextMech) : null;
  const passCount = Object.values(results).filter((r) => r?.ok).length;
  const failCount = Object.values(results).filter((r) => r && !r.ok).length;

  return (
    <div className="flex flex-col gap-2">
      {/* HUD */}
      <div className="flex items-center justify-between px-0.5">
        <span className="inline-flex items-center gap-1 text-xs font-bold tabular-nums text-foreground">
          <Gauge className="size-3.5 shrink-0" />
          {mm}:{String(ss).padStart(2, "0")}
        </span>
        <span className="text-[10px] text-muted-foreground">
          <span className="text-green-500 font-bold">✓{passCount}</span>{" "}
          <span className="text-destructive font-bold">✗{failCount}</span>
          {nextMech && curReq && (
            <span className="ml-2">
              次: {MECH_NAME[nextMech]}
              {curReq.label ? ` → ${curReq.label}` : ""} @{MECHANIC_SEC[nextMech]}s
            </span>
          )}
        </span>
      </div>

      <div
        ref={wrapRef}
        className="relative mx-auto w-full max-w-[480px] select-none"
        style={{ touchAction: "none" }}
      >
        <canvas
          ref={canvasRef}
          width={ARENA_SIZE}
          height={ARENA_SIZE}
          className="block h-auto w-full rounded-lg border"
        />
        {dead && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 rounded-lg bg-black/55 text-center">
            <p className="text-sm font-bold text-red-400">死亡</p>
            <p className="max-w-[80%] text-xs text-white">{player.current.deadReason}</p>
            <button
              type="button"
              onClick={restart}
              className="mt-1 rounded-md bg-primary px-4 py-1.5 text-xs font-bold text-primary-foreground"
            >
              もう一度
            </button>
          </div>
        )}
      </div>

      {/* 結果リスト */}
      <div className="flex flex-wrap gap-1">
        {MECH_ORDER.map((k) => {
          const r = results[k];
          if (!r) return null;
          return (
            <span
              key={k}
              className={`inline-flex items-center gap-1 rounded-md border px-1.5 py-0.5 text-[10px] font-bold ${
                r.ok
                  ? "border-green-600/30 bg-green-500/10 text-green-600"
                  : "border-destructive/40 bg-destructive/10 text-destructive"
              }`}
            >
              {r.ok ? "✓" : "✗"} {MECH_NAME[k]}
            </span>
          );
        })}
      </div>

      <p className="px-1 text-center text-[10px] text-muted-foreground">
        WASD / 矢印キー / ドラッグで移動。各機構の解決時刻に正しい位置・移動・視線・色に。
      </p>
    </div>
  );
}

/* ============================================================
 * 描画
 * ========================================================== */

/** どの中央 GC ウィンドウか（無ければ null）。 */
function activeCenter(elapsed: number): CenterKey | null {
  if (elapsed >= CENTER_GC1_SEC - CENTER_LEAD && elapsed < CENTER_GC1_SEC + 1.5) return "centerGc1";
  if (elapsed >= CENTER_GC2_SEC - CENTER_LEAD && elapsed < CENTER_GC2_SEC + 1.5) return "centerGc2";
  return null;
}

function draw(
  ctx: CanvasRenderingContext2D,
  setup: SimSetup,
  seat: number,
  elapsed: number,
  pl: { x: number; y: number; lastDx: number; lastDy: number; dead: boolean },
  origins: Partial<Record<MechanicKey, Point>>,
  debuffs: DebuffEntry[],
) {
  ctx.clearRect(0, 0, ARENA_SIZE, ARENA_SIZE);

  // --- アリーナ円（参照: dark disc #1a1a1a / #555 stroke） ---
  ctx.beginPath();
  ctx.arc(CENTER.x, CENTER.y, ARENA_RADIUS, 0, Math.PI * 2);
  ctx.fillStyle = "#1a1a1a";
  ctx.fill();
  ctx.lineWidth = 5;
  ctx.strokeStyle = "#555";
  ctx.stroke();

  // --- ABCD ウェイマーク（A=12時/北, B=3時/東, C=6時/南, D=9時/西） ---
  // 旧来の破線ゾーン円・時計ラベルは廃止し、各ゾーン中心に文字バッジを描く。
  // ヒット判定（ZONE_RADIUS）は arena.ts 側のまま不変。
  drawWaymarks(ctx);

  // --- 中央ボス AoE（サンダガ十字 + ブリザガ象限） ---
  const center = activeCenter(elapsed);
  if (center) {
    const g = center === "centerGc1" ? setup.centerAoE.gc1 : setup.centerAoE.gc2;
    const sec = center === "centerGc1" ? CENTER_GC1_SEC : CENTER_GC2_SEC;
    // リードインは低アルファ、解決秒で高アルファ。
    const resolving = elapsed >= sec;
    const aBlz = resolving ? 0.45 : 0.12;
    const aThn = resolving ? 0.45 : 0.12;
    drawBlizzardLayer(ctx, g.blizzardPattern, aBlz);
    drawThunderLayer(ctx, g.thunderPattern, aThn);
  }

  // --- 各機構のリードイン中ターゲット（寛容な予告） ---
  for (const key of MECH_ORDER) {
    const sec = MECHANIC_SEC[key];
    if (elapsed < sec - LEAD_IN || elapsed > sec + 1.5) continue;
    const req = requiredAction(setup, seat, key);
    drawTarget(ctx, req, key, setup, origins);
  }

  // --- ボス（中央 + 外周2体）+ キャストバー + 真偽インジケータ ---
  drawBosses(ctx, setup, elapsed, center);

  // --- プレイヤードット ---
  if (!pl.dead) {
    ctx.beginPath();
    ctx.arc(pl.x, pl.y, PLAYER_RADIUS, 0, Math.PI * 2);
    ctx.fillStyle = "#00e0c0";
    ctx.fill();
    ctx.lineWidth = 2;
    ctx.strokeStyle = "#fff";
    ctx.stroke();
    const dl = Math.hypot(pl.lastDx, pl.lastDy) || 1;
    ctx.beginPath();
    ctx.moveTo(pl.x, pl.y);
    ctx.lineTo(pl.x + (pl.lastDx / dl) * 22, pl.y + (pl.lastDy / dl) * 22);
    ctx.strokeStyle = "#ff0055";
    ctx.lineWidth = 3;
    ctx.stroke();
  } else {
    ctx.strokeStyle = "#ff3333";
    ctx.lineWidth = 4;
    ctx.beginPath();
    ctx.moveTo(pl.x - 15, pl.y - 15);
    ctx.lineTo(pl.x + 15, pl.y + 15);
    ctx.moveTo(pl.x + 15, pl.y - 15);
    ctx.lineTo(pl.x - 15, pl.y + 15);
    ctx.stroke();
  }

  // --- デバフアイコンスタック（プレイヤー近傍）+ カウントダウン ---
  drawDebuffStack(ctx, elapsed, pl, debuffs);

  // --- 経過時間表示（参照） ---
  ctx.fillStyle = "#fff";
  ctx.font = "bold 20px sans-serif";
  ctx.textAlign = "left";
  ctx.fillText(`戦闘経過時間: ${Math.floor(elapsed)}秒`, 24, 44);
}

/**
 * ABCD ウェイマークマーカー。標準 FFXIV レイアウト:
 *   A=12時(北, h12)赤 / B=3時(東, h3)黄 / C=6時(南, h6)青 / D=9時(西, h9)紫。
 * 各ゾーン中心に塗りつぶしの文字バッジを描画する（破線円・時計ラベルは廃止）。
 */
const WAYMARKS: { zone: keyof typeof ZONES; letter: string; color: string }[] = [
  { zone: "h12", letter: "A", color: "#e63946" }, // 赤
  { zone: "h3", letter: "B", color: "#ffd400" }, // 黄
  { zone: "h6", letter: "C", color: "#3a86ff" }, // 青
  { zone: "h9", letter: "D", color: "#9b5de5" }, // 紫
];

function drawWaymarks(ctx: CanvasRenderingContext2D) {
  const r = 22;
  ctx.save();
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  for (const { zone, letter, color } of WAYMARKS) {
    const z = ZONES[zone];
    // 塗りバッジ。
    ctx.beginPath();
    ctx.arc(z.x, z.y, r, 0, Math.PI * 2);
    ctx.fillStyle = color;
    ctx.globalAlpha = 0.85;
    ctx.fill();
    ctx.globalAlpha = 1;
    ctx.lineWidth = 2.5;
    ctx.strokeStyle = "rgba(255,255,255,0.9)";
    ctx.stroke();
    // 文字。
    ctx.font = "bold 26px sans-serif";
    ctx.lineWidth = 4;
    ctx.strokeStyle = "rgba(0,0,0,0.55)";
    ctx.strokeText(letter, z.x, z.y + 1);
    ctx.fillStyle = "#fff";
    ctx.fillText(letter, z.x, z.y + 1);
  }
  ctx.restore();
  ctx.textBaseline = "alphabetic";
}

/** サンダガ雷ストリップ（参照 drawThundergaAoELayer: ±PI/4 回転、w=175）。 */
function drawThunderLayer(ctx: CanvasRenderingContext2D, pattern: number, alpha: number) {
  ctx.save();
  ctx.beginPath();
  ctx.arc(CENTER.x, CENTER.y, ARENA_RADIUS, 0, Math.PI * 2);
  ctx.clip();
  ctx.fillStyle = `rgba(255, 105, 180, ${alpha})`;
  ctx.translate(CENTER.x, CENTER.y);
  ctx.rotate(pattern >= 2 ? Math.PI / 4 : -Math.PI / 4);
  const w = THUNDER_STRIP_W;
  const R = ARENA_RADIUS;
  if (pattern % 2 === 0) {
    ctx.fillRect(-w, -R, w, R * 2);
    ctx.fillRect(w, -R, w, R * 2);
  } else {
    ctx.fillRect(-2 * w, -R, w, R * 2);
    ctx.fillRect(0, -R, w, R * 2);
  }
  ctx.restore();
}

/** ブリザガ象限（参照 drawBlizzagaAoELayer）。 */
function drawBlizzardLayer(ctx: CanvasRenderingContext2D, pattern: number, alpha: number) {
  ctx.save();
  ctx.beginPath();
  ctx.arc(CENTER.x, CENTER.y, ARENA_RADIUS, 0, Math.PI * 2);
  ctx.clip();
  ctx.fillStyle = `rgba(0, 180, 216, ${alpha})`;
  const cx = CENTER.x;
  const cy = CENTER.y;
  if (pattern === 0) {
    ctx.fillRect(cx, 0, ARENA_SIZE, cy);
    ctx.fillRect(0, cy, cx, ARENA_SIZE);
  } else {
    ctx.fillRect(0, 0, cx, cy);
    ctx.fillRect(cx, cy, ARENA_SIZE, ARENA_SIZE);
  }
  ctx.restore();
}

/** 3体のボス + キャストバー + 真偽インジケータ。 */
function drawBosses(
  ctx: CanvasRenderingContext2D,
  setup: SimSetup,
  elapsed: number,
  center: CenterKey | null,
) {
  // キャストバーの進捗: 次に来る機構解決へ向け、解決の CAST_LEN 秒前から 0→1 で満ちる。
  // キャストウィンドウ外（解決の CAST_LEN 秒より前）はキャストなし（null）＝ボスは待機。
  // 中央ボスは中央 AoE の進捗、外周ボスは波/水雷など機構解決の進捗で代用。
  const allSecs = [...Object.values(MECHANIC_SEC), CENTER_GC1_SEC, CENTER_GC2_SEC].sort(
    (a, b) => a - b,
  );
  // 次に来る解決秒（elapsed より大きい最小の秒）。無ければ null（待機）。
  const nextSec = allSecs.find((s) => s > elapsed) ?? null;
  // 次の解決に対するキャスト進捗（ウィンドウ前は null）。
  let genericProg: number | null =
    nextSec == null || elapsed < nextSec - CAST_LEN
      ? null
      : Math.min(1, Math.max(0, (elapsed - (nextSec - CAST_LEN)) / CAST_LEN));
  // 参照では 3 体とも t=0 から詠唱している。序盤（GC/波フェーズ, 最初の中央 AoE 前）は
  // バーを空にせず、CAST_LEN 周期のループ詠唱で外周ボスのバーを常時動かす。
  if (genericProg == null && elapsed < CENTER_GC1_SEC) {
    genericProg = (elapsed % CAST_LEN) / CAST_LEN;
  }

  const bossList = [CENTER_BOSS, ...SUB_BOSSES];
  bossList.forEach((boss, index) => {
    // ボス本体。
    ctx.beginPath();
    ctx.arc(boss.x, boss.y, BOSS_RADIUS, 0, Math.PI * 2);
    ctx.fillStyle = boss.color;
    ctx.fill();
    ctx.strokeStyle = "#fff";
    ctx.lineWidth = 2;
    ctx.stroke();

    // 真偽インジケータ。
    if (index === 0) {
      drawCenterTruthRings(ctx, boss.x, boss.y, setup, center);
    } else {
      // 外周ボス: GC1/GC2 真偽（参照 sub-boss currentEffect）。簡易に gc1/gc2Truth を表示。
      const truth: Truth = index === 1 ? setup.gc1Truth : setup.gc2Truth;
      drawSubBossRing(ctx, boss.x, boss.y, truth);
    }

    // キャストバー（参照: barW=100, barH=10, y=boss.y-bossRadius-25）。
    // キャストウィンドウ外（prog == null）はバーを描かない＝ボスは待機。
    const barW = 100;
    const barH = 10;
    const barX = boss.x - barW / 2;
    const barY = boss.y - BOSS_RADIUS - 25;
    let progColor = "#ffaa00";
    let prog: number | null = genericProg;
    if (index === 0) {
      // 中央ボスは中央 AoE 解決へ向けてキャスト（参照: boss[0] は t=0 から詠唱）。
      // GC ウィンドウ中はその解決秒へ向け満タンに。直前の最初の GC1 までは
      // CENTER_GC1 を目標に序盤からバーを満ちさせる。
      const sec =
        center === "centerGc2"
          ? CENTER_GC2_SEC
          : center === "centerGc1"
            ? CENTER_GC1_SEC
            : elapsed < CENTER_GC1_SEC
              ? CENTER_GC1_SEC
              : elapsed < CENTER_GC2_SEC
                ? CENTER_GC2_SEC
                : null;
      prog =
        sec == null || elapsed < sec - CAST_LEN
          ? sec != null
            ? // ウィンドウ前でもループ詠唱で動かす（空にしない）。
              (elapsed % CAST_LEN) / CAST_LEN
            : null
          : Math.min(1, Math.max(0, (elapsed - (sec - CAST_LEN)) / CAST_LEN));
      progColor = "#bf55ec";
    }
    if (prog != null) {
      ctx.fillStyle = "#000";
      ctx.fillRect(barX, barY, barW, barH);
      if (prog >= 1) progColor = "#ff3333";
      ctx.fillStyle = progColor;
      ctx.fillRect(barX, barY, barW * prog, barH);
      ctx.strokeStyle = "#888";
      ctx.lineWidth = 1;
      ctx.strokeRect(barX, barY, barW, barH);
    }
  });
}

/** 真偽インジケータ用の小さな楕円リング + truth/fake アイコン（参照 drawCenterBossRings 簡略）。 */
function drawTruthEllipse(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  ringStroke: string,
  innerStroke: string,
  shin: boolean,
) {
  const rx = 45;
  const ry = 15;
  const size = 20;
  ctx.save();
  ctx.translate(cx, cy);
  ctx.strokeStyle = ringStroke;
  ctx.lineWidth = 6;
  ctx.beginPath();
  ctx.ellipse(0, 0, rx, ry, 0, 0, Math.PI * 2);
  ctx.stroke();
  ctx.strokeStyle = innerStroke;
  ctx.lineWidth = 2;
  ctx.stroke();
  const key: IconKey = shin ? "truth" : "fake";
  const img = imgCache[key];
  if (loadedCache.truth && loadedCache.fake && img) {
    ctx.drawImage(img, -rx - size / 2, -size / 2, size, size);
    ctx.drawImage(img, rx - size / 2, -size / 2, size, size);
  } else {
    ctx.fillStyle = shin ? "#00b4d8" : "#ff4444";
    ctx.fillRect(-rx - 5, -5, 10, 10);
    ctx.fillRect(rx - 5, -5, 10, 10);
  }
  ctx.restore();
}

/** 中央ボスの真偽（GC ウィンドウ中はサンダガ/ブリザガ、それ以外は GC1/GC2 のサンダガ/ブリザガ）。 */
function drawCenterTruthRings(
  ctx: CanvasRenderingContext2D,
  bx: number,
  by: number,
  setup: SimSetup,
  center: CenterKey | null,
) {
  const g =
    center === "centerGc2"
      ? setup.centerAoE.gc2
      : setup.centerAoE.gc1; // 既定/GC1 表示。
  // 上=サンダガ（紫系）、下=ブリザガ（青系）。
  drawTruthEllipse(
    ctx,
    bx,
    by - 25,
    "rgba(138, 43, 226, 0.4)",
    "#bf55ec",
    g.sandagaTruth === "shin",
  );
  drawTruthEllipse(
    ctx,
    bx,
    by + 45,
    "rgba(0, 180, 216, 0.4)",
    "#00b4d8",
    g.blizzagaTruth === "shin",
  );
}

/** 外周ボスの真偽リング（参照 sub-boss）。 */
function drawSubBossRing(ctx: CanvasRenderingContext2D, bx: number, by: number, truth: Truth) {
  drawTruthEllipse(ctx, bx, by, "rgba(0, 180, 216, 0.35)", "#00f5d4", truth === "shin");
}

/** ある機構の「正しい場所/形」を半透明で予告描画。 */
function drawTarget(
  ctx: CanvasRenderingContext2D,
  req: RequiredAction,
  key: MechanicKey,
  setup: SimSetup,
  origins: Partial<Record<MechanicKey, Point>>,
) {
  const safe = "rgba(78,201,176,0.18)";
  const safeEdge = "rgba(78,201,176,0.8)";
  const danger = "rgba(255,69,0,0.30)";
  const dangerEdge = "#ff4500";

  const fillZone = (z: Point) => {
    ctx.beginPath();
    ctx.arc(z.x, z.y, ZONE_RADIUS, 0, Math.PI * 2);
    ctx.fillStyle = safe;
    ctx.fill();
    ctx.strokeStyle = safeEdge;
    ctx.lineWidth = 2;
    ctx.stroke();
  };

  switch (req.kind) {
    case "stack":
    case "filler":
      fillZone(ZONES.h12);
      fillZone(ZONES.h6);
      break;
    case "spread":
      fillZone(ZONES.h3);
      fillZone(ZONES.h9);
      break;
    case "aoe": {
      const o = origins[key] ?? CENTER;
      ctx.save();
      ctx.fillStyle = danger;
      ctx.strokeStyle = dangerEdge;
      ctx.lineWidth = 3;
      if (req.shape === "CIRCLE") {
        ctx.beginPath();
        ctx.arc(o.x, o.y, AOE_CIRCLE_RADIUS, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
      } else if (req.shape === "DONUT") {
        ctx.beginPath();
        ctx.arc(o.x, o.y, AOE_DONUT_OUTER, 0, Math.PI * 2);
        ctx.arc(o.x, o.y, AOE_DONUT_INNER, 0, Math.PI * 2, true);
        ctx.fill("evenodd");
        ctx.beginPath();
        ctx.arc(o.x, o.y, AOE_DONUT_OUTER, 0, Math.PI * 2);
        ctx.stroke();
        ctx.beginPath();
        ctx.arc(o.x, o.y, AOE_DONUT_INNER, 0, Math.PI * 2);
        ctx.stroke();
      }
      ctx.restore();
      break;
    }
    case "gc3": {
      const boss = gc3BossPos(setup.gc3BossAngle);
      drawSplit(ctx, boss, req.color === "PINK" ? "PINK" : "BLUE");
      break;
    }
    case "look":
    case "hide":
    case "stop":
    case "move":
    case "none":
    default:
      break;
  }
}

/** GC3 分断面（参照 drawWave3SplitAoE: ボスへ translate→中心向き rotate、pink=+側 / blue=-側）+ 安全側強調。 */
function drawSplit(ctx: CanvasRenderingContext2D, boss: Point, safeColor: "PINK" | "BLUE") {
  const ang = Math.atan2(CENTER.y - boss.y, CENTER.x - boss.x);
  const R = ARENA_RADIUS * 3;

  ctx.save();
  ctx.beginPath();
  ctx.arc(CENTER.x, CENTER.y, ARENA_RADIUS, 0, Math.PI * 2);
  ctx.clip();
  ctx.translate(boss.x, boss.y);
  ctx.rotate(ang);
  // 参照: pink = +回転側(rect(0,0,3R,3R)) / blue = -側(rect(0,-3R,3R,3R))。
  ctx.fillStyle = "rgba(255, 105, 180, 0.20)";
  ctx.fillRect(0, 0, R, R);
  ctx.fillStyle = "rgba(0, 180, 216, 0.20)";
  ctx.fillRect(0, -R, R, R);
  // 安全側の強調。
  ctx.fillStyle =
    safeColor === "PINK" ? "rgba(255, 105, 180, 0.22)" : "rgba(0, 180, 216, 0.22)";
  if (safeColor === "PINK") ctx.fillRect(0, 0, R, R);
  else ctx.fillRect(0, -R, R, R);
  ctx.restore();

  // ボスマーカー。
  ctx.beginPath();
  ctx.arc(boss.x, boss.y, 14, 0, Math.PI * 2);
  ctx.fillStyle = "rgba(220,60,60,0.9)";
  ctx.fill();
}

/** デバフアイコンスタック（プレイヤー右上に小さく並べる）+ 残り秒カウントダウン。 */
function drawDebuffStack(
  ctx: CanvasRenderingContext2D,
  elapsed: number,
  pl: { x: number; y: number },
  debuffs: DebuffEntry[],
) {
  const active = debuffs.filter((d) => elapsed >= d.applySec && elapsed < d.resolveSec + 0.5);
  if (active.length === 0) return;

  const iconSize = 28;
  const gap = 32;
  // プレイヤー右上に基準点。アリーナ右端を超えないようにクランプ。
  let baseX = pl.x + PLAYER_RADIUS + 8;
  const baseY = pl.y - PLAYER_RADIUS - iconSize - 16;
  const totalW = active.length * gap;
  if (baseX + totalW > ARENA_SIZE - 8) baseX = ARENA_SIZE - 8 - totalW;
  if (baseX < 8) baseX = 8;
  const clampY = Math.max(8, baseY);

  active.forEach((d, i) => {
    const x = baseX + i * gap;
    const y = clampY;
    const img = imgCache[d.iconKey];
    if (loadedCache[d.iconKey] && img) {
      ctx.drawImage(img, x, y, iconSize, iconSize);
    } else {
      ctx.fillStyle = d.color;
      ctx.fillRect(x, y, iconSize, iconSize);
      ctx.fillStyle = "#fff";
      ctx.font = "bold 8px sans-serif";
      ctx.textAlign = "center";
      ctx.fillText(d.iconKey.slice(0, 3), x + iconSize / 2, y + 18);
    }
    // 残り秒（参照: 白文字 + 黒縁）。
    const remain = Math.max(0, Math.ceil(d.resolveSec - elapsed));
    ctx.save();
    ctx.font = "bold 12px sans-serif";
    ctx.textAlign = "center";
    ctx.strokeStyle = "#000";
    ctx.lineWidth = 3;
    ctx.strokeText(String(remain), x + iconSize / 2, y + iconSize + 13);
    ctx.fillStyle = "#fff";
    ctx.fillText(String(remain), x + iconSize / 2, y + iconSize + 13);
    ctx.restore();
  });
}
