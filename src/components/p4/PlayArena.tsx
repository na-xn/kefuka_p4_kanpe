import { useEffect, useRef, useState, useCallback } from "react";
import { Gauge } from "lucide-react";
import type { SimSetup, Truth } from "@/p4/simulation";
import { toMinState } from "@/p4/simulation";
import {
  ARENA_SIZE,
  CENTER,
  ARENA_RADIUS,
  PLAYER_RADIUS,
  ZONES,
  AOE_CIRCLE_RADIUS,
  AOE_DONUT_INNER,
  AOE_DONUT_OUTER,
  THUNDER_STRIP_W,
  clampToArena,
  gc3BossPos,
  requiredAction,
  evaluate,
  centerAoeSafeGeometry,
  MECHANIC_SEC,
  END_SEC,
  mechanicResolveSec,
  exdeathZones,
  type MechanicKey,
  type Point,
  type RequiredAction,
} from "@/p4/arena";
import { npcState } from "@/p4/npc";
import {
  MECH_ORDER,
  APPLY_SEC,
  activeCenterCast,
  activeOuterCast,
  castProgress,
  centerResolutions,
  centerTruths,
  SUB_BOSS_VANISH_SEC,
  type CenterCast,
} from "@/p4/playTimeline";

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
  /** タイムライン終了（elapsed >= END_SEC）で「新しいお題」を押した時のコールバック。 */
  onNewTopic?: () => void;
  /**
   * （任意・セッション用）他の人間プレイヤーが操作している席の実位置。
   * seat → {x,y,fx,fy}（位置 + 向き単位ベクトル）。指定された席は npcState ではなく
   * この実位置で描画する。まだ届いていない席は npcState にフォールバックする。
   * ソロ（PlayRunner）では未指定で、従来どおり全 7 席が npcState で描かれる。
   */
  remotePositions?: Map<number, { x: number; y: number; fx: number; fy: number }>;
  /**
   * （任意・セッション用）人間が占有している席の集合（自席を含む）。
   * ここに含まれる他席は「npcState の NPC として描かない」。remotePositions に
   * 実位置があればそれで、無ければ（未着なら）暫定的に npcState で描く。
   */
  occupiedSeats?: Set<number>;
  /**
   * （任意・セッション用）自席の現在位置 + 向きを ~12Hz で親へ通知する。
   * 親はこれを throttle 済みの session.sendPos へ橋渡しして他クライアントへ配る。
   * ソロでは未指定（no-op）。
   */
  onLocalPos?: (x: number, y: number, fx: number, fy: number) => void;
};

/** セッション位置同期の自席ブロードキャスト間隔（~12Hz）。 */
const LOCAL_POS_INTERVAL_MS = 1000 / 12;

/* ============================================================
 * NPC（非操作の他席）ドットの色（ロール別・人間ドットより従属的）
 * ========================================================== */

/** NPC ドット半径（人間ドットより小さく＝従属的に見せる）。 */
const NPC_RADIUS = PLAYER_RADIUS * 0.7;
/** NPC ドットの不透明度（人間ドットより薄く）。 */
const NPC_ALPHA = 0.8;
/** TH 席（0..3）の冷色フィル。 */
const NPC_FILL_TH = "#5aa9e6";
/** DPS 席（4..7）の暖色フィル。 */
const NPC_FILL_DPS = "#e6705a";

/** 席のロール（0..3=TH / 4..7=DPS）に応じた NPC フィル色を返す。 */
function npcFill(role: "TH" | "DPS"): string {
  return role === "TH" ? NPC_FILL_TH : NPC_FILL_DPS;
}

/** 機構の表示名。 */
const MECH_NAME: Record<MechanicKey, string> = {
  gc3: "エクスデス分断",
  early: "早 水雷/加速度",
  juso1: "魔眼①",
  honoo: "ほのお/つなみ",
  late: "遅 水雷/加速度",
  juso2: "魔眼②",
  tsunami: "つなみ",
};

/** 機構の解決前リードイン秒（事前にターゲットを描画して予告する）。 */
const LEAD_IN = 8;

/**
 * つなみ/ほのお AoE の「着弾フラッシュ」表示秒。
 * 設置→起爆の間は AoE 形状を一切描かず（テレグラフしない）、
 * 起爆秒（mechanicResolveSec）から AOE_FLASH_DURATION 秒だけ短く点滅表示する。
 */
const AOE_FLASH_DURATION = 0.5;

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
  /**
   * このデバフの「実際の」真偽（判定が読むのと同じ setup 由来の真実）。
   * 水雷/雷/加速弾/視線 → 担当 GC の真偽（gc1Truth/gc2Truth）。
   * つなみ/ほのお → wave の真偽（wave1Truth/wave2Truth）。
   * GC3（アラガン/超越・傷）は分断ボス上に別途真偽を出すので、ここでは付けない。
   * 真偽が無いデバフは undefined（バッジ非表示）。
   */
  truth?: Truth;
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
  // 加速度系側 GC の解決秒。早/遅は加速弾の法則（視線→GC1早/GC2遅・無職→GC1遅/GC2早）。
  // 水の逆とは限らない（カンペ buildTimeline の accelWhen と一致させる）。
  const accelIsShisen = ms.shisen === "yes";
  const accelGc = ms.waterGC === "1" ? "2" : "1";
  const accelEarly = accelGc === "1" ? accelIsShisen : !accelIsShisen;
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
  // 加速度系の爆弾(加速弾)は env チェック（早=51/遅=74）で解決する。
  const bombSec = accelEarly ? MECHANIC_SEC.early : MECHANIC_SEC.late;

  const roleColor = (r: string): string => {
    if (r === "mizu") return "#00b4d8";
    if (r === "rai") return "#bf55ec";
    if (r === "shisen") return "#a2d2ff";
    return "#ffcc00"; // mushoku
  };

  // 役割デバフを1つ付与する。視線(shisen)は参照 SET2 = 加速弾(bomb) + 視線(eye) の
  // 2デバフを持つ（爆弾は env、視線は juso で別々に解決）。
  // truth は担当 GC の真偽（gc1Truth/gc2Truth）。判定が読むのと同じ setup 由来の真実。
  const pushRole = (role: string, applySec: number, resolveSec: number, truth: Truth) => {
    if (role === "shisen") {
      // 視線（魔眼）アイコン: juso タイミングで解決。
      out.push({ iconKey: "shisen", applySec, resolveSec, color: roleColor("shisen"), truth });
      // 加速弾（爆弾）アイコン: env タイミングで解決。
      out.push({
        iconKey: "mushoku",
        applySec,
        resolveSec: bombSec,
        color: roleColor("mushoku"),
        truth,
      });
      return;
    }
    out.push({ iconKey: role as IconKey, applySec, resolveSec, color: roleColor(role), truth });
  };

  // 付与秒は参照 assignGimmickDebuffs / assign11BossDebuff のボス詠唱完了時刻に一致:
  //   GC1 役割 @8（assignGimmickDebuffs(1)）, wave1 @12（assign11BossDebuff(1)）,
  //   GC2 役割 @20（assignGimmickDebuffs(2)）, wave2 @24（assign11BossDebuff(2)）,
  //   GC3 役割+傷 @32（assignGimmickDebuffs(3) wave3 分岐）。
  // GC1 役割 @8（boss2 グランドクロス完了）。truth=gc1Truth。
  pushRole(p.gc1Role, APPLY_SEC.gc1Role, gc1Sec, setup.gc1Truth);
  // wave1 @12（boss1 つなみ/ほのお完了）。truth=wave1Truth。
  out.push({
    iconKey: setup.wave1Type as IconKey,
    applySec: APPLY_SEC.wave1,
    resolveSec: setup.wave1Type === "honoo" ? MECHANIC_SEC.honoo : MECHANIC_SEC.tsunami,
    color: setup.wave1Type === "honoo" ? "#ff4500" : "#00b4d8",
    truth: setup.wave1Truth,
  });
  // GC2 役割 @20。truth=gc2Truth。
  pushRole(p.gc2Role, APPLY_SEC.gc2Role, gc2Sec, setup.gc2Truth);
  // wave2 @24。truth=wave2Truth。
  out.push({
    iconKey: setup.wave2Type as IconKey,
    applySec: APPLY_SEC.wave2,
    resolveSec: setup.wave2Type === "honoo" ? MECHANIC_SEC.honoo : MECHANIC_SEC.tsunami,
    color: setup.wave2Type === "honoo" ? "#ff4500" : "#00b4d8",
    truth: setup.wave2Truth,
  });
  // GC3 役割 + 傷 @32。
  out.push({
    iconKey: p.gc3Role as IconKey,
    applySec: APPLY_SEC.gc3Role,
    resolveSec: MECHANIC_SEC.gc3,
    color: p.gc3Role === "aragan" ? "#00f5d4" : "#ff4444",
  });
  out.push({
    iconKey: p.gc3Scar as IconKey,
    applySec: APPLY_SEC.gc3Role,
    resolveSec: MECHANIC_SEC.gc3,
    color: p.gc3Scar === "seija" ? "#ff69b4" : "#00b4d8",
  });

  return out;
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
 * ロールアイコンプリロード（モジュールレベルで一度だけ）
 * ========================================================== */

const ROLE_ICON_FILES = { tank: "TankRole", healer: "HealerRole", dps: "DPSRole" } as const;
type RoleIconKey = keyof typeof ROLE_ICON_FILES;
const roleImgCache: Partial<Record<RoleIconKey, HTMLImageElement>> = {};
const roleLoadedCache: Partial<Record<RoleIconKey, boolean>> = {};
let rolePreloadStarted = false;
function preloadRoleIcons(onLoad: () => void) {
  if (rolePreloadStarted) { onLoad(); return; }
  rolePreloadStarted = true;
  const keys = Object.keys(ROLE_ICON_FILES) as RoleIconKey[];
  let loaded = 0;
  for (const k of keys) {
    const img = new Image();
    img.onload = () => { roleLoadedCache[k] = true; loaded++; if (loaded === keys.length) onLoad(); };
    img.onerror = () => { loaded++; if (loaded === keys.length) onLoad(); };
    img.src = `/icon/${ROLE_ICON_FILES[k]}.png`;
    roleImgCache[k] = img;
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

export function PlayArena({
  setup,
  seat = 0,
  startAt,
  onResult,
  onNewTopic,
  remotePositions,
  occupiedSeats,
  onLocalPos,
}: Props) {
  // セッション用 props は最新値を ref で参照（ループの依存を増やさず再購読を防ぐ）。
  const remotePositionsRef = useRef(remotePositions);
  remotePositionsRef.current = remotePositions;
  const occupiedSeatsRef = useRef(occupiedSeats);
  occupiedSeatsRef.current = occupiedSeats;
  const onLocalPosRef = useRef(onLocalPos);
  onLocalPosRef.current = onLocalPos;
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
    preloadRoleIcons(() => setImgTick((t) => t + 1));
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
  const centerJudged = useRef<Record<string, boolean>>({});

  // AoE 原点（波を「置いた」瞬間のプレイヤー位置）。リードイン開始時に確定。
  const aoeOrigin = useRef<Partial<Record<MechanicKey, Point>>>({});

  // 席の保有デバフ。
  const debuffs = useRef<DebuffEntry[]>([]);
  debuffs.current = buildDebuffs(setup, seat);

  // HUD 用クロック（粗いティック）。
  const [clock, setClock] = useState(0);
  // タイムライン終了（elapsed >= END_SEC）。クロック凍結 + 終了状態表示。
  const [finished, setFinished] = useState(false);

  // 被弾ログ（非ブロッキング）。失敗ごとに1件追加し、プレイは止めない。
  const [deathLog, setDeathLog] = useState<{ sec: number; mechanic: string; reason: string }[]>([]);
  const deathLogRef = useRef(deathLog);
  deathLogRef.current = deathLog;
  const pushDeath = useCallback((sec: number, mechanic: string, reason: string) => {
    setDeathLog((log) => [...log, { sec, mechanic, reason }]);
  }, []);

  // setup が変わったらリセット。
  useEffect(() => {
    player.current = { x: 400, y: 550, lastDx: 0, lastDy: -1, dead: false, deadReason: "" };
    aoeOrigin.current = {};
    centerJudged.current = {};
    setResults({});
    setDeathLog([]);
    setFinished(false);
  }, [setup, seat]);

  const restart = useCallback(() => {
    startRef.current = Date.now();
    player.current = { x: 400, y: 550, lastDx: 0, lastDy: -1, dead: false, deadReason: "" };
    aoeOrigin.current = {};
    centerJudged.current = {};
    setResults({});
    setDeathLog([]);
    setFinished(false);
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
    // 席のロール（TH/DPS）。水雷/フィラーのロール別カーディナル判定に使う。
    const playerRole = setup.players.find((p) => p.seat === seat)?.role ?? "TH";
    let raf = 0;
    // 自席位置の最終ブロードキャスト時刻（~12Hz スロットル）。
    let lastLocalPosAt = 0;

    const loop = () => {
      const pl = player.current;
      let dx = 0;
      let dy = 0;
      let movedThisFrame = false;

      // 被弾しても止まらない（非ブロッキング）。常に移動・採点を続ける。
      {
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
      // 実経過。END_SEC を超えたらクロックを END_SEC に凍結し、採点を止める。
      const rawElapsed = (Date.now() - startRef.current) / 1000;
      const timelineEnded = rawElapsed >= END_SEC;
      const elapsed = timelineEnded ? END_SEC : rawElapsed;
      if (timelineEnded) {
        setFinished((f) => (f ? f : true));
      }
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
        // つなみ/ほのお（AoE）: 参照 processDebuffTrigger に合わせ、デバフ満了の瞬間
        // （= sec = 設置秒）にプレイヤー位置へ AoE を「設置」する。原点はその瞬間の足元。
        // 起爆・死亡判定は設置の WAVE_DETONATE_DELAY 秒後（= mechanicResolveSec）。
        if (req.kind === "aoe" && !aoeOrigin.current[key] && elapsed >= sec) {
          aoeOrigin.current[key] = { x: pl.x, y: pl.y };
        }
        // 死亡判定秒（つなみ/ほのおは 設置+3、それ以外は sec）に未判定なら採点。
        const resolveSec = mechanicResolveSec(key);
        if (elapsed >= resolveSec && !resultsRef.current[key] && req.kind !== "none") {
          const boss = gc3BossPos(setup.gc3BossAngle);
          // 1回目（早 t=51）の水雷/フィラー処理はエクスデス方向を北として散会基準を回す。
          // 2回目（遅 t=74）は固定マーカー（標準 ZONES）。
          const zones = key === "early" ? exdeathZones(setup.gc3BossAngle) : ZONES;
          // 水雷/フィラー(stack/filler/spread)は evaluate に席ロールを渡し、
          // ロール別の単一カーディナル(TH=A/D, DPS=C/B)で判定する。
          // ロールを渡すことで「頭割りは h12 でも h6 でも合格」という旧来のロール非依存
          // 判定（DPS が TH カーディナルに立っても通る本バグ）を確実に排除する。
          const r = evaluate(
            req,
            { x: pl.x, y: pl.y },
            { x: pl.lastDx, y: pl.lastDy },
            moving,
            aoeOrigin.current[key],
            boss,
            zones,
            playerRole,
          );
          const res: PlayResult = { key, ok: r.ok, reason: r.reason, label: req.label };
          setResults((prev) => ({ ...prev, [key]: res }));
          onResult?.(res);
          if (!r.ok) {
            pushDeath(Math.floor(elapsed), MECH_NAME[key], r.reason);
          }
        }
      }

      // --- 中央ボス AoE 判定 ---
      // 参照 checkSafety / checkThundergaSafety / checkBlizzagaSafety:
      //   グランドクロス gc1@4 / gc2@16 / gc3@28（雷十字+象限の両面）、
      //   単発サンダガ@57（雷十字のみ）、単発ブリザガ@74（象限のみ）。
      for (const cr of centerResolutions(setup)) {
        if (elapsed >= cr.resolveSec && !centerJudged.current[cr.instance]) {
          centerJudged.current[cr.instance] = true;
          const safe = centerAoeSafeGeometry({ x: pl.x, y: pl.y }, cr.params, cr.geometry);
          if (!safe) {
            const label =
              cr.geometry === "thunder"
                ? "中央ボス サンダガ"
                : cr.geometry === "blizzard"
                  ? "中央ボス ブリザガ"
                  : "中央ボス AoE";
            pushDeath(Math.floor(elapsed), label, "被弾!");
          }
        }
      }

      // --- 自席位置の通知（セッション用・~12Hz スロットル / ソロでは no-op） ---
      const cb = onLocalPosRef.current;
      if (cb) {
        const now = Date.now();
        if (now - lastLocalPosAt >= LOCAL_POS_INTERVAL_MS) {
          lastLocalPosAt = now;
          const dl = Math.hypot(pl.lastDx, pl.lastDy) || 1;
          cb(pl.x, pl.y, pl.lastDx / dl, pl.lastDy / dl);
        }
      }

      // --- 描画 ---
      draw(
        ctx,
        setup,
        seat,
        elapsed,
        pl,
        aoeOrigin.current,
        debuffs.current,
        remotePositionsRef.current,
        occupiedSeatsRef.current,
      );

      // HUD クロックを粗く反映（END_SEC で凍結済みの elapsed を使う）。
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

      {/* 被弾ログ（プレイ中の控えめな表示: 件数 + 直近の原因）。 */}
      {deathLog.length > 0 && !finished && (
        <div className="px-0.5 text-[10px] text-destructive">
          <span className="font-bold">被弾 {deathLog.length}</span>
          <span className="ml-1.5 text-muted-foreground">
            直近: t={deathLog[deathLog.length - 1].sec} {deathLog[deathLog.length - 1].mechanic}:{" "}
            {deathLog[deathLog.length - 1].reason}
          </span>
        </div>
      )}

      <div
        ref={wrapRef}
        className="relative w-full select-none"
        style={{ touchAction: "none" }}
      >
        <canvas
          ref={canvasRef}
          width={ARENA_SIZE}
          height={ARENA_SIZE}
          className="block h-auto w-full rounded-lg border"
        />
        {finished && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 overflow-y-auto rounded-lg bg-black/65 px-3 py-4 text-center">
            <p className="text-sm font-bold text-foreground text-white">タイムライン終了</p>
            <p className="text-xs text-white">
              <span className="text-green-400 font-bold">✓{passCount}</span>{" "}
              <span className="text-red-400 font-bold">✗{failCount}</span>
            </p>
            {deathLog.length > 0 && (
              <div className="flex max-h-[45%] w-full max-w-[90%] flex-col gap-0.5 overflow-y-auto rounded-md bg-black/40 p-2 text-left">
                <p className="pb-0.5 text-[10px] font-bold text-red-300">
                  被弾ログ（{deathLog.length}）
                </p>
                {deathLog.map((d, i) => (
                  <p key={i} className="text-[11px] leading-snug text-white">
                    <span className="tabular-nums text-red-300">t={d.sec}</span> {d.mechanic}:{" "}
                    {d.reason}
                  </p>
                ))}
              </div>
            )}
            <div className="mt-1 flex gap-2">
              <button
                type="button"
                onClick={onNewTopic ?? restart}
                className="rounded-md bg-primary px-4 py-1.5 text-xs font-bold text-primary-foreground"
              >
                新しいお題
              </button>
              <button
                type="button"
                onClick={restart}
                className="rounded-md border border-white/40 px-4 py-1.5 text-xs font-bold text-white"
              >
                もう一度
              </button>
            </div>
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
  setup: SimSetup,
  seat: number,
  elapsed: number,
  pl: { x: number; y: number; lastDx: number; lastDy: number; dead: boolean },
  origins: Partial<Record<MechanicKey, Point>>,
  debuffs: DebuffEntry[],
  /** （任意・セッション用）他の人間席の実位置 seat→{x,y,fx,fy}。 */
  remotePositions?: Map<number, { x: number; y: number; fx: number; fy: number }>,
  /** （任意・セッション用）人間が占有している席集合（自席含む）。 */
  occupiedSeats?: Set<number>,
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

  // --- 中央ボス AoE（グランドクロス十字/象限・単発サンダガ・単発ブリザガ） ---
  // 参照: 詠唱中は低アルファ予告、解決秒で高アルファ。種別に応じて
  //   cross=両面 / thunder=雷十字のみ / blizzard=象限のみ を描く。
  const center: CenterCast | null = activeCenterCast(elapsed);
  if (center) {
    const g =
      center.instance === "gc1" || center.instance === "gc2" || center.instance === "gc3"
        ? setup.centerAoE[center.instance]
        : null;
    const resolving = elapsed >= center.resolveSec;
    const alpha = resolving ? 0.45 : 0.12;
    if (center.geometry === "cross") {
      // 序盤グランドクロス（gc1/gc2/gc3）。最終記憶はパターンが無いので gc1 で代用。
      const blzPat = g ? g.blizzardPattern : setup.centerAoE.gc1.blizzardPattern;
      const thnPat = g ? g.thunderPattern : setup.centerAoE.gc1.thunderPattern;
      drawBlizzardLayer(ctx, blzPat, alpha);
      drawThunderLayer(ctx, thnPat, alpha);
    } else if (center.geometry === "thunder") {
      drawThunderLayer(ctx, setup.centerAoE.sandaga.thunderPattern, alpha);
    } else if (center.geometry === "blizzard") {
      drawBlizzardLayer(ctx, setup.centerAoE.blizzaga.blizzardPattern, alpha);
    }
  }

  // --- 各機構のリードイン中ターゲット（寛容な予告） ---
  // 視線（魔眼）の発射源: この席が視線(shisen)担当なら席本人が「視線対象者＝発射源」で、
  // 視線はその足元から全方向に発射される。視線担当でなければ中央ボスが源。
  const isGazeSource = toMinState(setup, seat).shisen === "yes";
  const gazeSource: Point = isGazeSource ? { x: pl.x, y: pl.y } : CENTER;

  // ターゲット予告は「読むべき危険」（gc3 分断面 / つなみ・ほのお AoE / 視線）のみ描く。
  // 頭割り/散開の正解の立ち位置は表示しない（答えを出さない）。
  const isPosKind = (k: RequiredAction["kind"]) =>
    k === "stack" || k === "filler" || k === "spread";

  // 各機構が「この瞬間に描くべきか」を表示ウィンドウで判定する共通ヘルパ。
  const inDrawWindow = (key: MechanicKey, req: RequiredAction): boolean => {
    if (req.kind === "aoe") {
      // つなみ/ほのお: 着弾（起爆）の瞬間だけ短くフラッシュ表示する。
      const resolveSec = mechanicResolveSec(key);
      return elapsed >= resolveSec && elapsed <= resolveSec + AOE_FLASH_DURATION;
    }
    const sec = MECHANIC_SEC[key];
    return elapsed >= sec - LEAD_IN && elapsed <= sec + 1.5;
  };

  for (const key of MECH_ORDER) {
    const req = requiredAction(setup, seat, key);
    if (isPosKind(req.kind)) continue; // 位置は答えなので描かない
    if (!inDrawWindow(key, req)) continue;
    drawTarget(ctx, req, key, setup, origins, gazeSource);
  }

  // --- ボス（中央 + 外周2体）+ キャストバー + 真偽インジケータ ---
  drawBosses(ctx, setup, elapsed, center);

  // --- 他席の 7 ドット（NPC or 他の人間）---
  // 人間ドットより「前」のこの位置で描き、操作中の自席ドットが必ず最前面に来るようにする。
  drawOtherSeats(ctx, setup, seat, elapsed, remotePositions, occupiedSeats);

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
 * 操作席以外の 7 席ドットを描く（NPC または他の人間プレイヤー）。
 *
 * - remotePositions に実位置がある席（= 他の人間が操作中）はその位置/向きで描く。
 * - occupiedSeats に含まれるが実位置未着の席は、暫定的に npcState で描く（決定的）。
 * - それ以外（真の空席）は npcState（elapsed から決定的）で描く。
 *
 * 見た目は人間ドットに「従属」させる: 小さめ半径(NPC_RADIUS)・ロール色フィル
 * (TH=冷色 / DPS=暖色)・低アルファ(NPC_ALPHA)・細い白枠・席番号(seat+1)の小ラベル・
 * 短く細い視線ライン。これにより満員感と「誰がどこを向いているか」を出しつつ、
 * 自席ドット(teal #00e0c0・大きめ・赤い視線)が明確に主役のまま保たれる。
 *
 * ソロ（remotePositions/occupiedSeats 未指定）では全 7 席が npcState で描かれる。
 */
function drawOtherSeats(
  ctx: CanvasRenderingContext2D,
  setup: SimSetup,
  seat: number,
  elapsed: number,
  remotePositions?: Map<number, { x: number; y: number; fx: number; fy: number }>,
  occupiedSeats?: Set<number>,
) {
  for (let s = 0; s < 8; s++) {
    if (s === seat) continue; // 自席は人間ドットで別途描く。
    const role: "TH" | "DPS" = s < 4 ? "TH" : "DPS";

    // 位置・向きの解決: 他人間の実位置 > （未着 or 空席なら）npcState。
    let x: number;
    let y: number;
    let fx: number;
    let fy: number;
    const remote = remotePositions?.get(s);
    if (remote) {
      x = remote.x;
      y = remote.y;
      fx = remote.fx;
      fy = remote.fy;
    } else {
      const st = npcState(setup, s, elapsed);
      x = st.pos.x;
      y = st.pos.y;
      fx = st.facing.x;
      fy = st.facing.y;
    }
    // occupiedSeats に居て実位置未着の席も、暫定的に npcState で描く（上で解決済み）。
    void occupiedSeats;

    // ジョブを setup から解決（tank/healer/dps）。デフォルト "dps"。
    const job: RoleIconKey = (setup.players.find((p) => p.seat === s)?.job ?? "dps") as RoleIconKey;

    // 視線ライン（先に描き、アイコン/ドットの下になるようにする）。
    ctx.save();
    ctx.globalAlpha = NPC_ALPHA;
    const fl = Math.hypot(fx, fy) || 1;
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(x + (fx / fl) * 16, y + (fy / fl) * 16);
    ctx.strokeStyle = "rgba(255,255,255,0.85)";
    ctx.lineWidth = 2;
    ctx.stroke();
    ctx.restore();

    // アイコン or フォールバックドット。
    ctx.save();
    ctx.globalAlpha = NPC_ALPHA;
    const iconSize = NPC_RADIUS * 2.6;
    const roleImg = roleImgCache[job];
    if (roleLoadedCache[job] && roleImg) {
      // ロールアイコン画像を中央に描画。
      ctx.drawImage(roleImg, x - iconSize / 2, y - iconSize / 2, iconSize, iconSize);
    } else {
      // フォールバック: ロール色の円ドット + 白枠。
      ctx.beginPath();
      ctx.arc(x, y, NPC_RADIUS, 0, Math.PI * 2);
      ctx.fillStyle = npcFill(role);
      ctx.fill();
      ctx.lineWidth = 1.5;
      ctx.strokeStyle = "rgba(255,255,255,0.9)";
      ctx.stroke();
    }
    ctx.restore();

    // この席が「いま保有しているデバフ」をアイコン/ドットの上に小さく並べる。
    // 各 NPC も自分のデバフを持ち、それ前提で動いていることを可視化する
    // （位置・移動・視線・色はすべて requiredAction＝この席のデバフから導出）。
    const nDebuffs = buildDebuffs(setup, s).filter(
      (d) => elapsed >= d.applySec && elapsed < d.resolveSec + 0.5,
    );
    if (nDebuffs.length > 0) {
      const dsz = 14;
      const dgap = 16;
      const rowW = nDebuffs.length * dgap;
      const dx0 = x - rowW / 2 + (dgap - dsz) / 2;
      const dy = y - iconSize / 2 - dsz - 4;
      ctx.save();
      ctx.globalAlpha = NPC_ALPHA;
      nDebuffs.forEach((d, di) => {
        const dx = dx0 + di * dgap;
        const dimg = imgCache[d.iconKey];
        if (loadedCache[d.iconKey] && dimg) {
          ctx.drawImage(dimg, dx, dy, dsz, dsz);
        } else {
          ctx.fillStyle = d.color;
          ctx.fillRect(dx, dy, dsz, dsz);
        }
        // 真偽バッジ（真/偽）をアイコン左上に小さく重ねる（保有していれば）。
        if (d.truth) {
          const shin = d.truth === "shin";
          const bk: IconKey = shin ? "truth" : "fake";
          const bimg = imgCache[bk];
          const bs = 8;
          if (loadedCache[bk] && bimg) ctx.drawImage(bimg, dx - bs / 2, dy - bs / 2, bs, bs);
        }
      });
      ctx.restore();
    }

    // 席番号ラベル（seat+1）をアイコン/ドットの下に小さく。
    ctx.save();
    ctx.globalAlpha = NPC_ALPHA;
    ctx.font = "10px sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "top";
    ctx.lineWidth = 3;
    ctx.strokeStyle = "rgba(0,0,0,0.7)";
    ctx.strokeText(String(s + 1), x, y + iconSize / 2 + 2);
    ctx.fillStyle = "#fff";
    ctx.fillText(String(s + 1), x, y + iconSize / 2 + 2);
    ctx.restore();
    ctx.textBaseline = "alphabetic";
  }
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

/** キャストバー1本を描画（黒地 + 進捗 + 枠 + 上にキャスト名）。 */
function drawCastBar(
  ctx: CanvasRenderingContext2D,
  bx: number,
  by: number,
  prog: number,
  color: string,
  name: string,
) {
  const barW = 100;
  const barH = 10;
  const barX = bx - barW / 2;
  const barY = by - BOSS_RADIUS - 25;
  // キャスト名（参照: バーの上に表示）。全キャストバーが名前ラベルを描く。
  if (name) {
    ctx.save();
    ctx.fillStyle = "#fff";
    ctx.font = "bold 12px sans-serif";
    ctx.textAlign = "center";
    ctx.strokeStyle = "#000";
    ctx.lineWidth = 3;
    ctx.strokeText(name, bx, barY - 5);
    ctx.fillText(name, bx, barY - 5);
    ctx.restore();
  }
  ctx.fillStyle = "#000";
  ctx.fillRect(barX, barY, barW, barH);
  ctx.fillStyle = prog >= 1 ? "#ff3333" : color;
  ctx.fillRect(barX, barY, barW * Math.min(1, Math.max(0, prog)), barH);
  ctx.strokeStyle = "#888";
  ctx.lineWidth = 1;
  ctx.strokeRect(barX, barY, barW, barH);
}

/**
 * 外周サブボスの「次のキャスト」（名前・進捗）を CAST_EVENTS（単一の真実）から返す。
 *
 * which=1（8時 outer / boss1）: つなみ/ほのお を [4–12]・[16–24] で詠唱。
 *   名前は instance(wave1/wave2) に対応する属性（setup.wave1Type/wave2Type）に解決。
 * which=2（4時 outer / boss2）: グランドクロス を [0–8]・[12–20]・[24–32] で詠唱。
 */
function subBossCast(
  setup: SimSetup,
  elapsed: number,
  which: 1 | 2,
): { name: string; prog: number } | null {
  const boss: "outer8" | "outer4" = which === 1 ? "outer8" : "outer4";
  const ev = activeOuterCast(boss, elapsed);
  if (!ev) return null;
  const prog = Math.min(1, Math.max(0, (elapsed - ev.start) / (ev.end - ev.start)));
  let name = ev.name;
  if (ev.kind === "wave") {
    // "WAVE" を属性名（つなみ/ほのお）に解決。
    const waveType = ev.instance === "wave1" ? setup.wave1Type : setup.wave2Type;
    name = waveType === "honoo" ? "ほのお" : "つなみ";
  }
  return { name, prog };
}

/** 3体のボス + キャストバー + 真偽インジケータ。 */
function drawBosses(
  ctx: CanvasRenderingContext2D,
  setup: SimSetup,
  elapsed: number,
  center: CenterCast | null,
) {
  const bossList = [CENTER_BOSS, ...SUB_BOSSES];
  bossList.forEach((boss, index) => {
    // 参照 sim.html: 各サブボスは自分の最後の詠唱が終わると個別に消える。
    //   boss1（index 1, 8時 つなみ/ほのお）= 2回目終了 ~24 / boss2（index 2, 4時 GC）= GC3 終了 ~32。
    if (index === 1 && elapsed >= SUB_BOSS_VANISH_SEC.outer8) return;
    if (index === 2 && elapsed >= SUB_BOSS_VANISH_SEC.outer4) return;
    // ボス本体。
    ctx.beginPath();
    ctx.arc(boss.x, boss.y, BOSS_RADIUS, 0, Math.PI * 2);
    ctx.fillStyle = boss.color;
    ctx.fill();
    ctx.strokeStyle = "#fff";
    ctx.lineWidth = 2;
    ctx.stroke();

    // 真偽インジケータ。中央は中央AoEの真偽、外周は「いま詠唱している機構」の真偽。
    if (index === 0) {
      drawCenterTruthRings(ctx, boss.x, boss.y, setup, center, elapsed);
    } else {
      // 外周ボス: 現在の詠唱に対応する真偽（デバフバッジと一致させる）。
      //   8時(index1, つなみ/ほのお): [4,12)=wave1Truth / [16,24)=wave2Truth。
      //   4時(index2, グランドクロス): [0,8)=gc1Truth / [12,20)=gc2Truth（GC3 は色真偽なし）。
      const truth = subBossTruth(setup, elapsed, index as 1 | 2);
      if (truth) drawSubBossRing(ctx, boss.x, boss.y, truth);
    }

    // キャストバー（名前ラベル付き）。
    if (index === 0) {
      // 中央ボス: アクティブな中央キャスト（グランドクロス/サンダガ/ブリザガ/記憶）。
      if (center) {
        drawCastBar(ctx, boss.x, boss.y, castProgress(elapsed, center), "#bf55ec", center.name);
      }
    } else {
      const sc = subBossCast(setup, elapsed, index as 1 | 2);
      if (sc) drawCastBar(ctx, boss.x, boss.y, sc.prog, "#ffaa00", sc.name);
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

/**
 * 中央ボスの真偽リング（上=サンダガ / 下=ブリザガ）。
 *
 * アクティブな中央キャストの instance に対応する実際の真偽
 * （setup.centerAoE.<instance>.sandagaTruth/blizzagaTruth ほか）を読む。
 * 単発サンダガ時は上リングのみ / 単発ブリザガ時は下リングのみを表示する。
 *
 * ※ 真偽インジケータは「中央 AoE が詠唱中（テレグラフ中）」のときだけ表示し、
 *   AoE が発火（解決秒到達）した瞬間にクリアする。アイドル時（中央キャスト無し）や
 *   解決後の余韻表示中は 真/偽 を出さない。
 *   → GC3(28) や mid-fight サンダガ(57)/ブリザガ(74) の発火後に「偽」が残らない。
 */
function drawCenterTruthRings(
  ctx: CanvasRenderingContext2D,
  bx: number,
  by: number,
  setup: SimSetup,
  center: CenterCast | null,
  elapsed: number,
) {
  // 詠唱中のみ表示。center が無い／既に解決秒に達した（余韻表示）ならクリア。
  if (!center || elapsed >= center.resolveSec) return;
  const instance = center.instance;
  const t = centerTruths(setup, instance);
  // 上=サンダガ（紫系）。該当面があるときのみ描く。
  if (t.sandaga !== null) {
    drawTruthEllipse(ctx, bx, by - 25, "rgba(138, 43, 226, 0.4)", "#bf55ec", t.sandaga);
  }
  // 下=ブリザガ（青系）。
  if (t.blizzaga !== null) {
    drawTruthEllipse(ctx, bx, by + 45, "rgba(0, 180, 216, 0.4)", "#00b4d8", t.blizzaga);
  }
}

/** 外周ボスの真偽リング（参照 sub-boss）。 */
function drawSubBossRing(ctx: CanvasRenderingContext2D, bx: number, by: number, truth: Truth) {
  drawTruthEllipse(ctx, bx, by, "rgba(0, 180, 216, 0.35)", "#00f5d4", truth === "shin");
}

/**
 * 外周ボスが「いま詠唱している機構」の真偽。詠唱中以外は null。
 * デバフバッジ（setup 由来）と完全に一致させ、ボス表示の食い違いをなくす。
 *  - index1（8時 つなみ/ほのお）: 詠唱 [4,12)=wave1Truth / [16,24)=wave2Truth。
 *  - index2（4時 グランドクロス）: 詠唱 [0,8)=gc1Truth / [12,20)=gc2Truth（GC3 は色真偽なし→null）。
 */
function subBossTruth(setup: SimSetup, elapsed: number, index: 1 | 2): Truth | null {
  if (index === 1) {
    if (elapsed >= 4 && elapsed < 12) return setup.wave1Truth;
    if (elapsed >= 16 && elapsed < 24) return setup.wave2Truth;
    return null;
  }
  if (elapsed >= 0 && elapsed < 8) return setup.gc1Truth;
  if (elapsed >= 12 && elapsed < 20) return setup.gc2Truth;
  return null;
}

/** ある機構の「正しい場所/形」を半透明で予告描画。 */
function drawTarget(
  ctx: CanvasRenderingContext2D,
  req: RequiredAction,
  key: MechanicKey,
  setup: SimSetup,
  origins: Partial<Record<MechanicKey, Point>>,
  /** 視線（魔眼）の発射源。視線担当席なら席本人の足元、そうでなければ中央ボス。 */
  gazeSource: Point = CENTER,
) {
  const danger = "rgba(255,69,0,0.30)";
  const dangerEdge = "#ff4500";

  switch (req.kind) {
    // 頭割り(stack/filler)/散開(spread) の「正解の立ち位置」は表示しない（答えを出さない）。
    // プレイヤーが真偽バッジ・役割・ギミックから自分で位置を判断する。
    case "stack":
    case "filler":
    case "spread":
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
      // 分断線（青/ピンクの2面）は「読むべき」機構なので表示するが、
      // どちらが安全かの正解側ハイライトは出さない（プレイヤーが判断する）。
      const boss = gc3BossPos(setup.gc3BossAngle);
      drawSplit(ctx, boss, setup.gc3SplitTruth);
      break;
    }
    case "look":
    case "hide":
      // 視線（魔眼）が来ること自体は予告するが、見る/見ないの正解は明かさない。
      // 視線は発射源（視線対象者＝席本人 or 中央ボス）から全方向へ放射される。
      drawEyeTelegraph(ctx, gazeSource);
      break;
    case "stop":
    case "move":
    case "none":
    default:
      break;
  }
}

/**
 * 魔眼（視線）予告: 視線が「発射源から全方向へ」放射されることを示す。
 *
 * 視線は視線対象者（src）を源とし、全方向に発射される。練習なので
 * 「見る／見ない」の正解は明かさない（プレイヤーがデバフから判断する）。
 *
 * @param src 視線の発射源（視線担当席なら席本人の足元、そうでなければ中央ボス）。
 */
function drawEyeTelegraph(ctx: CanvasRenderingContext2D, src: Point = CENTER) {
  ctx.save();

  // 全方向の視線レイ（源から放射状に伸びる赤い線）。「全方向に発射」を可視化する。
  const RAYS = 16;
  const rayLen = ARENA_RADIUS * 2.2;
  ctx.lineWidth = 2;
  ctx.strokeStyle = "rgba(255,51,51,0.45)";
  for (let i = 0; i < RAYS; i++) {
    const a = (i / RAYS) * Math.PI * 2;
    ctx.beginPath();
    ctx.moveTo(src.x, src.y);
    ctx.lineTo(src.x + Math.cos(a) * rayLen, src.y + Math.sin(a) * rayLen);
    ctx.stroke();
  }

  // 発射源の眼マーカー（赤い眼の輪）。
  ctx.beginPath();
  ctx.arc(src.x, src.y, 22, 0, Math.PI * 2);
  ctx.strokeStyle = "rgba(255,51,51,0.9)";
  ctx.lineWidth = 3;
  ctx.stroke();
  const img = imgCache.shisen;
  const size = 26;
  if (loadedCache.shisen && img) {
    ctx.drawImage(img, src.x - size / 2, src.y - 36 - size, size, size);
  }

  // 「視線」が来ることだけを示す中立ラベル（正解は出さない）。
  const label = "視線（魔眼・全方向）";
  ctx.font = "bold 16px sans-serif";
  ctx.textAlign = "center";
  ctx.lineWidth = 4;
  ctx.strokeStyle = "#000";
  const ly = Math.max(20, src.y - 30);
  ctx.strokeText(label, src.x, ly);
  ctx.fillStyle = "#ffd9a0";
  ctx.fillText(label, src.x, ly);
  ctx.restore();
}

/**
 * GC3 分断面（参照 drawWave3SplitAoE: ボスへ translate→中心向き rotate、pink=+側 / blue=-側）。
 * 練習なので「安全側の強調」は出さない。2面（青/ピンク）と分断線だけを読ませる。
 */
function drawSplit(ctx: CanvasRenderingContext2D, boss: Point, truth?: Truth) {
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
  ctx.restore();

  // ボスマーカー。
  ctx.beginPath();
  ctx.arc(boss.x, boss.y, 14, 0, Math.PI * 2);
  ctx.fillStyle = "rgba(220,60,60,0.9)";
  ctx.fill();

  // 真/偽マーカー（外周エクスデス分断ボスの上）。
  // setup.gc3SplitTruth が安全側を反転させるので、プレイヤーが読めるように表示する。
  // 中央ボス真偽インジケータと同じ truth/fake 画像を再利用（preload 済み・loaded ガード）。
  if (truth) {
    const shin = truth === "shin";
    const key: IconKey = shin ? "truth" : "fake";
    const img = imgCache[key];
    const size = 26;
    const my = boss.y - 14 - 8 - size;
    if (loadedCache.truth && loadedCache.fake && img) {
      ctx.drawImage(img, boss.x - size / 2, my, size, size);
    } else {
      ctx.fillStyle = shin ? "#00b4d8" : "#ff4444";
      ctx.fillRect(boss.x - size / 2, my, size, size);
    }
  }
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

    // 実際の真偽バッジ（判定が読むのと同じ setup 由来の真実）。
    // 中央/分断ボスの真偽インジケータと同じ truth.png / fake.png を再利用。
    // パドルの色を読むのと同じく、プレイヤーが「真/偽 → 行動 → 位置」を自分で判断する。
    if (d.truth) {
      const shin = d.truth === "shin";
      const badgeKey: IconKey = shin ? "truth" : "fake";
      const badge = imgCache[badgeKey];
      const bs = 14;
      // アイコン左上に小さく重ねる。
      const bx = x - bs / 2;
      const byy = y - bs / 2;
      if (loadedCache[badgeKey] && badge) {
        ctx.drawImage(badge, bx, byy, bs, bs);
      } else {
        ctx.save();
        ctx.beginPath();
        ctx.arc(x, y, bs / 2, 0, Math.PI * 2);
        ctx.fillStyle = shin ? "#00b4d8" : "#ff4444";
        ctx.fill();
        ctx.strokeStyle = "#fff";
        ctx.lineWidth = 1.5;
        ctx.stroke();
        ctx.fillStyle = "#fff";
        ctx.font = "bold 10px sans-serif";
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillText(shin ? "真" : "偽", x, y + 0.5);
        ctx.restore();
        ctx.textBaseline = "alphabetic";
      }
    }
  });
}
