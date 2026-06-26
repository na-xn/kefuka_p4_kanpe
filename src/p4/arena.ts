/**
 * プレイアリーナの純ジオメトリ + 位置判定ヘルパー。
 *
 * iSerika/umad-kefka4-ja の sim.html の判定ロジックを忠実移植したもの。
 * 「何をするか（散開/頭割り/止まる…）」は src/p4/logic.ts（我々のモデル）から、
 * 「どこに/どう判定するか」は本モジュール（参照のジオメトリ）から取る。
 *
 * React コンポーネント（PlayArena.tsx）はこの純関数の薄いラッパに留める。
 */

import type { SimSetup, Truth } from "@/p4/simulation";
import { toMinState } from "@/p4/simulation";
import { raiMizuAction, accel, juso, tsunamiHonooAction, seishi, magicFinal } from "@/p4/logic";

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
 * エクスデス（外周分断ボス）を北とする回転ゾーン
 *
 * 1回目（早 t=51）の水雷処理は「エクスデスが出現した方向を北」として
 * 散会基準を回す。標準ゾーン（h12=北 …）を CENTER まわりに回転させ、
 * エクスデス方向が北（h12）に一致するようにする。
 * 2回目（遅 t=74）は標準の固定ゾーン（h12/h3/h6/h9）をそのまま使う。
 * ========================================================== */

/** 標準「北」(h12 方向) のキャンバス角度。h12=(CENTER, CENTER-180) なので -PI/2。 */
export const NORTH_ANGLE = -Math.PI / 2;

/**
 * gc3BossAngle(0..7) から「エクスデス北」への回転量（ラジアン）。
 * エクスデス方向角 = gc3BossAngle*PI/4（gc3BossPos と同じ atan2 規約）。
 * 回転量 = エクスデス方向 − 標準北。これを標準ゾーンに足すと北がエクスデスへ向く。
 */
export function exdeathNorthRotation(gc3BossAngle: number): number {
  const exdeathAngle = (gc3BossAngle * Math.PI) / 4;
  return exdeathAngle - NORTH_ANGLE;
}

/** 点 p を CENTER まわりに angle ラジアン回転する。 */
export function rotateAround(p: Point, angle: number, center: Point = CENTER): Point {
  const dx = p.x - center.x;
  const dy = p.y - center.y;
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  return {
    x: center.x + dx * c - dy * s,
    y: center.y + dx * s + dy * c,
  };
}

/**
 * エクスデス北フレームでの各ゾーン中心。
 * 標準 ZONES を exdeathNorthRotation(gc3BossAngle) だけ CENTER まわりに回す。
 */
export function exdeathZones(gc3BossAngle: number): Record<ZoneKey, Point> {
  const rot = exdeathNorthRotation(gc3BossAngle);
  return {
    h12: rotateAround(ZONES.h12, rot),
    h3: rotateAround(ZONES.h3, rot),
    h6: rotateAround(ZONES.h6, rot),
    h9: rotateAround(ZONES.h9, rot),
  };
}

/** 点 p が、指定された（回転済み）ゾーン中心の判定円内か（< ZONE_RADIUS）。 */
export function inZoneAt(p: Point, zoneCenter: Point): boolean {
  return dist(p, zoneCenter) < ZONE_RADIUS;
}

/* ============================================================
 * ロール別 水雷/フィラー カーディナル（A=北 / B=東 / C=南 / D=西）
 *
 * 頭割り(stack/filler) / 散開(spread) の解決で、席のロール(TH/DPS)に応じて
 * 立つべき単一のカーディナルを定める（汎用 h12/h6 ・ h3/h9 のペアではなく）。
 *   A=北=h12, B=東=h3, C=南=h6, D=西=h9。
 *   TH: 頭割り→A(h12) / 散開→D(h9)。
 *   DPS: 頭割り→C(h6) / 散開→B(h3)。
 * 1回目（早 t=51）はエクスデス北フレーム（exdeathZones）で、2回目（遅 t=74）は
 * 固定 ZONES で判定する。
 * ========================================================== */

/** ロール + 頭割りか(isStack) → 立つべきゾーンキー。 */
export function roleCardinal(role: "TH" | "DPS", isStack: boolean): ZoneKey {
  if (role === "TH") return isStack ? "h12" : "h9";
  return isStack ? "h6" : "h3";
}

/** ゾーンキー → カーディナル表示（文字 + 方角）。 */
export const CARDINAL_LABEL: Record<ZoneKey, string> = {
  h12: "A(北)",
  h3: "B(東)",
  h6: "C(南)",
  h9: "D(西)",
};

/**
 * ロール + 頭割りか → 立つべきカーディナルの表示ラベル（"A(北)" 等）。
 * 早(エクスデス北フレーム)/遅(固定)いずれも「論理カーディナル」は同じ
 * （TH 頭割り=A/散開=D・DPS 頭割り=C/散開=B）。回転は座標にのみ効く。
 */
export function roleCardinalLabel(role: "TH" | "DPS", isStack: boolean): string {
  return CARDINAL_LABEL[roleCardinal(role, isStack)];
}

/** ロール + 頭割りか + （回転済み）ゾーンマップ → 立つべき点。 */
export function roleCardinalPoint(
  role: "TH" | "DPS",
  isStack: boolean,
  zones: Record<ZoneKey, Point> = ZONES,
): Point {
  return zones[roleCardinal(role, isStack)];
}

/**
 * ロール別の水雷/フィラー判定。指定カーディナル（単一）に居れば合格。
 *
 * @param role    席ロール（TH/DPS）。
 * @param isStack 頭割り(true) / 散開(false)。
 * @param p       プレイヤー位置。
 * @param zones   ゾーンマップ（早=exdeathZones、遅=ZONES）。
 */
export function evaluateRoleWater(
  role: "TH" | "DPS",
  isStack: boolean,
  p: Point,
  zones: Record<ZoneKey, Point> = ZONES,
): { ok: boolean; reason: string } {
  const key = roleCardinal(role, isStack);
  if (inZoneAt(p, zones[key])) return { ok: true, reason: "" };
  const verb = isStack ? "頭割り" : "散開";
  return { ok: false, reason: `${verb}: ${CARDINAL_LABEL[key]} に居ません` };
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

/**
 * ジオメトリ種別を考慮した中央 AoE 安全判定。
 *
 * - "cross"（グランドクロス）: サンダガ十字 + ブリザガ象限の両面（= centerAoeSafe）。
 * - "thunder"（単発サンダガ）: 雷十字のみで判定（象限は無視）。参照 checkThundergaSafety。
 * - "blizzard"（単発ブリザガ）: 象限のみで判定（雷十字は無視）。参照 checkBlizzagaSafety。
 */
export function centerAoeSafeGeometry(
  p: Point,
  params: CenterAoeParams,
  geometry: "cross" | "thunder" | "blizzard",
): boolean {
  if (geometry === "thunder") {
    const inThunder = inThunderStrip(p, params.thunderPattern);
    return !(params.sandagaShin ? inThunder : !inThunder);
  }
  if (geometry === "blizzard") {
    const inBlizzard = inBlizzardQuadrant(p, params.blizzardPattern);
    return !(params.blizzagaShin ? inBlizzard : !inBlizzard);
  }
  return centerAoeSafe(p, params);
}

/* ============================================================
 * 最終記憶 / マジックアウト（過去×未来の真偽合成）
 * ========================================================== */

/** 最終記憶の合成結果（合成済み真偽 + 中央 AoE 判定パラメータ）。 */
export type FinalMemoryComposite = {
  /** 合成済みサンダガ真偽（記憶 XNOR リビール）。shin=表示十字が実発火（避ける）。 */
  thunda: Truth;
  /** 合成済みブリザガ真偽（記憶 XNOR リビール）。shin=表示象限が実発火（避ける）。 */
  blizza: Truth;
  /** centerAoeSafe / centerAoeSafeGeometry("cross") へ渡す判定パラメータ。 */
  params: CenterAoeParams;
};

/**
 * 最終記憶 / マジックアウトの真偽合成（純関数・参照 checkFinalMemorySafety）。
 *
 * 記憶した mid-fight サンダガ/ブリザガ真偽（setup.centerAoE.sandaga.truth /
 * .blizzaga.truth）と、マジックアウトのリビール真偽（finalMemory.sandagaOut /
 * .blizzagaOut）を XNOR で合成する（magicFinal）:
 *   - リビール 真(shin) → 記憶どおり（記憶=真なら合成=真）。
 *   - リビール 偽(gi)   → 反転（記憶=真なら合成=偽）。
 * これは参照の `(pastVal * futureVal) === 1`（両者が同符号=同一なら真）と一致する
 * （magicFinal は memory === out のとき "shin"、不一致のとき "gi" を返す）。
 *
 * 合成真偽 shin のとき表示十字/象限が実発火 → そこを避ける（centerAoeSafe と同規約）。
 */
export function finalMemoryComposite(setup: SimSetup): FinalMemoryComposite {
  const fm = setup.centerAoE.finalMemory;
  // 記憶した mid-fight サンダガ/ブリザガ真偽（「最初のマジックチャージ」）。
  const memThunda = setup.centerAoE.sandaga.truth;
  const memBlizza = setup.centerAoE.blizzaga.truth;
  // XNOR 合成（magicFinal は null を返さない＝両引数とも有効な Truth）。
  const thunda = magicFinal(memThunda, fm.sandagaOut) as Truth;
  const blizza = magicFinal(memBlizza, fm.blizzagaOut) as Truth;
  return {
    thunda,
    blizza,
    params: {
      thunderPattern: fm.thunderPattern,
      blizzardPattern: fm.blizzardPattern,
      sandagaShin: thunda === "shin",
      blizzagaShin: blizza === "shin",
    },
  };
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

/**
 * タイムライン終了秒。最終記憶 AoE の解決（≈87s）後にクロックを停止する基準。
 * elapsed >= END_SEC でクロックを END_SEC に凍結し、採点ループを止める。
 */
export const END_SEC = 90;

/** 各機構の解決秒（sim クロック・1x 基準）。 */
export const MECHANIC_SEC: Record<MechanicKey, number> = {
  gc3: 41,
  early: 51,
  juso1: 57,
  honoo: 62,
  late: 74,
  juso2: 79,
  tsunami: 84,
};

/**
 * つなみ/ほのお（FLAME/FLOOD）の「設置→起爆」遅延（秒）。
 *
 * 参照 sim.html processDebuffTrigger: デバフタイマー満了（= MECHANIC_SEC.honoo/tsunami）
 * の瞬間にプレイヤー位置へ AoE を「設置」し、detonationTime = placeTime + 3000ms で
 * 起爆＝被弾判定する（update ループの subBossPlacedAoEs ハンドラ）。
 * したがって 設置 = 62(ほのお)/84(つなみ)、起爆・死亡判定 = 65/87。
 */
export const WAVE_DETONATE_DELAY = 3;

/** ある機構の「設置秒」（つなみ/ほのお は MECHANIC_SEC、それ以外も同じ）。 */
export function mechanicPlaceSec(key: MechanicKey): number {
  return MECHANIC_SEC[key];
}

/**
 * ある機構の「死亡判定秒」。
 * つなみ/ほのお は 設置+WAVE_DETONATE_DELAY（起爆時）に判定。それ以外は設置秒で即判定。
 */
export function mechanicResolveSec(key: MechanicKey): number {
  if (key === "honoo" || key === "tsunami") return MECHANIC_SEC[key] + WAVE_DETONATE_DELAY;
  return MECHANIC_SEC[key];
}

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
  /**
   * 同じ env スロット（早=51/遅=74）で水雷(位置)と加速弾(移動)が衝突したとき、
   * 位置要求(stack/spread/filler)に相乗りする加速弾の移動要求。
   * 止まる→"stop" / 動く→"move"。カンペ buildTimeline の「頭割り・止まる」等の合体に対応。
   */
  move?: "stop" | "move";
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
  // 加速度系の早/遅は加速弾の法則（視線→GC1早/GC2遅・無職→GC1遅/GC2早）。
  // 逆GCで決まり、水の逆とは限らない（カンペ buildTimeline の accelWhen と一致）。
  const accelGc = waterGc === "1" ? "2" : "1";
  const accelEarly = accelGc === "1" ? accelIsShisen : !accelIsShisen;

  if (key === "gc3") {
    // 分断ボスのキャスト真偽（うそ=gi なら gc3RequiredColor 内でアラガン/超越を反転）。
    const bossShin = setup.gc3SplitTruth === "shin";
    const color = gc3RequiredColor(player.gc3Role, player.gc3Scar, bossShin);
    return { kind: "gc3", label: seishi(player.gc3Role) ?? "", color };
  }

  // --- 加速度系タイミング（視線 or 無職）---
  // 視線(shisen): juso1(57, 早) / juso2(79, 遅)。
  // 無職(mushoku): 加速度爆弾。早=51 / 遅=74 に解決（水雷と同じ位置帯のタイミング）。
  // 加速度系（視線/無職）は必ず「加速弾(爆弾)」を持つ。爆弾は env チェック（早=51/遅=74）で解決。
  // 視線(shisen)は加えて「視線(魔眼)」も持ち、これは juso（早=57/遅=79）で解決する。
  // 参照 sim.html assignGimmickDebuffs: SET2 = BOMB(+EYE)。
  const waterMechanicSec: MechanicKey = waterEarly ? "early" : "late";
  const bombKey: MechanicKey = accelEarly ? "early" : "late";

  // --- 水雷タイミング（早=51 / 遅=74）---
  if (key === waterMechanicSec) {
    const truth = (waterTruthShin ? "shin" : "gi") as "shin" | "gi";
    const action = raiMizuAction(waterType, truth) ?? "";
    const kind: RequiredKind = action === "頭割り" ? "stack" : "spread";
    // 加速弾が同じ env スロットに着弾するなら（waterEarly === accelEarly）、
    // 位置(頭割り/散開)に加速弾の移動(止/動)を合体させる（カンペ buildTimeline と一致）。
    if (bombKey === waterMechanicSec) {
      const accelTruth = (accelTruthShin ? "shin" : "gi") as "shin" | "gi";
      const accelAction = accel(accelTruth) ?? "";
      const move: "stop" | "move" = accelAction === "止まる" ? "stop" : "move";
      return { kind, label: `${action}・${accelAction}`, move };
    }
    return { kind, label: action };
  }

  if (key === bombKey) {
    // 加速度系(無職/視線)は自分の水雷が無いこのスロットで「頭割りの頭数」に入る＝filler。
    // さらに加速弾の止/動も同時に処理する（カンペ buildTimeline の「頭割り・止まる/動く」）。
    // 位置(filler=頭割りカーディナル)＋移動(止/動)の両方を判定する。
    const truth = (accelTruthShin ? "shin" : "gi") as "shin" | "gi";
    const accelAction = accel(truth) ?? "";
    const move: "stop" | "move" = accelAction === "止まる" ? "stop" : "move";
    return { kind: "filler", label: `頭割り・${accelAction}`, move };
  }
  if (accelIsShisen) {
    // 視線（魔眼）の解決。早→juso1(57) / 遅→juso2(79)。
    const jusoKey: MechanicKey = accelEarly ? "juso1" : "juso2";
    if (key === jusoKey) {
      const truth = (accelTruthShin ? "shin" : "gi") as "shin" | "gi";
      const action = juso(truth) ?? "";
      // 見ない → 中央に背を向ける(hide) / 見る → 中央を向く(look)。
      const kind: RequiredKind = action === "見ない" ? "hide" : "look";
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
 * 位置要求(stack/spread/filler)に相乗りした加速弾の移動要求(req.move)を判定する。
 * move 無指定なら合格。stop→移動中で不合格 / move→停止中で不合格（standalone と同じ理由）。
 */
function evaluateMove(req: RequiredAction, moving: boolean): { ok: boolean; reason: string } {
  if (!req.move) return { ok: true, reason: "" };
  if (req.move === "stop" && moving)
    return { ok: false, reason: "加速度爆弾: 止まっていない！" };
  if (req.move === "move" && !moving)
    return { ok: false, reason: "加速度爆弾: 動いていない！" };
  return { ok: true, reason: "" };
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
  /**
   * 位置ゾーン中心（頭割り/散開判定用）。未指定なら標準 ZONES（固定 h12/h3/h6/h9）。
   * 1回目（早 t=51）の水雷処理では exdeathZones(gc3BossAngle) を渡してエクスデス北で判定する。
   */
  zones: Record<ZoneKey, Point> = ZONES,
  /**
   * 席のロール（TH/DPS）。stack/filler/spread の水雷/フィラー位置判定は
   * ロール別の単一カーディナル（TH 頭割り=A(h12)/散開=D(h9)・DPS 頭割り=C(h6)/散開=B(h3)）で行う。
   * これを指定しないと「頭割りは h12 でも h6 でも合格」という旧来のロール非依存判定になり、
   * DPS が TH カーディナルに立っても通ってしまう（本バグの原因）。指定すれば必ずロール別判定。
   */
  role?: "TH" | "DPS",
): { ok: boolean; reason: string } {
  switch (req.kind) {
    case "none":
      return { ok: true, reason: "" };
    case "stack":
    case "filler":
    case "spread": {
      // ロール指定時は必ずロール別カーディナル判定（TH/DPS で立つ場所が違う）。
      if (role) {
        const isStack = req.kind !== "spread";
        const rw = evaluateRoleWater(role, isStack, p, zones);
        if (!rw.ok) return rw;
        return evaluateMove(req, moving);
      }
      // ロール非指定（旧来のテスト互換）: ロール非依存の寛容判定。
      if (req.kind === "spread") {
        if (!inZoneAt(p, zones.h3) && !inZoneAt(p, zones.h9))
          return { ok: false, reason: "散開位置（3時/9時）から外れています" };
        return evaluateMove(req, moving);
      }
      if (!inZoneAt(p, zones.h12) && !inZoneAt(p, zones.h6))
        return { ok: false, reason: "頭割り位置（12時/6時）から外れています" };
      if (inZoneAt(p, zones.h3) || inZoneAt(p, zones.h9))
        return { ok: false, reason: "頭割りタイミングで 3時/9時 に入っています" };
      return evaluateMove(req, moving);
    }
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
