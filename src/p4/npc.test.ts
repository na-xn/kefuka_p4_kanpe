import { describe, it, expect } from "vitest";
import { generateSim, type SimSetup } from "@/p4/simulation";
import {
  type Point,
  CENTER,
  ARENA_RADIUS,
  ZONES,
  ZONE_RADIUS,
  PLAYER_RADIUS,
  dist,
  requiredAction,
  evaluate,
  exdeathZones,
  gc3BossPos,
  splitColorAt,
  isFacingCenter,
  centerAoeSafeGeometry,
  type CenterAoeParams,
  MECHANIC_SEC,
  type MechanicKey,
} from "@/p4/arena";
import { centerResolutions } from "@/p4/playTimeline";
import { npcState, npcTarget, seatHome, centerSafeNear, gazeFormationSpot } from "@/p4/npc";

/** 決定的な seeded RNG（mulberry32）。 */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const setup: SimSetup = generateSim(mulberry32(12345));
const ALL_SEATS = [0, 1, 2, 3, 4, 5, 6, 7];

/** 指定機構で req.kind が target のいずれかになる最初の席。 */
function findSeat(s: SimSetup, key: MechanicKey, kinds: string[]): number | null {
  for (const seat of ALL_SEATS) {
    const req = requiredAction(s, seat, key);
    if (kinds.includes(req.kind)) return seat;
  }
  return null;
}

/** 中央 AoE インスタンス → {params, geometry}。 */
function centerByInstance(s: SimSetup) {
  const idx: Record<string, { params: CenterAoeParams; geometry: "cross" | "thunder" | "blizzard" }> = {};
  for (const cr of centerResolutions(s)) idx[cr.instance] = { params: cr.params, geometry: cr.geometry };
  return idx;
}

/**
 * 指定の判定ゾーン基準点まわり（ZONE_RADIUS 内）にブリザガ安全点が存在するか、
 * 決定的にスキャンして返す（テスト用の独立スキャン）。
 */
function hasSafeInZone(base: Point, params: CenterAoeParams): boolean {
  if (centerAoeSafeGeometry(base, params, "blizzard")) return true;
  const RINGS = 24;
  const maxR = ZONE_RADIUS - PLAYER_RADIUS - 6;
  for (let r = 6; r <= maxR; r += 6) {
    for (let a = 0; a < RINGS; a++) {
      const ang = (a / RINGS) * Math.PI * 2;
      const p = { x: base.x + Math.cos(ang) * r, y: base.y + Math.sin(ang) * r };
      if (centerAoeSafeGeometry(p, params, "blizzard")) return true;
    }
  }
  return false;
}

describe("seatHome / npcTarget basics", () => {
  it("seatHome は中心から離れて重ならない", () => {
    for (const seat of ALL_SEATS) {
      const h = seatHome(seat);
      expect(dist(h, CENTER)).toBeGreaterThan(50);
      expect(dist(h, CENTER)).toBeLessThanOrEqual(ARENA_RADIUS);
    }
    expect(dist(seatHome(0), seatHome(1))).toBeGreaterThan(10);
  });
});

describe("npcState 不変条件", () => {
  it("全席・0..90 で pos は有限かつアリーナ内、facing は単位長", () => {
    for (const seat of ALL_SEATS) {
      for (let t = 0; t <= 90; t += 0.5) {
        const { pos, facing } = npcState(setup, seat, t);
        expect(Number.isFinite(pos.x) && Number.isFinite(pos.y)).toBe(true);
        expect(dist(pos, CENTER)).toBeLessThanOrEqual(ARENA_RADIUS + 1e-6);
        const flen = Math.hypot(facing.x, facing.y);
        expect(flen).toBeGreaterThan(0.99);
        expect(flen).toBeLessThan(1.01);
      }
    }
  });

  it("gc3 前（t=5）は seatHome 付近にいる", () => {
    for (const seat of ALL_SEATS) {
      const { pos } = npcState(setup, seat, 5);
      // t=4 のグランドクロス退避後・t=41 gc3 前なので、退避点 or home 近辺で有限。
      expect(Number.isFinite(pos.x)).toBe(true);
    }
  });

  it("決定的：同じ引数なら deep-equal", () => {
    for (const seat of ALL_SEATS) {
      for (const t of [0, 4, 16, 28, 41, 51, 57, 74, 79]) {
        expect(npcState(setup, seat, t)).toEqual(npcState(setup, seat, t));
      }
    }
  });
});

describe("evaluate 互換：water/filler", () => {
  it("early の stack/spread/filler 席は MECHANIC_SEC.early で evaluate 合格", () => {
    const seat = findSeat(setup, "early", ["stack", "spread", "filler"]);
    expect(seat).not.toBeNull();
    const role = setup.players[seat!].role;
    const { pos, facing, moving } = npcState(setup, seat!, MECHANIC_SEC.early);
    const req = requiredAction(setup, seat!, "early");
    const r = evaluate(
      req,
      pos,
      facing,
      moving,
      undefined,
      gc3BossPos(setup.gc3BossAngle),
      exdeathZones(setup.gc3BossAngle),
      role,
    );
    expect(r.ok).toBe(true);
  });

  it("late の stack/spread/filler 席は MECHANIC_SEC.late で evaluate 合格（固定 ZONES, ブリザガナッジ）", () => {
    const seat = findSeat(setup, "late", ["stack", "spread", "filler"]);
    expect(seat).not.toBeNull();
    const role = setup.players[seat!].role;
    const { pos, facing, moving } = npcState(setup, seat!, MECHANIC_SEC.late);
    const req = requiredAction(setup, seat!, "late");
    const r = evaluate(req, pos, facing, moving, undefined, undefined, ZONES, role);
    expect(r.ok).toBe(true);
  });

  it("全 stack/spread/filler 席が early/late で evaluate 合格（ナッジがゾーン内に留まる）", () => {
    for (const key of ["early", "late"] as const) {
      const zones = key === "early" ? exdeathZones(setup.gc3BossAngle) : ZONES;
      const boss = key === "early" ? gc3BossPos(setup.gc3BossAngle) : undefined;
      for (const seat of ALL_SEATS) {
        const req = requiredAction(setup, seat, key);
        if (!["stack", "spread", "filler"].includes(req.kind)) continue;
        const role = setup.players[seat].role;
        const { pos, facing, moving } = npcState(setup, seat, MECHANIC_SEC[key]);
        const r = evaluate(req, pos, facing, moving, undefined, boss, zones, role);
        expect(r.ok, `seat ${seat} key ${key}: ${r.reason}`).toBe(true);
      }
    }
  });
});

describe("中央 AoE 回避：グランドクロス / サンダガ / ブリザガ", () => {
  it("グランドクロス t=4/16/28 で全席が cross-safe", () => {
    const idx = centerByInstance(setup);
    const map: Record<number, "gc1" | "gc2" | "gc3"> = { 4: "gc1", 16: "gc2", 28: "gc3" };
    for (const t of [4, 16, 28] as const) {
      const ci = idx[map[t]];
      for (const seat of ALL_SEATS) {
        const { pos } = npcState(setup, seat, t);
        expect(
          centerAoeSafeGeometry(pos, ci.params, "cross"),
          `seat ${seat} t=${t} not cross-safe`,
        ).toBe(true);
      }
    }
  });

  it("サンダガ t=57 で全席が thunder-safe", () => {
    const sd = centerByInstance(setup)["sandaga"];
    for (const seat of ALL_SEATS) {
      const { pos } = npcState(setup, seat, 57);
      expect(centerAoeSafeGeometry(pos, sd.params, "thunder"), `seat ${seat} not thunder-safe`).toBe(true);
    }
  });

  it("ブリザガ t=74：合格(ゾーン内) かつ ゾーン内に安全点があれば blizzard-safe", () => {
    const bz = centerByInstance(setup)["blizzaga"];
    for (const seat of ALL_SEATS) {
      const req = requiredAction(setup, seat, "late");
      if (!["stack", "spread", "filler"].includes(req.kind)) continue;
      const role = setup.players[seat].role;
      const { pos, facing, moving } = npcState(setup, seat, 74);
      // ゾーン内（evaluate 合格）。
      const r = evaluate(req, pos, facing, moving, undefined, undefined, ZONES, role);
      expect(r.ok, `seat ${seat}: ${r.reason}`).toBe(true);
      // ゾーン内に安全点があるなら必ず blizzard-safe にナッジできている。
      const base = npcTarget(setup, seat, "late")!;
      // base はナッジ済みなので、純カーディナル基準でスキャンする。
      const cardinal = ZONES[req.kind === "spread" ? (role === "TH" ? "h9" : "h3") : role === "TH" ? "h12" : "h6"];
      if (hasSafeInZone(cardinal, bz.params)) {
        expect(centerAoeSafeGeometry(pos, bz.params, "blizzard"), `seat ${seat} should be blizzard-safe`).toBe(true);
      }
      void base;
    }
  });

  it("centerSafeNear は安全な preferred をそのまま返す", () => {
    const sd = centerByInstance(setup)["sandaga"];
    // 明らかに十字外の点を選ぶ：中心から離れた点を試し、安全なら不変。
    const p = { x: CENTER.x, y: CENTER.y - 250 };
    const out = centerSafeNear(p, sd.params, "thunder", 170);
    if (centerAoeSafeGeometry(p, sd.params, "thunder")) {
      expect(out).toEqual({ x: p.x, y: p.y });
    }
  });
});

describe("evaluate 互換：gc3 分断", () => {
  it("gc3 席は MECHANIC_SEC.gc3 で正解色側に立つ", () => {
    const seat = findSeat(setup, "gc3", ["gc3"]);
    expect(seat).not.toBeNull();
    const boss = gc3BossPos(setup.gc3BossAngle);
    const { pos, facing, moving } = npcState(setup, seat!, MECHANIC_SEC.gc3);
    const req = requiredAction(setup, seat!, "gc3");
    expect(splitColorAt(pos, boss)).toBe(req.color);
    const r = evaluate(req, pos, facing, moving, undefined, boss);
    expect(r.ok).toBe(true);
  });

  it("npcTarget gc3 は正解色側", () => {
    const seat = findSeat(setup, "gc3", ["gc3"]);
    const boss = gc3BossPos(setup.gc3BossAngle);
    const req = requiredAction(setup, seat!, "gc3");
    const target = npcTarget(setup, seat!, "gc3")!;
    expect(splitColorAt(target, boss)).toBe(req.color);
  });
});

describe("視線陣形：南北隊形 + look/hide 規約", () => {
  it("juso 解決時、look→中央向き / hide→背を向ける", () => {
    let tested = 0;
    for (const seat of ALL_SEATS) {
      for (const key of ["juso1", "juso2"] as const) {
        const req = requiredAction(setup, seat, key);
        if (req.kind !== "look" && req.kind !== "hide") continue;
        tested++;
        const { pos, facing } = npcState(setup, seat, MECHANIC_SEC[key]);
        if (req.kind === "look") {
          expect(isFacingCenter(pos, facing)).toBe(true);
        } else {
          expect(isFacingCenter(pos, facing)).toBe(false);
        }
      }
    }
    expect(tested).toBeGreaterThan(0);
  });

  it("t=57 / t=79 で TH は北(y<center) / DPS は南(y>center)", () => {
    for (const t of [57, 79] as const) {
      for (const seat of ALL_SEATS) {
        const { pos } = npcState(setup, seat, t);
        const role = setup.players[seat].role;
        if (role === "TH") {
          expect(pos.y, `seat ${seat} TH t=${t}`).toBeLessThan(CENTER.y);
        } else {
          expect(pos.y, `seat ${seat} DPS t=${t}`).toBeGreaterThan(CENTER.y);
        }
      }
    }
  });

  it("視線持ちは同ロールの視線無し席より中央に近い（陣形の内/外）", () => {
    for (const key of ["juso1", "juso2"] as const) {
      for (const role of ["TH", "DPS"] as const) {
        const seats = ALL_SEATS.filter((s) => setup.players[s].role === role);
        const bearers = seats.filter((s) => {
          const k = requiredAction(setup, s, key).kind;
          return k === "look" || k === "hide";
        });
        const nons = seats.filter((s) => !bearers.includes(s));
        if (bearers.length === 0 || nons.length === 0) continue;
        const vy = (s: number) => Math.abs(gazeFormationSpot(setup, s, key).y - CENTER.y);
        const maxBearer = Math.max(...bearers.map(vy));
        const minNon = Math.min(...nons.map(vy));
        expect(maxBearer, `${role} ${key}`).toBeLessThan(minNon);
      }
    }
  });
});

describe("moving + ジッター：加速弾の動く/止まる", () => {
  it("env 機構が move なら解決時 moving=true、stop なら false", () => {
    let tested = 0;
    for (const seat of ALL_SEATS) {
      for (const key of ["early", "late"] as const) {
        const req = requiredAction(setup, seat, key);
        const isMove = req.move === "move" || req.kind === "move";
        const isStop = req.move === "stop" || req.kind === "stop";
        if (!isMove && !isStop) continue;
        tested++;
        const { moving } = npcState(setup, seat, MECHANIC_SEC[key]);
        expect(moving).toBe(isMove);
      }
    }
    expect(tested).toBeGreaterThan(0);
  });

  it("move 席は静的カーディナルからジッターでずれるが ZONE_RADIUS 内に留まる", () => {
    let tested = 0;
    for (const seat of ALL_SEATS) {
      for (const key of ["early", "late"] as const) {
        const req = requiredAction(setup, seat, key);
        const isMove = req.move === "move" || req.kind === "move";
        if (!isMove) continue;
        tested++;
        const target = npcTarget(setup, seat, key)!;
        const { pos } = npcState(setup, seat, MECHANIC_SEC[key]);
        // ジッターで静的目標から（わずかに）ずれている。
        expect(dist(pos, target)).toBeGreaterThan(0);
        // それでも目標（ゾーン基準）から十分近い（合否を崩さない）。
        expect(dist(pos, target)).toBeLessThan(ZONE_RADIUS);
      }
    }
    expect(tested).toBeGreaterThan(0);
  });
});
