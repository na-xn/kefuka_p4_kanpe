/**
 * NPC（非操作の7人）の決定的な位置・向き算出（純ロジックのみ・React/DOM 非依存）。
 *
 * 操作席以外の7枚のドットを「実戦で正解の場所に立つ」ように動かし、アリーナを
 * 満員に見せ、視線(魔眼)機構に実プレイヤーがいる感を与える。さらに中央ボスの
 * サンダガ十字／ブリザガ象限／グランドクロスを毎回回避し、全機構をパーフェクトに
 * 処理する。
 *
 * 真実は arena.ts の requiredAction（席が各機構で何をすべきか）と playTimeline.ts の
 * centerResolutions（中央ボス AoE の判定パラメータ）に委譲し、本モジュールは
 * 「いつ・どの目標点へ・どう動くか」だけを決める。
 *
 * NPC が算出した stack/spread/gc3 目標点に立てば、必ず PlayArena と同じ
 * evaluate（同じ zones / role）に合格するよう座標規約を一致させている。中央 AoE
 * の回避ナッジは判定ゾーン半径内に収めるため、頭割り/散開の合否を崩さない。
 */

import type { SimSetup } from "@/p4/simulation";
import {
  type Point,
  CENTER,
  ARENA_RADIUS,
  ZONES,
  ZONE_RADIUS,
  PLAYER_RADIUS,
  clampToArena,
  dist,
  requiredAction,
  roleCardinalPoint,
  exdeathZones,
  gc3BossPos,
  splitColorAt,
  centerAoeSafeGeometry,
  type CenterAoeParams,
  MECHANIC_SEC,
  type MechanicKey,
} from "@/p4/arena";
import { MECH_ORDER, centerResolutions } from "@/p4/playTimeline";

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
/** 解決の何秒前に正解位置へ到達して静止するか（テレグラフ中に「棒立ち」で待つ）。 */
const SETTLE = 1.5;
/** seatHome のリング半径（中心から離して重ならせない）。 */
const HOME_RADIUS = 150;
/** GC3 分断線からの離れ幅（色側に明確に立つ）。 */
const GC3_OFFSET = 110;

/** グランドクロスの解決秒（gc1/gc2/gc3 = 4/16/28）。 */
const GRAND_CROSS_SEC = { gc1: 4, gc2: 16, gc3: 28 } as const;
/** centerSafeNear の広域スキャン上限（グランドクロス退避用）。 */
const SCAN_BIG = ARENA_RADIUS - PLAYER_RADIUS;
/** ブリザガ退避のスキャン上限（判定ゾーン内に必ず収める）。 */
const BLIZZARD_SCAN = ZONE_RADIUS - PLAYER_RADIUS - 6;

/** 視線陣形：視線持ちの中心からの内側距離。 */
const GAZE_INNER = 72;
/** 視線陣形：視線無し席の中心からの外側距離。 */
const GAZE_OUTER = 162;
/** 視線陣形：同ロール内で横に散らす1枚あたりの間隔。 */
const GAZE_FAN = 38;

/** 移動ジッターの振幅（小刻みに動く。ZONE_RADIUS 内に収まる小ささ）。 */
const JITTER_AMP = 7;

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

/** 点がアリーナ内（ドット半径込み）に収まっているか。 */
function insideArena(p: Point): boolean {
  return dist(p, CENTER) + PLAYER_RADIUS <= ARENA_RADIUS + 1e-6;
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
 * 中央ボス AoE を避けつつ preferred になるべく近い安全点を決定的に返す。
 *
 * preferred 自身が安全（かつアリーナ内）ならそのまま採用。さもなくば固定順で
 * スキャン：半径 r=24,48,…,maxDist と 16 方位の格子点を試し、安全な点のうち
 * preferred に最も近いものを返す（r 昇順で走査し最初に見つかった半径内で最近）。
 * 安全点が一つも無ければ preferred をクランプして返す（フォールバック）。
 *
 * 完全に決定的（固定スキャン順・RNG 不使用）。
 *
 * @param preferred 望ましい目標点。
 * @param params    centerAoeSafeGeometry の判定パラメータ。
 * @param geometry  "cross" | "thunder" | "blizzard"。
 * @param maxDist   スキャンする最大半径。
 */
export function centerSafeNear(
  preferred: Point,
  params: CenterAoeParams,
  geometry: "cross" | "thunder" | "blizzard",
  maxDist: number,
): Point {
  const pref = clampToArena(preferred);
  if (insideArena(pref) && centerAoeSafeGeometry(pref, params, geometry)) return pref;

  let best: Point | null = null;
  let bestD = Infinity;
  const RINGS = 16;
  for (let r = 24; r <= maxDist + 1e-9; r += 24) {
    for (let a = 0; a < RINGS; a++) {
      const ang = (a / RINGS) * Math.PI * 2;
      const cand = clampToArena({
        x: preferred.x + Math.cos(ang) * r,
        y: preferred.y + Math.sin(ang) * r,
      });
      if (!insideArena(cand)) continue;
      if (!centerAoeSafeGeometry(cand, params, geometry)) continue;
      const d = dist(cand, preferred);
      if (d < bestD) {
        bestD = d;
        best = cand;
      }
    }
    // この半径帯で安全点が見つかったら、より遠い帯は探さない（最近を優先）。
    if (best) return best;
  }
  return pref;
}

/** 中央 AoE インスタンス → {params, geometry} の決定的な索引を作る。 */
function centerIndex(setup: SimSetup): Record<string, { params: CenterAoeParams; geometry: "cross" | "thunder" | "blizzard" }> {
  const idx: Record<string, { params: CenterAoeParams; geometry: "cross" | "thunder" | "blizzard" }> = {};
  for (const cr of centerResolutions(setup)) {
    idx[cr.instance] = { params: cr.params, geometry: cr.geometry };
  }
  return idx;
}

/**
 * 視線（魔眼）陣形のスポットを返す（南北の縦隊形）。
 *
 * TH は北（上＝y 負側）、DPS は南（下＝y 正側）に分かれる。視線持ち(look/hide)は
 * 中心に近い内周（GAZE_INNER）、視線無しは外周（GAZE_OUTER）に立つので、
 * 同ロール内で「視線持ちが中央寄り」になり判別できる。横方向はロール群
 * （TH=[0,1,2,3] / DPS=[4,5,6,7]）内の通し番号で扇状に散らし、重なりを避ける。
 *
 * @param key "juso1"(早=57) | "juso2"(遅=79)。
 */
export function gazeFormationSpot(setup: SimSetup, seat: number, key: "juso1" | "juso2"): Point {
  const player = setup.players.find((p) => p.seat === seat);
  if (!player) throw new Error(`seat ${seat} not found`);
  const sideY = player.role === "TH" ? -1 : 1;
  const req = requiredAction(setup, seat, key);
  const hasGaze = req.kind === "look" || req.kind === "hide";
  const radial = hasGaze ? GAZE_INNER : GAZE_OUTER;
  // ロール群内インデックス（0..3）で横に扇状配置。
  const groupIdx = player.role === "TH" ? seat : seat - 4;
  const xFan = (groupIdx - 1.5) * GAZE_FAN;
  return clampToArena({ x: CENTER.x + xFan, y: CENTER.y + sideY * radial });
}

/**
 * 1回目視線（juso1=57）の陣形スポット。
 *
 * 2回目視線（gazeFormationSpot）と「視線持ち=内 / 無し=外・TH=北 / DPS=南」の
 * 構造は完全に同じだが、同時刻に解決するサンダガ（雷十字）の「安置直線」に沿って、
 * かつ中央に最も近い安置帯に配置する。雷十字の安置は対角レーン（rotX または rotY が
 * 一定の向き）に連続するので、その軸 u に沿って並べれば全員が安置に収まる。
 *
 *  - u: 安置レーンの軸（pattern<2 → (1,1) / それ以外 → (1,-1)）。y≥0（南向き）に正規化。
 *  - A: 中央に最も近い安置アンカー（perp 方向にスキャンして発見）。
 *  - 各席: A ± u·radial（視線持ち=GAZE_INNER で中央寄り / 無し=GAZE_OUTER）。
 *         TH=-u(北側) / DPS=+u(南側)。perp 方向に控えめな扇で重なり回避（安置帯内）。
 */
function gazeFormationSpotJuso1(setup: SimSetup, seat: number): Point {
  const player = setup.players.find((p) => p.seat === seat);
  if (!player) throw new Error(`seat ${seat} not found`);
  const sd = centerIndex(setup)["sandaga"];
  if (!sd) return gazeFormationSpot(setup, seat, "juso1");
  const params = sd.params;

  // 安置レーン軸 u（rotX/rotY が一定＝安置が連続する向き）。南向き(y≥0)に正規化。
  let u = unit(params.thunderPattern < 2 ? { x: 1, y: 1 } : { x: 1, y: -1 });
  if (u.y < 0) u = { x: -u.x, y: -u.y };
  const perp = { x: -u.y, y: u.x };

  // 安置アンカー A：perp（レーン横断）方向に sample し、中央に最も近い安置サンプルを
  // 見つけ、その連続安置区間 [dL,dR] の「中央」に A を置く（帯の縁ではなく中心に置くこと
  // で、後段の扇(fan)で帯からはみ出して被弾するのを防ぐ）。安置は perp 座標だけで決まる
  // ので、A と同じ perp 座標なら u 方向に幾ら動いても安置に留まる。
  const perpSafe = (d: number): boolean =>
    centerAoeSafeGeometry({ x: CENTER.x + perp.x * d, y: CENTER.y + perp.y * d }, params, "thunder");
  const STEP = 4;
  const RANGE = 264;
  let near: number | null = null;
  for (let d = 0; d <= RANGE; d += STEP) {
    if (perpSafe(d)) { near = d; break; }
    if (perpSafe(-d)) { near = -d; break; }
  }
  let A: Point = { x: CENTER.x, y: CENTER.y };
  if (near !== null) {
    let dL = near;
    let dR = near;
    while (dL - STEP >= -RANGE && perpSafe(dL - STEP)) dL -= STEP;
    while (dR + STEP <= RANGE && perpSafe(dR + STEP)) dR += STEP;
    const dMid = (dL + dR) / 2;
    A = { x: CENTER.x + perp.x * dMid, y: CENTER.y + perp.y * dMid };
  }

  const req = requiredAction(setup, seat, "juso1");
  const hasGaze = req.kind === "look" || req.kind === "hide";
  const radial = hasGaze ? GAZE_INNER : GAZE_OUTER;
  const along = player.role === "TH" ? -1 : 1; // TH=北(-u) / DPS=南(+u)。
  const groupIdx = player.role === "TH" ? seat : seat - 4;
  const fan = (groupIdx - 1.5) * GAZE_FAN * 0.5; // perp 方向の扇（安置帯内に収める控えめ幅）。
  return clampToArena({
    x: A.x + u.x * along * radial + perp.x * fan,
    y: A.y + u.y * along * radial + perp.y * fan,
  });
}

/**
 * 席 seat の、機構 key における目標点を返す（目標が無い＝kind:"none" は null）。
 *
 * - stack/filler/spread: ロール別カーディナル（早=exdeathZones / 遅=ZONES）。
 *   遅(late)はさらにブリザガ象限を避けるよう判定ゾーン内でナッジする。
 * - gc3: 要求色側に明確に立つ点（splitColorAt が req.color に一致するよう符号選択）。
 * - look/hide: 視線陣形スポット（juso1/juso2）。サンダガ窓(juso1=57)では雷十字を避ける。
 * - aoe/stop/move/none: 位置採点外のため seatHome（重なり回避のみ）。
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
      const isStack = req.kind !== "spread";
      if (key === "early") {
        // 早（t=51）はエクスデス北フレームのカーディナル。中央 AoE は無いので集合点そのまま。
        const zones = exdeathZones(setup.gc3BossAngle);
        return clampToArena(roleCardinalPoint(player.role, isStack, zones));
      }
      if (key === "late") {
        // 遅（t=74）は固定 ZONES のカーディナルを基準に、ブリザガ象限を避ける。
        // ナッジは ZONE_RADIUS 内に収まるので頭割り/散開の合否は崩れない（安全点が無ければ基準点）。
        const base = roleCardinalPoint(player.role, isStack, ZONES);
        const idx = centerIndex(setup);
        const bz = idx["blizzaga"];
        if (bz) return centerSafeNear(base, bz.params, "blizzard", BLIZZARD_SCAN);
        return clampToArena(base);
      }
      // それ以外（理論上は来ない）は固定 ZONES。
      return clampToArena(roleCardinalPoint(player.role, isStack, ZONES));
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
    case "look":
    case "hide": {
      // 視線陣形。juso1(=57) はサンダガ雷十字の安置レーンに沿った陣形、juso2(=79) は素の縦隊形。
      return key === "juso1"
        ? gazeFormationSpotJuso1(setup, seat)
        : gazeFormationSpot(setup, seat, "juso2");
    }
    case "aoe":
      // つなみ/ほのお（波）の設置は「必ず中心で」行う（中央に集合して AoE を置く）。
      return { x: CENTER.x, y: CENTER.y };
    // 単発移動・停止/none: 位置は採点外。重ならない home を使う。
    case "stop":
    case "move":
      return seatHome(seat);
    default:
      return seatHome(seat);
  }
}

/**
 * juso1/juso2 で「視線を持たない」席の陣形スポットを返す（位置採点は無いが、
 * 視線持ちと一緒に南北隊形を組ませて全体を統制させるため）。
 * juso1 はサンダガ雷十字を避ける。
 */
function gazeFillSpot(setup: SimSetup, seat: number, key: "juso1" | "juso2"): Point {
  // juso1 はサンダガ安置レーンに沿った陣形、juso2 は素の縦隊形。視線無し席も同じ隊形に加わる。
  return key === "juso1" ? gazeFormationSpotJuso1(setup, seat) : gazeFormationSpot(setup, seat, "juso2");
}

/**
 * 席 seat の (時刻, 目標) waypoint 列を構築。
 *
 * 先頭に (0, seatHome)。各機構の目標があれば (解決秒, 目標) を追加し、さらに
 * グランドクロス(4/16/28) の退避点（その席に位置義務が無い瞬間＝サンダガ十字＋
 * ブリザガ象限を避けて待機）と、視線無し席の南北陣形(57/79) も加える。
 * 時刻昇順にソートして返す。
 *
 * 波(ほのお@62 / つなみ@84) には waypoint を置かない：各席が自分の位置に AoE を
 * 落とすだけで NPC には描画/採点されないため、意図的に回避しない（補間で保持）。
 */
function buildWaypoints(setup: SimSetup, seat: number): Waypoint[] {
  const wps: Waypoint[] = [{ time: 0, target: seatHome(seat) }];

  // --- グランドクロス退避（位置義務の無い瞬間に十字＋象限から退く）---
  const idx = centerIndex(setup);
  for (const inst of ["gc1", "gc2", "gc3"] as const) {
    const ci = idx[inst];
    if (!ci) continue;
    const safe = centerSafeNear(seatHome(seat), ci.params, ci.geometry, SCAN_BIG);
    wps.push({ time: GRAND_CROSS_SEC[inst], target: safe });
  }

  // --- 各機構の位置目標 ---
  for (const key of MECH_ORDER) {
    const mk = key as MechanicKey;
    const target = npcTarget(setup, seat, mk);
    if (target) wps.push({ time: MECHANIC_SEC[mk], target });
  }

  // --- 視線陣形：視線を持たない席も juso1/juso2 で南北隊形に加える ---
  for (const jk of ["juso1", "juso2"] as const) {
    const req = requiredAction(setup, seat, jk);
    if (req.kind === "look" || req.kind === "hide") continue; // 視線持ちは npcTarget 側で追加済み。
    wps.push({ time: MECHANIC_SEC[jk], target: gazeFillSpot(setup, seat, jk) });
  }

  // 時刻昇順に安定ソート。
  wps.sort((a, b) => a.time - b.time);
  return wps;
}

/**
 * waypoint 列から elapsed 時点の位置を求める。
 * - 最初の waypoint 時刻より前 → seatHome。
 * - 区間 (a@ta, b@tb): elapsed < tb-LEAD_IN なら a の目標で待機。
 *   それ以降は [tb-LEAD_IN, tb-SETTLE] で a→b を補間し、解決の SETTLE 秒前に到達して
 *   そこから tb まで静止（＝テレグラフ中は正解位置に「棒立ち」で待機し、回避を明示する）。
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
      // 解決(tb)の SETTLE 秒前には到達して以後は静止（テレグラフ中に正解位置で待つ）。
      const arrive = Math.max(startMove + 1e-3, b.time - SETTLE);
      if (elapsed >= arrive) return b.target;
      const t = Math.min(1, Math.max(0, (elapsed - startMove) / (arrive - startMove)));
      return lerp(a.target, b.target, t);
    }
  }
  return wps[wps.length - 1].target;
}

/**
 * 席 seat の NPC 状態を、シミュレーション経過秒 elapsed で算出する。
 *
 * 各機構の目標点へ「その時刻までに到達」するよう滑らかに移動し、それ以外は待機。
 * 視線窓では視線持ちは look→中央を向く / hide→中央に背を向ける。視線無し席も
 * 同じ窓では中央(ボス)を向いて全体を統制する。加速弾「動く」の解決窓では
 * moving=true かつ小刻みなジッターを加え、「止まる」では静止する。
 * 戻り値は (setup, seat, elapsed) から完全に決定的。
 */
export function npcState(setup: SimSetup, seat: number, elapsed: number): NpcState {
  const wps = buildWaypoints(setup, seat);
  let pos = clampToArena(posAt(wps, elapsed));

  // 移動方向（小 dt で前位置をサンプリング）。
  const prev = clampToArena(posAt(wps, elapsed - 0.1));
  const deltaMoving = dist(pos, prev) > 0.01;

  // --- 向き ---
  // 視線窓は juso1(57) / juso2(79) のいずれも対象。視線持ちは look/hide、
  // 視線無し席も同じ窓では中央(ボス)を向いて統制する。
  let facing: Point = { x: 0, y: -1 };
  let inGaze = false;
  for (const jk of ["juso1", "juso2"] as const) {
    const resolveSec = MECHANIC_SEC[jk];
    if (elapsed < resolveSec - LEAD_IN || elapsed > resolveSec + 1.5) continue;
    inGaze = true;
    const req = requiredAction(setup, seat, jk);
    const toCenter = { x: CENTER.x - pos.x, y: CENTER.y - pos.y };
    if (req.kind === "look") {
      facing = dist(pos, CENTER) < 1e-6 ? { x: 0, y: -1 } : unit(toCenter);
    } else if (req.kind === "hide") {
      facing = dist(pos, CENTER) < 1e-6 ? { x: 0, y: 1 } : unit({ x: -toCenter.x, y: -toCenter.y });
    } else {
      // 視線無し席：中央(ボス)を向く（中立）。
      facing = dist(pos, CENTER) < 1e-6 ? { x: 0, y: -1 } : unit(toCenter);
    }
    break; // 早い窓を優先（同時に両窓が重なることはない）。
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

  // --- moving + ジッター ---
  // 操作席視点の env 機構（早=51/遅=74）が加速弾「動く」(req.move==="move" or kind==="move")で、
  // かつその解決±1.2s 以内なら moving=true かつ小刻みジッター。「止まる」なら静止(false)。
  // それ以外の窓は補間で実際に動いていれば true。
  let moving = deltaMoving;
  for (const key of ["early", "late"] as const) {
    const req = requiredAction(setup, seat, key);
    const isAccelMove = req.move === "move" || req.kind === "move";
    const isAccelStop = req.move === "stop" || req.kind === "stop";
    if (!isAccelMove && !isAccelStop) continue;
    const sec = MECHANIC_SEC[key];
    if (elapsed < sec - 1.2 || elapsed > sec + 1.2) continue;
    if (isAccelMove) {
      moving = true;
      // 決定的な小刻み振動（ZONE_RADIUS 内に収まる小ささ＝合否を崩さない）。
      pos = clampToArena({
        x: pos.x + Math.sin(elapsed * 13) * JITTER_AMP,
        y: pos.y + Math.cos(elapsed * 11) * JITTER_AMP,
      });
    } else {
      // 「止まる」：静止・ジッター無し。
      moving = false;
    }
  }

  return { pos, facing, moving };
}
