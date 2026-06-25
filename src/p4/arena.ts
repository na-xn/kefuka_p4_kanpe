/**
 * プレイアリーナの純ジオメトリ + 位置判定ヘルパー。
 *
 * iSerika/umad-kefka4-ja の sim.html の判定ロジックを忠実移植したもの。
 * 「何をするか（散開/頭割り/止まる…）」は src/p4/logic.ts（我々のモデル）から、
 * 「どこに/どう判定するか」は本モジュール（参照のジオメトリ）から取る。
 *
 * React コンポーネント（PlayArena.tsx）はこの純関数の薄いラッパに留める。
 */

import type { SimSetup } from "@/p4/simulation";
import { toMinState } from "@/p4/simulation";
import { raiMizuAction, accel, juso, tsunamiHonooAction, seishi } from "@/p4/logic";

/* ============================================================
 * アリーナ定数（参照 sim.html 準拠）
 * ========================================================== */

/** 論理キャンバス幅/高さ（800×800）。表示時はコンテナ幅へスケールする。 */
export const ARENA_SIZE = 800;
/** アリーナ中心。 */
export const CENTER = { x: 400, y: 400 } as const;
/** アリーナ半径。 */
export const ARENA_RADIUS = 300;
/** プレイヤードット半径。 */
export const PLAYER_RADIUS = 12;
/** 位置ゾーン判定半径（h12/h3/h6/h9）。 */
export const ZONE_RADIUS = 120;

/** 位置ゾーン中心（invisibleObjects 準拠）。h12=(400,220) など。 */
export const ZONES = {
  h12: { x: CENTER.x, y: CENTER.y - 180 },
  h3: { x: CENTER.x + 180, y: CENTER.y },
  h6: { x: CENTER.x, y: CENTER.y + 180 },
  h9: { x: CENTER.x - 180, y: CENTER.y },
} as const;

export type ZoneKey = keyof typeof ZONES;

/** つなみ/ほのお AoE: 円範囲半径。 */
export const AOE_CIRCLE_RADIUS = 120;
/** つなみ/ほのお AoE: ドーナツ内径。 */
export const AOE_DONUT_INNER = 80;
/** つなみ/ほのお AoE: ドーナツ外径。 */
export const AOE_DONUT_OUTER = 220;

/** GC3 分断ボスの外周半径（mapRadius - 30）。 */
export const GC3_BOSS_RADIUS = ARENA_RADIUS - 30;

/* ============================================================
 * 基本ジオメトリ
 * ========================================================== */

export type Point = { x: number; y: number };

/** 2点間距離。 */
export function dist(a: Point, b: Point): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

/** 点がアリーナ内に収まるようクランプ（中心からの距離が半径-ドット半径以下）。 */
export function clampToArena(p: Point, radius = PLAYER_RADIUS): Point {
  const d = dist(p, CENTER);
  const max = ARENA_RADIUS - radius;
  if (d + radius <= ARENA_RADIUS) return { x: p.x, y: p.y };
  const ang = Math.atan2(p.y - CENTER.y, p.x - CENTER.x);
  return {
    x: CENTER.x + Math.cos(ang) * max,
    y: CENTER.y + Math.sin(ang) * max,
  };
}

/** 点が指定ゾーンの判定円内か（< ZONE_RADIUS）。 */
export function inZone(p: Point, zone: ZoneKey): boolean {
  return dist(p, ZONES[zone]) < ZONE_RADIUS;
}

/** 頭割り位置（h12 または h6）にいて、かつ h3/h9 に入っていない。 */
export function inStackZone(p: Point): boolean {
  return (inZone(p, "h12") || inZone(p, "h6")) && !inZone(p, "h3") && !inZone(p, "h9");
}

/** 散開位置（h3 または h9）にいる。 */
export function inSpreadZone(p: Point): boolean {
  return inZone(p, "h3") || inZone(p, "h9");
}

/* ============================================================
 * 視線（魔眼）
 * ========================================================== */

/**
 * 最終移動方向 dir が中央ボスを向いているか。
 * dot(dir, center - p) > 0 なら向いている（参照 isFacingBossA）。
 */
export function isFacingCenter(p: Point, dir: Point): boolean {
  const toBossX = CENTER.x - p.x;
  const toBossY = CENTER.y - p.y;
  return dir.x * toBossX + dir.y * toBossY > 0;
}

/* ============================================================
 * つなみ/ほのお AoE 形状 + 安全判定
 * ========================================================== */

export type AoeShape = "CIRCLE" | "DONUT";

/**
 * 波属性 + 真偽 から AoE 形状を決める。
 * FLAME(ほのお)+ほんと→CIRCLE / +うそ→DONUT
 * FLOOD(つなみ)+ほんと→DONUT / +うそ→CIRCLE
 * （真偽は "shin"=ほんと / "gi"=うそ）。
 */
export function aoeShape(wave: "honoo" | "tsunami", truthShin: boolean): AoeShape {
  if (wave === "honoo") return truthShin ? "CIRCLE" : "DONUT";
  return truthShin ? "DONUT" : "CIRCLE";
}

/**
 * AoE 原点 origin に対し点 p が安全か。
 * CIRCLE: 原点から AOE_CIRCLE_RADIUS より外。
 * DONUT: 内径より内 または 外径より外。
 */
export function isAoeSafe(p: Point, origin: Point, shape: AoeShape): boolean {
  const d = dist(p, origin);
  if (shape === "CIRCLE") return d > AOE_CIRCLE_RADIUS;
  // DONUT
  return d < AOE_DONUT_INNER || d > AOE_DONUT_OUTER;
}

/* ============================================================
 * GC3 分断
 * ========================================================== */

export type SplitColor = "PINK" | "BLUE";

/** 角度インデックス(0..7) → ボスの外周位置。 */
export function gc3BossPos(angleIndex: number): Point {
  const ang = (angleIndex * Math.PI) / 4;
  return {
    x: CENTER.x + Math.cos(ang) * GC3_BOSS_RADIUS,
    y: CENTER.y + Math.sin(ang) * GC3_BOSS_RADIUS,
  };
}

/**
 * 点 p がボス→中心の分断線のどちら側か（PINK / BLUE）。
 * cross( center-boss, p-boss ) >= 0 → PINK、< 0 → BLUE（参照準拠）。
 */
export function splitColorAt(p: Point, boss: Point): SplitColor {
  const vX = p.x - boss.x;
  const vY = p.y - boss.y;
  const bCenterX = CENTER.x - boss.x;
  const bCenterY = CENTER.y - boss.y;
  const cross = bCenterX * vY - bCenterY * vX;
  return cross >= 0 ? "PINK" : "BLUE";
}

/**
 * GC3 で立つべき色を求める。
 * - 傷: 死者(shisha)=BLUE / 生者(seija)=PINK（DEAD_SCAR=blue, LIVE_SCAR=pink）。
 * - 役割: アラガン(aragan)=反対色 / 死の超越(shi)=同色。
 * - ボス真偽 うそ(gi) の場合はアラガン/超越の解釈を反転（参照: !isBossTruth で isAlagField 反転）。
 *
 * @param role  "aragan" | "shi"
 * @param scar  "seija"(生者=pink) | "shisha"(死者=blue)
 * @param bossTruthShin ボスのキャスト真偽が ほんと(true) か。
 */
export function gc3RequiredColor(
  role: "aragan" | "shi",
  scar: "seija" | "shisha",
  bossTruthShin: boolean,
): SplitColor {
  const scarColor: SplitColor = scar === "shisha" ? "BLUE" : "PINK";
  // isAlagField: アラガン=true（反対色）。うそなら反転。
  let opposite = role === "aragan";
  if (!bossTruthShin) opposite = !opposite;
  if (opposite) return scarColor === "BLUE" ? "PINK" : "BLUE";
  return scarColor;
}

/* ============================================================
 * 中央ボス サンダガ(雷十字)/ブリザガ(象限) AoE — 参照 evaluateCurrentPosition 移植
 * ========================================================== */

/** サンダガ雷ストリップの幅（参照 w=175）。 */
export const THUNDER_STRIP_W = 175;

/**
 * 点 p がサンダガ雷ストリップ内か（pattern 0..3）。
 * 参照 evaluateCurrentPosition の rotX/rotY ロジックを忠実移植:
 *   px=p.x-400, py=p.y-400, rotX=(px-py)/√2, rotY=(px+py)/√2, w=175。
 */
export function inThunderStrip(p: Point, pattern: number): boolean {
  const px = p.x - CENTER.x;
  const py = p.y - CENTER.y;
  const rotX = (px - py) / Math.SQRT2;
  const rotY = (px + py) / Math.SQRT2;
  const w = THUNDER_STRIP_W;
  switch (pattern) {
    case 0:
      return (rotX >= -w && rotX < 0) || (rotX >= w && rotX <= 2 * w);
    case 1:
      return (rotX >= -2 * w && rotX < -w) || (rotX >= 0 && rotX < w);
    case 2:
      return (rotY >= -w && rotY < 0) || (rotY >= w && rotY <= 2 * w);
    case 3:
      return (rotY >= -2 * w && rotY < -w) || (rotY >= 0 && rotY < w);
    default:
      return false;
  }
}

/**
 * 点 p がブリザガ象限内か（pattern 0..1）。
 * pattern 0: (px≥0&&py≤0)||(px≤0&&py≥0) の対角2象限。
 * pattern 1: 残りの対角2象限。
 */
export function inBlizzardQuadrant(p: Point, pattern: number): boolean {
  const px = p.x - CENTER.x;
  const py = p.y - CENTER.y;
  if (pattern === 0) {
    return (px >= 0 && py <= 0) || (px <= 0 && py >= 0);
  }
  return (px <= 0 && py <= 0) || (px >= 0 && py >= 0);
}

/** centerAoeSafe の入力。 */
export type CenterAoeParams = {
  thunderPattern: number;
  blizzardPattern: number;
  /** サンダガが ほんと(true) — 表示ストリップが実発火（避ける）。 */
  sandagaShin: boolean;
  /** ブリザガが ほんと(true) — 表示象限が実発火（避ける）。 */
  blizzagaShin: boolean;
};

/**
 * 中央ボス AoE 解決時、点 p が安全か（参照 checkSafety の反転）。
 *
 * 参照: 被弾 = (blizzagaTruth ? inBlizzard : !inBlizzard)
 *            || (sandagaTruth ? inThunder : !inThunder)。
 * ほんと(shin)=表示面が発火 → そこを避ける。
 * うそ(gi)=反対面が発火 → 補集合を避ける。
 *
 * @returns 安全なら true。
 */
export function centerAoeSafe(p: Point, params: CenterAoeParams): boolean {
  const inThunder = inThunderStrip(p, params.thunderPattern);
  const inBlizzard = inBlizzardQuadrant(p, params.blizzardPattern);
  const hitBlizzard = params.blizzagaShin ? inBlizzard : !inBlizzard;
  const hitThunder = params.sandagaShin ? inThunder : !inThunder;
  return !(hitBlizzard || hitThunder);
}

/* ============================================================
 * 席視点の「要求アクション」マッピング
 * ========================================================== */

/** 機構キー（解決秒に対応）。 */
export type MechanicKey =
  | "gc3" // 46s 分断
  | "early" // 51s 早 水雷/加速度
  | "juso1" // 57s 視線 wave1
  | "honoo" // 62s ほのお/つなみ（62 はほのお解決時刻）
  | "late" // 74s 遅 水雷/加速度
  | "juso2" // 79s 視線 wave2
  | "tsunami"; // 84s つなみ

/** 各機構の解決秒（sim クロック・1x 基準）。 */
export const MECHANIC_SEC: Record<MechanicKey, number> = {
  gc3: 46,
  early: 51,
  juso1: 57,
  honoo: 62,
  late: 74,
  juso2: 79,
  tsunami: 84,
};

/** 要求アクションの判定種別。 */
export type RequiredKind = "stack" | "spread" | "filler" | "move" | "stop" | "look" | "hide" | "aoe" | "gc3" | "none";

/** ある機構で席に要求される行動（位置/移動/視線/色）。 */
export type RequiredAction = {
  kind: RequiredKind;
  /** 表示用ラベル（logic.ts 由来）。 */
  label: string;
  /** AoE 形状（kind==="aoe" のみ）。 */
  shape?: AoeShape;
  /** GC3 要求色（kind==="gc3" のみ）。 */
  color?: SplitColor;
  /** つなみ/ほのお のどちらか（kind==="aoe" の補助情報）。 */
  wave?: "honoo" | "tsunami";
};

/** 真偽文字列 → ほんと(true)。 */
function isShin(t: string): boolean {
  return t === "shin";
}

/**
 * 席 seat の、機構 key における要求アクションを返す。
 *
 * 「水雷の早/遅」と「視線の早/遅」と「無職フィラー」は席ごとに解決タイミングが
 * 異なるため、toMinState(setup,seat) の waterGC/waterWhen/shisen と、
 * 各 GC の役割（mizu/rai/shisen/mushoku）から該当機構を割り出す。
 *
 * 該当アクションが無い機構（その席はそのタイミングで暇）の場合は kind:"none"。
 * ただし「無職フィラー」: 水雷も視線も持たないタイミングでは頭割り集合（filler）。
 */
export function requiredAction(setup: SimSetup, seat: number, key: MechanicKey): RequiredAction {
  const player = setup.players.find((p) => p.seat === seat);
  if (!player) throw new Error(`seat ${seat} not found`);
  const ms = toMinState(setup, seat);

  // どの GC が水雷か / 加速度系か。
  const waterGc = ms.waterGC; // "1" | "2"
  const waterEarly = ms.waterWhen === "haya"; // この席の水雷が早か
  const waterType = ms.waterType as "mizu" | "rai";
  const accelIsShisen = ms.shisen === "yes"; // 加速度系の中身: 視線(shisen) か 無職(mushoku)

  // GC1/GC2 真偽。
  const gc1Shin = isShin(ms.gc1);
  const gc2Shin = isShin(ms.gc2);
  // 水雷側 GC の真偽 / 加速度系側 GC の真偽。
  const waterTruthShin = waterGc === "1" ? gc1Shin : gc2Shin;
  const accelTruthShin = waterGc === "1" ? gc2Shin : gc1Shin;
  // 加速度系（視線/無職）は水雷と逆 GC・逆タイミング。
  const accelEarly = !waterEarly;

  if (key === "gc3") {
    const bossShin = true; // 我々のモデルにボス真偽は無いので「ほんと」固定（後段フェーズで拡張可）。
    const color = gc3RequiredColor(player.gc3Role, player.gc3Scar, bossShin);
    return { kind: "gc3", label: seishi(player.gc3Role) ?? "", color };
  }

  // --- 水雷タイミング（早=51 / 遅=74）---
  const waterMechanicSec = waterEarly ? "early" : "late";
  if (key === waterMechanicSec) {
    const truth = (waterTruthShin ? "shin" : "gi") as "shin" | "gi";
    const action = raiMizuAction(waterType, truth) ?? "";
    const kind: RequiredKind = action === "頭割り" ? "stack" : "spread";
    return { kind, label: action };
  }

  // --- 加速度系タイミング（視線 or 無職）---
  // 視線(shisen): juso1(57, 早) / juso2(79, 遅)。
  // 無職(mushoku): 加速度爆弾。早=51 / 遅=74 に解決（水雷と同じ位置帯のタイミング）。
  if (accelIsShisen) {
    // 視線。
    const jusoKey = accelEarly ? "juso1" : "juso2";
    if (key === jusoKey) {
      const truth = (accelTruthShin ? "shin" : "gi") as "shin" | "gi";
      const action = juso(truth) ?? "";
      // 見ない → 中央に背を向ける(hide) / 見る → 中央を向く(look)。
      const kind: RequiredKind = action === "見ない" ? "hide" : "look";
      return { kind, label: action };
    }
  } else {
    // 無職(mushoku): 加速度爆弾。早/遅は accelEarly。
    const bombKey = accelEarly ? "early" : "late";
    if (key === bombKey) {
      const truth = (accelTruthShin ? "shin" : "gi") as "shin" | "gi";
      const action = accel(truth) ?? "";
      // 止まる(stop) / 動く(move)。
      const kind: RequiredKind = action === "止まる" ? "stop" : "move";
      return { kind, label: action };
    }
  }

  // --- 波（ほのお=62 / つなみ=84）---
  if (key === "honoo" || key === "tsunami") {
    const wave = key; // honoo | tsunami
    const truthStr = key === "honoo" ? ms.honoo : ms.tsunami;
    const truthShin = isShin(truthStr);
    const action = tsunamiHonooAction(wave === "honoo" ? "honoo" : "tsunami", (truthShin ? "shin" : "gi") as "shin" | "gi") ?? "";
    const shape = aoeShape(wave, truthShin);
    return { kind: "aoe", label: action, shape, wave };
  }

  // この席はこの機構で行動なし。
  // ただし「フィラー（無職集合）」: 水雷でも視線/無職アクションでもないタイミングのうち
  // early/late の位置帯（51/74）では頭割り集合が要求される（参照 isNoEnvBuff フィラー）。
  if ((key === "early" || key === "late")) {
    return { kind: "filler", label: "頭割り（集合）" };
  }

  return { kind: "none", label: "" };
}

/**
 * 要求アクションに対し、プレイヤーの現在状態が合格か判定する。
 *
 * @param req         requiredAction の結果。
 * @param p           プレイヤー位置。
 * @param dir         最終移動方向（視線判定用）。
 * @param moving      解決時点で移動入力中か（加速度爆弾用）。
 * @param aoeOrigin   AoE 原点（kind==="aoe" のみ。波の置き判定はプレイヤーが置いた位置）。
 * @returns { ok, reason } — 不合格時は reason に失敗理由。
 */
export function evaluate(
  req: RequiredAction,
  p: Point,
  dir: Point,
  moving: boolean,
  aoeOrigin?: Point,
  boss?: Point,
): { ok: boolean; reason: string } {
  switch (req.kind) {
    case "none":
      return { ok: true, reason: "" };
    case "stack":
    case "filler":
      if (!inZone(p, "h12") && !inZone(p, "h6"))
        return { ok: false, reason: "頭割り位置（12時/6時）から外れています" };
      if (inZone(p, "h3") || inZone(p, "h9"))
        return { ok: false, reason: "頭割りタイミングで 3時/9時 に入っています" };
      return { ok: true, reason: "" };
    case "spread":
      if (!inZone(p, "h3") && !inZone(p, "h9"))
        return { ok: false, reason: "散開位置（3時/9時）から外れています" };
      return { ok: true, reason: "" };
    case "stop":
      if (moving) return { ok: false, reason: "加速度爆弾: 止まっていない！" };
      return { ok: true, reason: "" };
    case "move":
      if (!moving) return { ok: false, reason: "加速度爆弾: 動いていない！" };
      return { ok: true, reason: "" };
    case "look":
      if (!isFacingCenter(p, dir))
        return { ok: false, reason: "魔眼[見る]: 中央ボスに背を向けた！" };
      return { ok: true, reason: "" };
    case "hide":
      if (isFacingCenter(p, dir))
        return { ok: false, reason: "魔眼[見ない]: 中央ボスを見てしまった！" };
      return { ok: true, reason: "" };
    case "aoe": {
      if (!aoeOrigin || !req.shape) return { ok: true, reason: "" };
      if (!isAoeSafe(p, aoeOrigin, req.shape))
        return {
          ok: false,
          reason: req.shape === "CIRCLE" ? "円範囲に被弾！" : "ドーナツ範囲に被弾！",
        };
      return { ok: true, reason: "" };
    }
    case "gc3": {
      if (!boss || !req.color) return { ok: true, reason: "" };
      const at = splitColorAt(p, boss);
      if (at !== req.color)
        return {
          ok: false,
          reason: `分断: ${req.color === "PINK" ? "ピンク" : "青"}側に立っていません`,
        };
      return { ok: true, reason: "" };
    }
    default:
      return { ok: true, reason: "" };
  }
}
