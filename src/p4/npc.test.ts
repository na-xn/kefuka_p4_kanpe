import { describe, it, expect } from "vitest";
import { generateSim, type SimSetup } from "@/p4/simulation";
import {
  CENTER,
  ARENA_RADIUS,
  ZONES,
  dist,
  requiredAction,
  evaluate,
  exdeathZones,
  gc3BossPos,
  splitColorAt,
  isFacingCenter,
  MECHANIC_SEC,
  type MechanicKey,
} from "@/p4/arena";
import { npcState, npcTarget, seatHome } from "@/p4/npc";

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

describe("seatHome / npcTarget basics", () => {
  it("seatHome は中心から離れて重ならない", () => {
    for (const seat of ALL_SEATS) {
      const h = seatHome(seat);
      expect(dist(h, CENTER)).toBeGreaterThan(50);
      expect(dist(h, CENTER)).toBeLessThanOrEqual(ARENA_RADIUS);
    }
    // 隣り合う席は別位置。
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
      expect(dist(pos, seatHome(seat))).toBeLessThan(1);
    }
  });

  it("決定的：同じ引数なら deep-equal", () => {
    for (const seat of ALL_SEATS) {
      expect(npcState(setup, seat, 51)).toEqual(npcState(setup, seat, 51));
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

  it("late の stack/spread/filler 席は MECHANIC_SEC.late で evaluate 合格（固定 ZONES）", () => {
    const seat = findSeat(setup, "late", ["stack", "spread", "filler"]);
    expect(seat).not.toBeNull();
    const role = setup.players[seat!].role;
    const { pos, facing, moving } = npcState(setup, seat!, MECHANIC_SEC.late);
    const req = requiredAction(setup, seat!, "late");
    const r = evaluate(req, pos, facing, moving, undefined, undefined, ZONES, role);
    expect(r.ok).toBe(true);
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

describe("視線：look/hide 規約", () => {
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
});

describe("moving：加速弾の動く/止まる", () => {
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
});
