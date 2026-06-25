/**
 * シミュレーションモード Phase 1（純ロジックのみ・UI/バックエンドなし）。
 *
 * 8人レイドの「実戦準拠」の役割/真偽セットアップを決定的に生成し、
 * 任意の席のプレイヤー割当を既存ミニマムモードの MinState 形へ変換する。
 *
 * Phase 1 は配分とマッピングのみで、タイムライン上のスケジューリングは行わない
 * （実戦タイムは Phase 3 で参照フローに沿わせる）。
 */

/** ほんと(真) / うそ(偽)。 */
export type Truth = "shin" | "gi";
/** GC1/GC2 における役割: 水 / 雷 / 視線 / 無職。 */
export type GcRole = "mizu" | "rai" | "shisen" | "mushoku";
/** GC3 の役割: アラガンフィールド / 死の超越。 */
export type Gc3Role = "aragan" | "shi";
/** GC3 傷デバフ: 生者の傷 / 死者の傷。 */
export type Gc3Scar = "seija" | "shisha";
/** 波状攻撃の属性: 炎(ほのお) / 水(つなみ)。 */
export type WaveType = "honoo" | "tsunami";

/** ロール: タンク/ヒラ(TH, 席0-3) / DPS(席4-7)。 */
export type Role = "TH" | "DPS";

/** ジョブ枠: タンク(席0-1) / ヒラ(席2-3) / DPS(席4-7)。 */
export type Job = "tank" | "healer" | "dps";

/** 席番号からジョブ枠を決定的に返す（tank=0-1 / healer=2-3 / dps=4-7）。 */
export function seatJob(seat: number): Job {
  return seat < 2 ? "tank" : seat < 4 ? "healer" : "dps";
}

/** 1プレイヤーの GC1〜GC3 役割割当。 */
export type PlayerAssignment = {
  /** 席番号 0..7（一意）。 */
  seat: number;
  /** ロール（席0-3=TH / 席4-7=DPS、シャッフルに依らず決定的）。 */
  role: Role;
  /** ジョブ枠（席0-1=tank / 席2-3=healer / 席4-7=dps、決定的）。 */
  job: Job;
  gc1Role: GcRole;
  gc2Role: GcRole;
  gc3Role: Gc3Role;
  gc3Scar: Gc3Scar;
};

/** レイド全体のシミュレーションセットアップ。 */
export type SimSetup = {
  /** GC1 のキャスト色真偽（全員共通）。 */
  gc1Truth: Truth;
  /** GC2 のキャスト色真偽（全員共通）。 */
  gc2Truth: Truth;
  /** 1回目の波の属性。 */
  wave1Type: WaveType;
  /** 1回目の波の真偽。 */
  wave1Truth: Truth;
  /** 2回目の波の属性（必ず wave1 の逆属性）。 */
  wave2Type: WaveType;
  /** 2回目の波の真偽。 */
  wave2Truth: Truth;
  /** true なら GC1 側の水雷が「早」（GC2 側が「遅」）。 */
  gc1WaterEarly: boolean;
  /** サンダガ（マジックアウト記憶）の真偽。 */
  thundaTruth: Truth;
  /** ブリザガ（マジックアウト記憶）の真偽。 */
  blizzaTruth: Truth;
  /**
   * GC3 分断ボスが出現する外周の角度インデックス（0..7）。
   * 実角度 = index * 45°（0°=3時方向 / 時計回り、canvas 座標系）。
   * セッションで全クライアントが同じ分断面を共有できるよう決定的に生成する。
   */
  gc3BossAngle: number;
  /**
   * GC3 分断（エクスデス）ボスのキャスト真偽。
   *
   * 参照 sim.html `checkWave3SplitSafety`: `wave3BossB.currentEffect` が
   * ほんと(shin)/うそ(gi) を持ち、うそ(gi) のときアラガン/超越の解釈を反転する
   * （`if (!isBossTruth) isAlagField = !isAlagField;`）。
   * セッション内で全クライアントが同じ安全側を共有できるよう決定的に生成する。
   */
  gc3SplitTruth: Truth;
  /**
   * 中央ボスのサンダガ/ブリザガ十字・象限 AoE の決定的ジオメトリ（GC1/GC2 ごと）。
   *
   * 参照 sim.html の `drawThundergaAoELayer` / `drawBlizzagaAoELayer` /
   * `evaluateCurrentPosition` の意味論に一致する:
   * - thunderPattern ∈ 0..3 — 中央で ±45° 回転した幅175の雷ストリップ配置。
   * - blizzardPattern ∈ 0..1 — 中央4象限のうち対角2象限を塗るブリザガ。
   * - sandagaTruth/blizzagaTruth — ほんと(shin)=表示面が実発火（避ける）/
   *   うそ(gi)=反対面が発火（補集合を避ける）。
   */
  centerAoE: {
    gc1: {
      sandagaTruth: Truth;
      blizzagaTruth: Truth;
      thunderPattern: number;
      blizzardPattern: number;
    };
    gc2: {
      sandagaTruth: Truth;
      blizzagaTruth: Truth;
      thunderPattern: number;
      blizzardPattern: number;
    };
    /** 3回目の中央グランドクロス（t=28 解決）。 */
    gc3: {
      sandagaTruth: Truth;
      blizzagaTruth: Truth;
      thunderPattern: number;
      blizzardPattern: number;
    };
    /** mid-fight 単発の中央サンダガ（雷十字, t=53→57 解決）。 */
    sandaga: {
      truth: Truth;
      thunderPattern: number;
    };
    /** mid-fight 単発の中央ブリザガ（象限, t=70→74 解決）。 */
    blizzaga: {
      truth: Truth;
      blizzardPattern: number;
    };
  };
  /** 8人分の割当（seat 0..7）。 */
  players: PlayerAssignment[];
};

/** [0,1) を返す RNG で配列をシャッフル（Fisher–Yates / 非破壊）。 */
function shuffle<T>(arr: readonly T[], rng: () => number): T[] {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/** RNG でランダムな真偽。 */
function randTruth(rng: () => number): Truth {
  return rng() < 0.5 ? "shin" : "gi";
}

/**
 * 実戦準拠のセットアップを決定的に生成する。
 *
 * - GC1 役割: 8人に対し mizu×2 / rai×2 / shisen×2 / mushoku×2。
 * - GC2 役割: GC1 で水雷だった4人は加速度系（shisen×2 / mushoku×2）に、
 *   GC1 で加速度系だった4人は水雷（mizu×2 / rai×2）に入れ替わる。
 * - GC3 役割: aragan×4 / shi×4。
 * - 各真偽はランダム。wave2Type は wave1Type の逆属性。
 *
 * @param rng 注入可能な [0,1) RNG（省略時は Math.random）。
 */
export function generateSim(rng: () => number = Math.random): SimSetup {
  // --- GC1: 2/2/2/2 をランダム配置 ---
  const gc1Pool: GcRole[] = [
    "mizu",
    "mizu",
    "rai",
    "rai",
    "shisen",
    "shisen",
    "mushoku",
    "mushoku",
  ];
  const gc1Roles = shuffle(gc1Pool, rng);

  // --- GC2: 水雷⇔加速度系 のスワップ ---
  // GC1 で水雷だった席は GC2 で加速度系（shisen/mushoku）、逆もまた然り。
  const waterSeatsGc1: number[] = [];
  const accelSeatsGc1: number[] = [];
  gc1Roles.forEach((r, seat) => {
    if (r === "mizu" || r === "rai") waterSeatsGc1.push(seat);
    else accelSeatsGc1.push(seat);
  });

  const gc2Roles: GcRole[] = new Array(8);
  // GC1 水雷の4席 → GC2 加速度系（shisen×2 / mushoku×2）。
  const accelSub = shuffle<GcRole>(
    ["shisen", "shisen", "mushoku", "mushoku"],
    rng,
  );
  waterSeatsGc1.forEach((seat, i) => {
    gc2Roles[seat] = accelSub[i];
  });
  // GC1 加速度系の4席 → GC2 水雷（mizu×2 / rai×2）。
  const waterSub = shuffle<GcRole>(["mizu", "mizu", "rai", "rai"], rng);
  accelSeatsGc1.forEach((seat, i) => {
    gc2Roles[seat] = waterSub[i];
  });

  // --- GC3: aragan×4 / shi×4 ---
  const gc3Pool: Gc3Role[] = [
    "aragan",
    "aragan",
    "aragan",
    "aragan",
    "shi",
    "shi",
    "shi",
    "shi",
  ];
  const gc3Roles = shuffle(gc3Pool, rng);

  // --- GC3 傷デバフ: seija×4 / shisha×4（gc3Role とは独立したシャッフル）。 ---
  const gc3ScarPool: Gc3Scar[] = [
    "seija",
    "seija",
    "seija",
    "seija",
    "shisha",
    "shisha",
    "shisha",
    "shisha",
  ];
  const gc3Scars = shuffle(gc3ScarPool, rng);

  const players: PlayerAssignment[] = [];
  for (let seat = 0; seat < 8; seat++) {
    const job = seatJob(seat);
    const role: Role = job === "dps" ? "DPS" : "TH";
    players.push({
      seat,
      role,
      job,
      gc1Role: gc1Roles[seat],
      gc2Role: gc2Roles[seat],
      gc3Role: gc3Roles[seat],
      gc3Scar: gc3Scars[seat],
    });
  }

  const wave1Type: WaveType = rng() < 0.5 ? "honoo" : "tsunami";
  const wave2Type: WaveType = wave1Type === "honoo" ? "tsunami" : "honoo";

  const gc1Truth = randTruth(rng);
  const gc2Truth = randTruth(rng);
  const wave1Truth = randTruth(rng);
  const wave2Truth = randTruth(rng);
  const gc1WaterEarly = rng() < 0.5;
  const thundaTruth = randTruth(rng);
  const blizzaTruth = randTruth(rng);
  const gc3BossAngle = Math.floor(rng() * 8) % 8;

  // 中央 AoE ジオメトリ: 既存の rng() 呼び出しを一切ずらさないよう、
  // すべての決定的フィールドを生成し終えた後でまとめて引く。
  // 順序: gc1.sandagaTruth, gc1.blizzagaTruth, gc1.thunderPattern, gc1.blizzardPattern, 次に gc2 同順。
  const centerAoE = {
    gc1: {
      sandagaTruth: randTruth(rng),
      blizzagaTruth: randTruth(rng),
      thunderPattern: Math.floor(rng() * 4),
      blizzardPattern: Math.floor(rng() * 2),
    },
    gc2: {
      sandagaTruth: randTruth(rng),
      blizzagaTruth: randTruth(rng),
      thunderPattern: Math.floor(rng() * 4),
      blizzardPattern: Math.floor(rng() * 2),
    },
    // GC3（3回目の中央グランドクロス, t=28 解決）。決定性を崩さないため
    // gc1/gc2 の rng() 呼び出しの「後」に同順で追加する。
    gc3: {
      sandagaTruth: randTruth(rng),
      blizzagaTruth: randTruth(rng),
      thunderPattern: Math.floor(rng() * 4),
      blizzardPattern: Math.floor(rng() * 2),
    },
    // mid-fight 単発の中央サンダガ（雷十字, t=53→57）。参照 thunderga_Gimmick。
    sandaga: {
      truth: randTruth(rng),
      thunderPattern: Math.floor(rng() * 4),
    },
    // mid-fight 単発の中央ブリザガ（象限, t=70→74）。参照 blizzaga_Gimmick。
    blizzaga: {
      truth: randTruth(rng),
      blizzardPattern: Math.floor(rng() * 2),
    },
  };

  // GC3 分断ボスのキャスト真偽。決定性を崩さないため、既存の全 rng() 呼び出しの
  // 「後」に追加で引く（参照 wave3BossB.currentEffect 相当）。
  const gc3SplitTruth = randTruth(rng);

  return {
    gc1Truth,
    gc2Truth,
    wave1Type,
    wave1Truth,
    wave2Type,
    wave2Truth,
    gc1WaterEarly,
    thundaTruth,
    blizzaTruth,
    gc3BossAngle,
    gc3SplitTruth,
    centerAoE,
    players,
  };
}

/** GcRole が水雷系か。 */
function isWater(r: GcRole): boolean {
  return r === "mizu" || r === "rai";
}

/**
 * ある席のプレイヤー割当を、既存ミニマムモードの MinState 形（INITIAL_MIN のキー）へ変換する。
 *
 * 返すキー: waterType, waterGC, waterWhen, shisen, gc1, gc2, honoo, tsunami, thunda, blizza。
 *
 * @throws 席が見つからない、または水雷/加速度系の割当が想定（各GCで一方だけ水雷）に反する場合。
 */
export function toMinState(
  setup: SimSetup,
  seat: number,
): Record<string, string> {
  const p = setup.players.find((pl) => pl.seat === seat);
  if (!p) throw new Error(`seat ${seat} not found in setup`);

  const water1 = isWater(p.gc1Role);
  const water2 = isWater(p.gc2Role);
  // 各プレイヤーはちょうど一方のGCで水雷、他方で加速度系のはず。
  if (water1 === water2) {
    throw new Error(
      `seat ${seat}: expected exactly one of GC1/GC2 to be 水雷 (gc1=${p.gc1Role}, gc2=${p.gc2Role})`,
    );
  }

  const waterGC = water1 ? "1" : "2";
  const waterRole = water1 ? p.gc1Role : p.gc2Role; // mizu | rai
  const accelRole = water1 ? p.gc2Role : p.gc1Role; // shisen | mushoku

  const waterType = waterRole === "rai" ? "rai" : "mizu";
  const shisen = accelRole === "shisen" ? "yes" : "no";

  // 水雷の早遅: gc1WaterEarly は「GC1側の水雷が早」を意味する。
  const waterWhen =
    waterGC === "1"
      ? setup.gc1WaterEarly
        ? "haya"
        : "oso"
      : setup.gc1WaterEarly
        ? "oso"
        : "haya";

  // 炎/水それぞれの真偽を波から取り出す。
  const honooTruth =
    setup.wave1Type === "honoo" ? setup.wave1Truth : setup.wave2Truth;
  const tsunamiTruth =
    setup.wave1Type === "tsunami" ? setup.wave1Truth : setup.wave2Truth;

  return {
    waterType,
    waterGC,
    waterWhen,
    shisen,
    gc1: setup.gc1Truth,
    gc2: setup.gc2Truth,
    honoo: honooTruth,
    tsunami: tsunamiTruth,
    thunda: setup.thundaTruth,
    blizza: setup.blizzaTruth,
  };
}
