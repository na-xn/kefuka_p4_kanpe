/**
 * NPC（非操作の7人）の決定的な位置・向き算出（純ロジックのみ・React/DOM 非依存）。
 *
 * 操作席以外の7枚のドットを「実戦で正解の場所に立つ」ように動かし、アリーナを
 * 満員に見せ、視線(魔眼)機構に実プレイヤーがいる感を与える。
 *
 * 真実は arena.ts の requiredAction（席が各機構で何をすべきか）に委譲し、
 * 本モジュールは「いつ・どの目標点へ・どう動くか」だけを決める。
 * NPC が算出した stack/spread/gc3 目標点に立てば、必ず PlayArena と同じ
 * evaluate（同じ zones / role）に合格するよう座標規約を一致させている。
 */

import type { SimSetup } from "@/p4/simulation";
import {
  type Point,
  CENTER,
  ZONES,
  clampToArena,
  dist,
  requiredAction,
  roleCardinalPoint,
  exdeathZones,
  gc3BossPos,
  splitColorAt,
  MECHANIC_SEC,
  type MechanicKey,
} from "@/p4/arena";
import { MECH_ORDER } from "@/p4/playTimeline";

/** NPC 1枚の描画状態（位置・向き・移動中フラグ）。 */
export type NpcState = {
  /** アリーナ内にクランプされた位置。 */
  pos: Point;
  /** 単位ベクトルの向き（決して {0,0} にならない。既定は上 {0,-1}）。 */
  facing: Point;
  /** 加速弾「動く」の解決窓でジッターしているときなど、移動中 true。 */
  moving: boolean;
};

/** 目標点とその到達時刻（waypoint）。 */
type Waypoint = { time: number; target: Point };

/** PlayArena の LEAD_IN（目標へ向かい始める先読み秒）と一致させる。 */
const LEAD_IN = 8;
/** seatHome のリング半径（中心から離して重ならせない）。 */
const HOME_RADIUS = 150;
/** GC3 分断線からの離れ幅（色側に明確に立つ）。 */
const GC3_OFFSET = 110;

/** ベクトルを単位化（ゼロなら既定の上向き {0,-1}）。 */
function unit(v: Point, fallback: Point = { x: 0, y: -1 }): Point {
  const len = Math.hypot(v.x, v.y);
  if (len < 1e-9) return fallback;
  return { x: v.x / len, y: v.y / len };
}

/** a→b を t(0..1) で線形補間。 */
function lerp(a: Point, b: Point, t: number): Point {
  return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
}

/**
 * 席ごとの安定したアイドル位置。中心まわりのリング上に均等配置して重ならせない。
 * gc3 前・機構の合間・視線/AoE 窓の基準点に使う。
 */
export function seatHome(seat: number): Point {
  const ang = (seat / 8) * Math.PI * 2;
  return clampToArena({
    x: CENTER.x + Math.cos(ang) * HOME_RADIUS,
    y: CENTER.y + Math.sin(ang) * HOME_RADIUS,
  });
}

/**
 * 席 seat の、機構 key における目標点を返す（目標が無い＝kind:"none" は null）。
 *
 * - stack/filler: ロール別カーディナル（頭割り側）。
 * - spread: ロール別カーディナル（散開側）。
 *   いずれも zones は早=exdeathZones / 遅=ZONES。evaluate に必ず合格する点。
 * - gc3: 要求色側に明確に立つ点（splitColorAt が req.color に一致するよう符号選択）。
 * - look/hide/aoe/stop/move: seatHome（位置は採点に無関係、重なり回避のみ）。
 */
export function npcTarget(setup: SimSetup, seat: number, key: MechanicKey): Point | null {
  const player = setup.players.find((p) => p.seat === seat);
  if (!player) throw new Error(`seat ${seat} not found`);
  const req = requiredAction(setup, seat, key);

  switch (req.kind) {
    case "none":
      return null;
    case "stack":
    case "filler":
    case "spread": {
      const zones = key === "early" ? exdeathZones(setup.gc3BossAngle) : ZONES;
      const isStack = req.kind !== "spread";
      return clampToArena(roleCardinalPoint(player.role, isStack, zones));
    }
    case "gc3": {
      const boss = gc3BossPos(setup.gc3BossAngle);
      const dirToCenter = unit({ x: CENTER.x - boss.x, y: CENTER.y - boss.y });
      const perp = { x: -dirToCenter.y, y: dirToCenter.x };
      const plus = { x: CENTER.x + perp.x * GC3_OFFSET, y: CENTER.y + perp.y * GC3_OFFSET };
      const minus = { x: CENTER.x - perp.x * GC3_OFFSET, y: CENTER.y - perp.y * GC3_OFFSET };
      const pick = splitColorAt(plus, boss) === req.color ? plus : minus;
      return clampToArena(pick);
    }
    // 視線/AoE/単発移動・停止: 位置は採点外。重ならない home を使う。
    case "look":
    case "hide":
    case "aoe":
    case "stop":
    case "move":
      return seatHome(seat);
    default:
      return seatHome(seat);
  }
}

/** 席 seat の (時刻, 目標) waypoint 列を構築（先頭に (0, seatHome)、目標のある機構のみ）。 */
function buildWaypoints(setup: SimSetup, seat: number): Waypoint[] {
  const wps: Waypoint[] = [{ time: 0, target: seatHome(seat) }];
  for (const key of MECH_ORDER) {
    const target = npcTarget(setup, seat, key as MechanicKey);
    if (target) wps.push({ time: MECHANIC_SEC[key as MechanicKey], target });
  }
  return wps;
}

/**
 * waypoint 列から elapsed 時点の位置を求める。
 * - 最初の waypoint 時刻より前 → seatHome。
 * - 区間 (a@ta, b@tb) で elapsed < tb-LEAD_IN なら a の目標で待機。
 *   それ以降は [tb-LEAD_IN, tb] で a→b を補間し tb までに到達。
 * - 最後の waypoint 以降は最後の目標で待機。
 */
function posAt(wps: Waypoint[], elapsed: number): Point {
  if (elapsed <= wps[0].time) return wps[0].target;
  for (let i = 0; i < wps.length - 1; i++) {
    const a = wps[i];
    const b = wps[i + 1];
    if (elapsed >= a.time && elapsed <= b.time) {
      const startMove = b.time - LEAD_IN;
      if (elapsed <= startMove) return a.target;
      const t = Math.min(1, Math.max(0, (elapsed - startMove) / (b.time - startMove)));
      return lerp(a.target, b.target, t);
    }
  }
  return wps[wps.length - 1].target;
}

/** この席の視線(魔眼)機構キーを返す（accel が視線かつ早/遅で juso1/juso2）。無ければ null。 */
function gazeKeyFor(setup: SimSetup, seat: number): MechanicKey | null {
  for (const key of ["juso1", "juso2"] as const) {
    const req = requiredAction(setup, seat, key);
    if (req.kind === "look" || req.kind === "hide") return key;
  }
  return null;
}

/**
 * 席 seat の NPC 状態を、シミュレーション経過秒 elapsed で算出する。
 *
 * 各機構の目標点へ「その時刻までに到達」するよう滑らかに移動し、それ以外は待機。
 * 視線窓では look→中央を向く / hide→中央に背を向ける。
 * 加速弾「動く」の解決時のみ moving=true（「止まる」は false）。
 * 戻り値は (setup, seat, elapsed) から完全に決定的。
 */
export function npcState(setup: SimSetup, seat: number, elapsed: number): NpcState {
  const wps = buildWaypoints(setup, seat);
  const pos = clampToArena(posAt(wps, elapsed));

  // 移動方向（小 dt で前位置をサンプリング）。
  const prev = clampToArena(posAt(wps, elapsed - 0.1));
  const deltaMoving = dist(pos, prev) > 0.01;

  // --- 向き ---
  let facing: Point = { x: 0, y: -1 };
  const gazeKey = gazeKeyFor(setup, seat);
  let inGaze = false;
  if (gazeKey) {
    const resolveSec = MECHANIC_SEC[gazeKey];
    if (elapsed >= resolveSec - LEAD_IN && elapsed <= resolveSec + 1.5) {
      inGaze = true;
      const req = requiredAction(setup, seat, gazeKey);
      const toCenter = { x: CENTER.x - pos.x, y: CENTER.y - pos.y };
      if (dist(pos, CENTER) < 1e-6) {
        facing = req.kind === "look" ? { x: 0, y: -1 } : { x: 0, y: 1 };
      } else {
        // look → 中央を向く / hide → 中央に背を向ける。
        facing = req.kind === "look" ? unit(toCenter) : unit({ x: -toCenter.x, y: -toCenter.y });
      }
    }
  }
  if (!inGaze) {
    if (deltaMoving) {
      facing = unit({ x: pos.x - prev.x, y: pos.y - prev.y });
    } else {
      // 次の目標へ向ける（無ければ上）。
      const next = posAt(wps, elapsed + LEAD_IN);
      facing = unit({ x: next.x - pos.x, y: next.y - pos.y });
    }
  }

  // --- moving ---
  // 操作席視点の env 機構（早/遅）が加速弾「動く」(req.move==="move" or kind==="move")で、
  // かつその解決±0.6s 以内なら true。それ以外は補間で実際に動いていれば true。
  let moving = deltaMoving;
  for (const key of ["early", "late"] as const) {
    const req = requiredAction(setup, seat, key);
    const isAccelMove = req.move === "move" || req.kind === "move";
    const isAccelStop = req.move === "stop" || req.kind === "stop";
    if (!isAccelMove && !isAccelStop) continue;
    const sec = MECHANIC_SEC[key];
    if (elapsed >= sec - 0.6 && elapsed <= sec + 0.6) {
      moving = isAccelMove;
    }
  }

  return { pos, facing, moving };
}
