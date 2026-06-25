/**
 * 操作プレイ・アリーナの「忠実な」タイムライン（純・テスト可能モジュール）。
 *
 * ============================================================================
 * 参照 iSerika/umad-kefka4-ja sim.html から抽出した実イベントスケジュール。
 *
 * これが実装の契約（CONTRACT）。PlayArena はこのスケジュールに一致させる。
 *
 * ── ボス構成（参照 bosses[]）──
 *   bosses[0] 中央ボス（紫 #9b5de5）: 4s 詠唱。完了で checkSafety()＝
 *             サンダガ十字 + ブリザガ象限（グランドクロス相当）を判定。
 *   bosses[1] 左下サブ（castName=つなみ/ほのお）: 8s 詠唱。完了で
 *             assign11BossDebuff() ＋ currentWave++ ＋ 中央/右下を再詠唱。
 *   bosses[2] 右下サブ: 8s 詠唱。完了で assignGimmickDebuffs()＝
 *             役割デバフ（水圧縮/雷/加速度爆弾/魔眼）と魔眼を席へ付与。
 *
 * ── 中央グランドクロス（cross+quadrant）の解決（mid-fight, 3回）──
 *   t=0 全ボス詠唱開始（currentWave=1）。
 *   t=4   中央ボス詠唱完了 → checkSafety() : GC1 中央 AoE 解決。bosses[1] 再詠唱。
 *   t=8   右下完了 → assignGimmickDebuffs(1)（魔眼1・役割デバフ付与）。
 *   t=12  左下完了 → assign11BossDebuff(1), wave→2, 中央/右下 再詠唱。
 *   t=16  中央完了 → checkSafety() : GC2 中央 AoE 解決。bosses[1] 再詠唱。
 *   t=20  右下完了 → assignGimmickDebuffs(2)（魔眼2・役割デバフ付与）。
 *   t=24  左下完了 → assign11BossDebuff(2), wave→3, 中央/右下 再詠唱。
 *   t=28  中央完了 → checkSafety() : GC3 中央 AoE 解決（wave=3 なので左下は再詠唱しない）。
 *   t=32  右下完了 → assignGimmickDebuffs(3)＝wave3 分岐：傷+エクスデス系デバフ付与、
 *                    wave3TimelineState=CAST_DONE（anchor=32）。
 *
 * ── wave3 分断（エクスデス split）──
 *   t=34  CAST_DONE→VANISHED（サブボス消失, anchor=34）。
 *   t=36  VANISHED→POPUP（外周ランダム位置に分断ボス出現、5s 詠唱・分断 AoE 表示）。
 *   t=41  分断ボス詠唱完了 → checkWave3SplitSafety()：分断（青/ピンク）解決。
 *
 * ── 最終フェーズ finalPhaseTimeline（isSubBossesVanished && 分断ボス非詠唱中で発火）──
 *   t=51  executeEnvironmentCheck(51)：早 水圧縮/雷の頭割り・散開 / 加速度爆弾 止/動
 *                                      / デバフ無し席はフィラー頭割り（12時/6時集合）。
 *   t=53  中央ボス サンダガ 詠唱開始（4s, effect=ほんと/うそ・thunderPattern 0..3）。
 *                pastThundergaTruth 記録。
 *   t=57  サンダガ 詠唱完了 → checkThundergaSafety()：雷十字 解決。
 *                同時に finalPhaseTimeline t=57：魔眼1 解決（executeSingleEyeCheck wave1）。
 *   t=70  中央ボス ブリザガ 詠唱開始（4s, effect・blizzardPattern 0..1）。
 *                pastBlizzagaTruth 記録。
 *   t=74  ブリザガ 詠唱完了 → checkBlizzagaSafety()：象限 解決。
 *                同時に finalPhaseTimeline t=74：executeEnvironmentCheck(74)＝遅 水雷/加速度/フィラー。
 *   t=79  魔眼2 解決（executeSingleEyeCheck wave2）＋ 最終記憶リング表示
 *                （topTruth=未来サンダガ真偽 / bottomTruth=未来ブリザガ真偽）。
 *   t=84  最終記憶 AoE 詠唱開始（3s, thunderPattern/blizzardPattern）。
 *   t=87  checkFinalMemorySafety()：最終記憶 AoE（過去×未来の真偽合成）解決。
 *
 * ── 各キャストの「表示名」（cast NAME）──
 *   中央ボス（グランドクロス）: GC1/GC2/GC3 ともキャスト名は明示されないが、
 *     本実装では「グランドクロス」を表示（真偽は上=サンダガ / 下=ブリザガのリングで表示）。
 *   中央ボス mid-fight: 「サンダガ」(t=53) / 「ブリザガ」(t=70)。
 *   左下サブボス: castName = 「つなみ」or「ほのお」（firstWave11BossGimmick）。
 *   右下サブボス: 役割詠唱（明示名なし。真偽リング表示）。
 *   分断ボス: エクスデス相当（真偽リング表示）。
 *
 * ── つなみ/ほのお の解決秒（debuff countdown）──
 *   ほのお → 62s、つなみ → 84s（属性で固定。wave1/wave2 のどちらに割当たるかは
 *   firstWave11BossGimmick による）。
 *
 * ── 魔眼の解決秒 ── 魔眼1=57s / 魔眼2=79s。
 * ── 役割（水雷/加速度）の解決秒 ── 早=51s / 遅=74s。
 * ── 分断（エクスデス）の解決秒 ── ≈41s。
 * ============================================================================
 */

/** タイムライン上のキャスト/解決イベント種別。 */
export type PlayEventKind =
  | "centerGC" // 中央グランドクロス（cross+quadrant）解決
  | "centerSandaga" // mid-fight 中央サンダガ（雷十字）
  | "centerBlizzaga" // mid-fight 中央ブリザガ（象限）
  | "split" // wave3 分断（エクスデス）
  | "env" // 役割（水雷/加速度/フィラー）解決
  | "eye" // 魔眼解決
  | "wave" // つなみ/ほのお解決
  | "finalMemory"; // 最終記憶 AoE 解決

/** 中央ボスのキャストバー1本（cast NAME + 詠唱窓 + 解決秒）。 */
export type CenterCast = {
  /** キャスト名（キャストバーに表示する文字列）。 */
  name: string;
  /** 詠唱開始秒。 */
  castStart: number;
  /** 詠唱完了＝解決秒。 */
  resolveSec: number;
  /** どの中央 AoE インスタンスか。 */
  instance: "gc1" | "gc2" | "gc3" | "sandaga" | "blizzaga";
  /** AoE ジオメトリ種別（サンダガ＝雷十字 / ブリザガ＝象限 / グランドクロス＝両方）。 */
  geometry: "cross" | "thunder" | "blizzard";
};

/* ============================================================
 * 反応スケジュール（参照から抽出した絶対秒）
 * ========================================================== */

/** 中央グランドクロス（cross+quadrant）の解決秒（GC1/GC2/GC3）。 */
export const CENTER_GC_SEC = { gc1: 4, gc2: 16, gc3: 28 } as const;
export type CenterGcKey = keyof typeof CENTER_GC_SEC;

/** mid-fight 中央サンダガ：詠唱 53→57（4s）。 */
export const CENTER_SANDAGA = { castStart: 53, resolveSec: 57 } as const;
/** mid-fight 中央ブリザガ：詠唱 70→74（4s）。 */
export const CENTER_BLIZZAGA = { castStart: 70, resolveSec: 74 } as const;

/** 中央ボス詠唱の長さ（参照: グランドクロス/サンダガ/ブリザガ いずれも 4s）。 */
export const CENTER_CAST_LEN = 4;

/** 中央グランドクロスの詠唱開始秒（解決の CENTER_CAST_LEN 秒前）。 */
export function centerGcCastStart(key: CenterGcKey): number {
  return CENTER_GC_SEC[key] - CENTER_CAST_LEN;
}

/** wave3 分断（エクスデス）の解決秒。 */
export const SPLIT_SEC = 41;
/** 分断ボス詠唱の長さ（参照 wave3BossB.duration=5000）。 */
export const SPLIT_CAST_LEN = 5;
/** 分断ボス出現秒（POPUP）。 */
export const SPLIT_POPUP_SEC = 36;

/** 最終記憶 AoE 解決秒（finalPhaseTimeline t=87）。 */
export const FINAL_MEMORY_SEC = 87;

/* ============================================================
 * 役割機構の解決秒（参照 assignGimmickDebuffs / finalPhaseTimeline）
 *
 * 席視点の役割機構（split=エクスデス分断 / early/late=水雷・加速度 / juso=魔眼 /
 * honoo・tsunami=波）の解決秒・要求アクション・判定は arena.ts に集約している。
 * 本モジュールはそこから MechanicKey/MECHANIC_SEC/MECH_ORDER を再エクスポートする。
 * （MechanicKey の "gc3" がエクスデス分断＝SPLIT_SEC(≈41s) に対応する。）
 * ========================================================== */

export type { MechanicKey } from "@/p4/arena";
export { MECHANIC_SEC } from "@/p4/arena";

/** HUD/順序用：機構の評価順（解決秒昇順）。 */
export const MECH_ORDER = [
  "gc3",
  "early",
  "juso1",
  "honoo",
  "late",
  "juso2",
  "tsunami",
] as const;

/* ============================================================
 * 中央ボスのキャストバー：表示すべき1本を返す
 * ========================================================== */

/**
 * 現在の経過秒における中央ボスのアクティブな詠唱を返す（無ければ null）。
 *
 * 優先順位（参照のフェーズ進行に従う）:
 *  - 序盤 GC1/GC2/GC3（cross）: 各 castStart..resolveSec。
 *  - mid-fight サンダガ（thunder）: 53..57。
 *  - mid-fight ブリザガ（blizzard）: 70..74。
 *  - 最終記憶 AoE: 84..87（geometry=cross：両 AoE を同時に出す）。
 *
 * 解決の直後 +1.5s までは「解決表示」を許すため、resolveSec+1.5 まで返す。
 */
export function activeCenterCast(elapsed: number): CenterCast | null {
  // 序盤の中央ボス magic charge（サンダガ十字 + ブリザガ象限）。
  // 参照 bosses[0]（中央）は サンダガ/ブリザガ を詠唱する（グランドクロスではない）。
  // グランドクロスは 4時のサブボス（bosses[2]）の役割デバフ詠唱（フィールド AoE なし）。
  for (const key of ["gc1", "gc2", "gc3"] as CenterGcKey[]) {
    const resolveSec = CENTER_GC_SEC[key];
    const castStart = resolveSec - CENTER_CAST_LEN;
    if (elapsed >= castStart && elapsed < resolveSec + 1.5) {
      return { name: "サンダガ／ブリザガ", castStart, resolveSec, instance: key, geometry: "cross" };
    }
  }
  // mid-fight サンダガ。
  if (elapsed >= CENTER_SANDAGA.castStart && elapsed < CENTER_SANDAGA.resolveSec + 1.5) {
    return {
      name: "サンダガ",
      castStart: CENTER_SANDAGA.castStart,
      resolveSec: CENTER_SANDAGA.resolveSec,
      instance: "sandaga",
      geometry: "thunder",
    };
  }
  // mid-fight ブリザガ。
  if (elapsed >= CENTER_BLIZZAGA.castStart && elapsed < CENTER_BLIZZAGA.resolveSec + 1.5) {
    return {
      name: "ブリザガ",
      castStart: CENTER_BLIZZAGA.castStart,
      resolveSec: CENTER_BLIZZAGA.resolveSec,
      instance: "blizzaga",
      geometry: "blizzard",
    };
  }
  // 最終記憶 AoE（84→87）。
  if (elapsed >= FINAL_MEMORY_SEC - 3 && elapsed < FINAL_MEMORY_SEC + 1.5) {
    return {
      name: "マジックアウト（記憶）",
      castStart: FINAL_MEMORY_SEC - 3,
      resolveSec: FINAL_MEMORY_SEC,
      instance: "gc1",
      geometry: "cross",
    };
  }
  return null;
}

/**
 * 詠唱進捗 0..1（castStart→resolveSec を線形）。窓外なら null。
 */
export function castProgress(elapsed: number, cast: CenterCast): number {
  const span = cast.resolveSec - cast.castStart;
  if (span <= 0) return 1;
  return Math.min(1, Math.max(0, (elapsed - cast.castStart) / span));
}

/* ============================================================
 * 中央 AoE の判定パラメータ（setup から）
 * ========================================================== */

import type { SimSetup } from "@/p4/simulation";
import type { CenterAoeParams } from "@/p4/arena";

/** 中央 AoE の解決スケジュール（種別・解決秒・真偽/パターンを setup から導出）。 */
export type CenterResolution = {
  /** どの中央キャストか。 */
  instance: CenterCast["instance"];
  /** 解決秒。 */
  resolveSec: number;
  /** centerAoeSafe へ渡す判定パラメータ。 */
  params: CenterAoeParams;
  /** AoE ジオメトリ種別。 */
  geometry: CenterCast["geometry"];
};

/** 中央サンダガ単発（thunder のみ）を centerAoeSafe 用に展開（ブリザガ面は無効）。 */
function thunderOnly(truthShin: boolean, thunderPattern: number): CenterAoeParams {
  return {
    thunderPattern,
    blizzardPattern: 0,
    sandagaShin: truthShin,
    // ブリザガ面は存在しない＝常に安全になるよう「うそ & 補集合が空」ではなく、
    // blizzagaShin=false かつ pattern を無視させるため、判定側で blizzard を除外する。
    blizzagaShin: false,
  };
}

/**
 * setup から全中央 AoE 解決イベントを返す（解決秒昇順）。
 *
 * - gc1(t=4)/gc2(t=16)/gc3(t=28): サンダガ十字 + ブリザガ象限（両面）。
 * - sandaga(t=57): 雷十字のみ。
 * - blizzaga(t=74): 象限のみ。
 * - finalMemory は過去×未来合成のため別関数で扱う。
 */
export function centerResolutions(setup: SimSetup): CenterResolution[] {
  const shin = (t: string) => t === "shin";
  const c = setup.centerAoE;
  const out: CenterResolution[] = [];
  for (const key of ["gc1", "gc2", "gc3"] as const) {
    const g = c[key];
    out.push({
      instance: key,
      resolveSec: CENTER_GC_SEC[key],
      geometry: "cross",
      params: {
        thunderPattern: g.thunderPattern,
        blizzardPattern: g.blizzardPattern,
        sandagaShin: shin(g.sandagaTruth),
        blizzagaShin: shin(g.blizzagaTruth),
      },
    });
  }
  out.push({
    instance: "sandaga",
    resolveSec: CENTER_SANDAGA.resolveSec,
    geometry: "thunder",
    params: thunderOnly(shin(c.sandaga.truth), c.sandaga.thunderPattern),
  });
  out.push({
    instance: "blizzaga",
    resolveSec: CENTER_BLIZZAGA.resolveSec,
    geometry: "blizzard",
    params: {
      thunderPattern: 0,
      blizzardPattern: c.blizzaga.blizzardPattern,
      // 雷面は存在しない（判定側で thunder を除外）。
      sandagaShin: false,
      blizzagaShin: shin(c.blizzaga.truth),
    },
  });
  return out;
}

/** instance に対応する上=サンダガ / 下=ブリザガ の真偽（真偽リング表示用）。null=該当面なし。 */
export function centerTruths(
  setup: SimSetup,
  instance: CenterCast["instance"],
): { sandaga: boolean | null; blizzaga: boolean | null } {
  const shin = (t: string) => t === "shin";
  const c = setup.centerAoE;
  if (instance === "gc1" || instance === "gc2" || instance === "gc3") {
    return { sandaga: shin(c[instance].sandagaTruth), blizzaga: shin(c[instance].blizzagaTruth) };
  }
  if (instance === "sandaga") return { sandaga: shin(c.sandaga.truth), blizzaga: null };
  if (instance === "blizzaga") return { sandaga: null, blizzaga: shin(c.blizzaga.truth) };
  return { sandaga: null, blizzaga: null };
}
