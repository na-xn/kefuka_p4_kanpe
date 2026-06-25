import { useEffect, useRef, useState, useCallback } from "react";
import { Gauge } from "lucide-react";
import type { SimSetup } from "@/p4/simulation";
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
  clampToArena,
  gc3BossPos,
  requiredAction,
  evaluate,
  MECHANIC_SEC,
  type MechanicKey,
  type Point,
  type RequiredAction,
} from "@/p4/arena";

/**
 * 操作プレイ・アリーナ（Phase B: ロール機構のみ）。
 *
 * 円形アリーナ上でドットを動かし、実戦タイムラインの各機構の解決秒に
 * 「正しい位置/移動/視線/色」に居るかを参照ジオメトリで判定する。
 *
 * props は後段のセッション相乗りを見据えた形:
 *  - setup: 共有セットアップ（generateSim 由来）
 *  - seat:  自分の席（既定 0）
 *  - startAt: 開始時刻（ms epoch。同期クロック用。未指定なら mount 時刻）
 *  - onResult: 各機構の判定結果コールバック（任意）
 *
 * 中央サンダガ/ブリザガ十字 AoE とセッション相乗りは後段（Phase C/D）。
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
const LEAD_IN = 6;

export function PlayArena({ setup, seat = 0, startAt, onResult }: Props) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const wrapRef = useRef<HTMLDivElement | null>(null);

  // 開始時刻（再生成で再スタート）。
  const startRef = useRef<number>(startAt ?? Date.now());
  useEffect(() => {
    startRef.current = startAt ?? Date.now();
  }, [startAt, setup]);

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

  // AoE 原点（波を「置いた」瞬間のプレイヤー位置）。リードイン開始時に確定。
  const aoeOrigin = useRef<Partial<Record<MechanicKey, Point>>>({});

  // HUD 用クロック（粗いティック）。
  const [clock, setClock] = useState(0);
  const [dead, setDead] = useState(false);

  // setup が変わったらリセット。
  useEffect(() => {
    player.current = { x: 400, y: 550, lastDx: 0, lastDy: -1, dead: false, deadReason: "" };
    aoeOrigin.current = {};
    setResults({});
    setDead(false);
  }, [setup, seat]);

  const restart = useCallback(() => {
    startRef.current = Date.now();
    player.current = { x: 400, y: 550, lastDx: 0, lastDy: -1, dead: false, deadReason: "" };
    aoeOrigin.current = {};
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

    const css = (name: string, fallback: string) => {
      const v = getComputedStyle(canvas).getPropertyValue(name).trim();
      return v || fallback;
    };

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

      // --- 描画 ---
      draw(ctx, css, setup, seat, elapsed, pl, aoeOrigin.current);

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
          className="block h-auto w-full rounded-lg border bg-card/30 text-foreground"
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

function draw(
  ctx: CanvasRenderingContext2D,
  css: (n: string, f: string) => string,
  setup: SimSetup,
  seat: number,
  elapsed: number,
  pl: { x: number; y: number; lastDx: number; lastDy: number; dead: boolean },
  origins: Partial<Record<MechanicKey, Point>>,
) {
  const fg = css("color", "#e5e7eb");
  ctx.clearRect(0, 0, ARENA_SIZE, ARENA_SIZE);

  // アリーナ円。
  ctx.beginPath();
  ctx.arc(CENTER.x, CENTER.y, ARENA_RADIUS, 0, Math.PI * 2);
  ctx.fillStyle = "rgba(120,120,140,0.10)";
  ctx.fill();
  ctx.lineWidth = 2;
  ctx.strokeStyle = "rgba(150,150,170,0.5)";
  ctx.stroke();

  // ゾーンヒント（h12/h3/h6/h9）。
  const zoneLabels: Record<string, string> = { h12: "12", h3: "3", h6: "6", h9: "9" };
  for (const [k, z] of Object.entries(ZONES)) {
    ctx.beginPath();
    ctx.arc(z.x, z.y, ZONE_RADIUS, 0, Math.PI * 2);
    ctx.setLineDash([6, 6]);
    ctx.strokeStyle = "rgba(150,150,170,0.35)";
    ctx.lineWidth = 1.5;
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.fillStyle = "rgba(150,150,170,0.5)";
    ctx.font = "bold 22px sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(zoneLabels[k], z.x, z.y);
  }

  // 各機構のリードイン中ターゲットを描画。
  for (const key of MECH_ORDER) {
    const sec = MECHANIC_SEC[key];
    if (elapsed < sec - LEAD_IN || elapsed > sec + 1.5) continue;
    const req = requiredAction(setup, seat, key);
    drawTarget(ctx, req, key, setup, origins);
  }

  // プレイヤードット。
  ctx.beginPath();
  ctx.arc(pl.x, pl.y, PLAYER_RADIUS, 0, Math.PI * 2);
  ctx.fillStyle = pl.dead ? "#ff4444" : "#00e0c0";
  ctx.fill();
  ctx.lineWidth = 2;
  ctx.strokeStyle = "#003b35";
  ctx.stroke();
  // 向きインジケータ。
  const dl = Math.hypot(pl.lastDx, pl.lastDy) || 1;
  ctx.beginPath();
  ctx.moveTo(pl.x, pl.y);
  ctx.lineTo(pl.x + (pl.lastDx / dl) * 22, pl.y + (pl.lastDy / dl) * 22);
  ctx.strokeStyle = pl.dead ? "#ff8888" : "#00e0c0";
  ctx.lineWidth = 3;
  ctx.stroke();

  ctx.fillStyle = fg;
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
  const danger = "rgba(255,80,80,0.18)";

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
      ctx.fillStyle = danger;
      if (req.shape === "CIRCLE") {
        ctx.beginPath();
        ctx.arc(o.x, o.y, AOE_CIRCLE_RADIUS, 0, Math.PI * 2);
        ctx.fill();
      } else if (req.shape === "DONUT") {
        ctx.beginPath();
        ctx.arc(o.x, o.y, AOE_DONUT_OUTER, 0, Math.PI * 2);
        ctx.arc(o.x, o.y, AOE_DONUT_INNER, 0, Math.PI * 2, true);
        ctx.fill("evenodd");
      }
      break;
    }
    case "gc3": {
      // 分断面 + 安全色側を塗る。
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
      // 位置自由（視線/移動）はラベルのみ。中央近傍に表示。
      break;
  }
}

/** GC3 分断面とボス、安全側の色を描画。 */
function drawSplit(ctx: CanvasRenderingContext2D, boss: Point, safeColor: "PINK" | "BLUE") {
  const pink = "rgba(255,105,180,0.18)";
  const blue = "rgba(0,180,216,0.18)";
  // ボス→中心方向の角度。
  const ang = Math.atan2(CENTER.y - boss.y, CENTER.x - boss.x);
  ctx.save();
  // アリーナ円でクリップ。
  ctx.beginPath();
  ctx.arc(CENTER.x, CENTER.y, ARENA_RADIUS, 0, Math.PI * 2);
  ctx.clip();
  ctx.translate(boss.x, boss.y);
  ctx.rotate(ang);
  const R = ARENA_RADIUS * 3;
  // 参照同様: 回転後 +y 側を PINK、-y 側を BLUE。
  ctx.fillStyle = pink;
  ctx.fillRect(-R, 0, R * 2, R);
  ctx.fillStyle = blue;
  ctx.fillRect(-R, -R, R * 2, R);
  ctx.restore();

  // 安全側の強調枠。
  ctx.save();
  ctx.beginPath();
  ctx.arc(CENTER.x, CENTER.y, ARENA_RADIUS, 0, Math.PI * 2);
  ctx.clip();
  ctx.translate(boss.x, boss.y);
  ctx.rotate(ang);
  const R2 = ARENA_RADIUS * 3;
  ctx.fillStyle = safeColor === "PINK" ? "rgba(255,105,180,0.22)" : "rgba(0,180,216,0.22)";
  if (safeColor === "PINK") ctx.fillRect(-R2, 0, R2 * 2, R2);
  else ctx.fillRect(-R2, -R2, R2 * 2, R2);
  ctx.restore();

  // ボスマーカー。
  ctx.beginPath();
  ctx.arc(boss.x, boss.y, 14, 0, Math.PI * 2);
  ctx.fillStyle = "rgba(220,60,60,0.9)";
  ctx.fill();
}
