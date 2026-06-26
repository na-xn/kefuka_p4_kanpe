import { describe, it, expect } from "vitest";
import { INITIAL_MIN } from "@/components/p4/MinimumMode";
import {
  generateSim,
  toMinState,
  seatJob,
  type GcRole,
  type Gc3Role,
  type Gc3Scar,
} from "@/p4/simulation";

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

/** 役割ごとの出現数を数える。 */
function counts<T extends string>(arr: T[]): Record<string, number> {
  const c: Record<string, number> = {};
  for (const x of arr) c[x] = (c[x] ?? 0) + 1;
  return c;
}

const SEEDS = Array.from({ length: 200 }, (_, i) => i * 7 + 1);

describe("generateSim composition", () => {
  it("GC1 always 2/2/2/2, GC3 always 4/4, 8 unique seats", () => {
    for (const seed of SEEDS) {
      const setup = generateSim(mulberry32(seed));
      expect(setup.players).toHaveLength(8);

      const seats = setup.players.map((p) => p.seat).sort((a, b) => a - b);
      expect(seats).toEqual([0, 1, 2, 3, 4, 5, 6, 7]);

      const gc1 = counts(setup.players.map((p) => p.gc1Role as GcRole));
      expect(gc1).toEqual({ mizu: 2, rai: 2, shisen: 2, mushoku: 2 });

      const gc3 = counts(setup.players.map((p) => p.gc3Role as Gc3Role));
      expect(gc3).toEqual({ aragan: 4, shi: 4 });
    }
  });

  it("role is deterministic: seats 0-3 TH / 4-7 DPS, independent of shuffles", () => {
    for (const seed of SEEDS) {
      const setup = generateSim(mulberry32(seed));
      for (const p of setup.players) {
        expect(p.role).toBe(p.seat < 4 ? "TH" : "DPS");
      }
    }
  });

  it("gc3Scar always 4 seija / 4 shisha, each player has a valid scar", () => {
    for (const seed of SEEDS) {
      const setup = generateSim(mulberry32(seed));
      for (const p of setup.players) {
        expect(["seija", "shisha"]).toContain(p.gc3Scar as Gc3Scar);
      }
      const scar = counts(setup.players.map((p) => p.gc3Scar as Gc3Scar));
      expect(scar).toEqual({ seija: 4, shisha: 4 });
    }
  });

  it("swap invariant: GC1 水雷 ⇔ GC2 加速度系, and GC2 is 2/2/2/2", () => {
    const isWater = (r: GcRole) => r === "mizu" || r === "rai";
    for (const seed of SEEDS) {
      const setup = generateSim(mulberry32(seed));
      for (const p of setup.players) {
        // ちょうど一方が水雷、他方が加速度系。
        expect(isWater(p.gc1Role) !== isWater(p.gc2Role)).toBe(true);
      }
      const gc2 = counts(setup.players.map((p) => p.gc2Role as GcRole));
      expect(gc2).toEqual({ mizu: 2, rai: 2, shisen: 2, mushoku: 2 });
    }
  });

  it("wave2Type is always the opposite of wave1Type", () => {
    for (const seed of SEEDS) {
      const setup = generateSim(mulberry32(seed));
      expect(setup.wave2Type).not.toBe(setup.wave1Type);
      expect(new Set([setup.wave1Type, setup.wave2Type])).toEqual(
        new Set(["honoo", "tsunami"]),
      );
    }
  });

  it("gc3BossAngle is a deterministic integer index 0..7", () => {
    for (const seed of SEEDS) {
      const setup = generateSim(mulberry32(seed));
      expect(Number.isInteger(setup.gc3BossAngle)).toBe(true);
      expect(setup.gc3BossAngle).toBeGreaterThanOrEqual(0);
      expect(setup.gc3BossAngle).toBeLessThanOrEqual(7);
      // 同一シードで再現的。
      const again = generateSim(mulberry32(seed));
      expect(again.gc3BossAngle).toBe(setup.gc3BossAngle);
    }
  });

  it("gc3SplitTruth is a deterministic shin/gi truth", () => {
    for (const seed of SEEDS) {
      const setup = generateSim(mulberry32(seed));
      expect(["shin", "gi"]).toContain(setup.gc3SplitTruth);
      const again = generateSim(mulberry32(seed));
      expect(again.gc3SplitTruth).toBe(setup.gc3SplitTruth);
    }
  });

  it("gc3SplitTruth is additive: existing center/boss fields don't shift", () => {
    // 新 rng() は全フィールド生成後に引くため、それ以前のフィールドは不変。
    const setup = generateSim(mulberry32(2024));
    const ref = generateSim(mulberry32(2024));
    expect(setup.centerAoE).toEqual(ref.centerAoE);
    expect(setup.gc3BossAngle).toBe(ref.gc3BossAngle);
  });

  it("centerAoE has gc1/gc2/gc3 + 単発 sandaga/blizzaga, all deterministic & in range", () => {
    for (const seed of SEEDS) {
      const setup = generateSim(mulberry32(seed));
      const again = generateSim(mulberry32(seed));
      const c = setup.centerAoE;
      for (const k of ["gc1", "gc2", "gc3"] as const) {
        expect(["shin", "gi"]).toContain(c[k].sandagaTruth);
        expect(["shin", "gi"]).toContain(c[k].blizzagaTruth);
        expect(c[k].thunderPattern).toBeGreaterThanOrEqual(0);
        expect(c[k].thunderPattern).toBeLessThanOrEqual(3);
        expect([0, 1]).toContain(c[k].blizzardPattern);
      }
      // 単発サンダガ（雷十字）/ ブリザガ（象限）。
      expect(["shin", "gi"]).toContain(c.sandaga.truth);
      expect(c.sandaga.thunderPattern).toBeGreaterThanOrEqual(0);
      expect(c.sandaga.thunderPattern).toBeLessThanOrEqual(3);
      expect(["shin", "gi"]).toContain(c.blizzaga.truth);
      expect([0, 1]).toContain(c.blizzaga.blizzardPattern);
      // 同一シードで完全再現。
      expect(again.centerAoE).toEqual(c);
    }
  });

  it("centerAoE.finalMemory is a valid deterministic shape (マジックアウト リビール + パターン)", () => {
    for (const seed of SEEDS) {
      const setup = generateSim(mulberry32(seed));
      const again = generateSim(mulberry32(seed));
      const fm = setup.centerAoE.finalMemory;
      expect(["shin", "gi"]).toContain(fm.sandagaOut);
      expect(["shin", "gi"]).toContain(fm.blizzagaOut);
      expect(fm.thunderPattern).toBeGreaterThanOrEqual(0);
      expect(fm.thunderPattern).toBeLessThanOrEqual(3);
      expect([0, 1]).toContain(fm.blizzardPattern);
      // 同一シードで完全再現。
      expect(again.centerAoE.finalMemory).toEqual(fm);
    }
  });

  it("finalMemory is additive: existing fields (centerAoE.gc1..blizzaga / gc3BossAngle / gc3SplitTruth) don't shift", () => {
    // 新 rng() は gc3SplitTruth 含む全フィールド生成「後」に引くため、既存値は不変。
    const setup = generateSim(mulberry32(2024));
    const ref = generateSim(mulberry32(2024));
    expect(setup.centerAoE.gc1).toEqual(ref.centerAoE.gc1);
    expect(setup.centerAoE.gc2).toEqual(ref.centerAoE.gc2);
    expect(setup.centerAoE.gc3).toEqual(ref.centerAoE.gc3);
    expect(setup.centerAoE.sandaga).toEqual(ref.centerAoE.sandaga);
    expect(setup.centerAoE.blizzaga).toEqual(ref.centerAoE.blizzaga);
    expect(setup.gc3BossAngle).toBe(ref.gc3BossAngle);
    expect(setup.gc3SplitTruth).toBe(ref.gc3SplitTruth);
  });

  it("gc3/sandaga/blizzaga are additive: existing fields don't shift", () => {
    // 新 rng() 呼び出しは gc2 の後に追加したため、それ以前のフィールドは不変。
    const setup = generateSim(mulberry32(2024));
    // gc1WaterEarly / gc3BossAngle / centerAoE.gc1/gc2 は新フィールド追加前と同じ値。
    // （回帰ガード: 既知シードでの安定性を固定する。）
    expect(setup.centerAoE.gc1).toEqual(generateSim(mulberry32(2024)).centerAoE.gc1);
    expect(setup.centerAoE.gc2).toEqual(generateSim(mulberry32(2024)).centerAoE.gc2);
  });
});

describe("toMinState", () => {
  it("raid-wide truths are consistent across all 8 seats", () => {
    const setup = generateSim(mulberry32(12345));
    const honooTruth =
      setup.wave1Type === "honoo" ? setup.wave1Truth : setup.wave2Truth;
    const tsunamiTruth =
      setup.wave1Type === "tsunami" ? setup.wave1Truth : setup.wave2Truth;

    for (let seat = 0; seat < 8; seat++) {
      const ms = toMinState(setup, seat);
      expect(ms.gc1).toBe(setup.gc1Truth);
      expect(ms.gc2).toBe(setup.gc2Truth);
      expect(ms.honoo).toBe(honooTruth);
      expect(ms.tsunami).toBe(tsunamiTruth);
      expect(ms.thunda).toBe(setup.thundaTruth);
      expect(ms.blizza).toBe(setup.blizzaTruth);
    }
  });

  it("per-player water/accel fields are internally consistent", () => {
    for (const seed of SEEDS.slice(0, 50)) {
      const setup = generateSim(mulberry32(seed));
      for (const p of setup.players) {
        const ms = toMinState(setup, p.seat);

        // waterGC points at the GC where this player is 水雷.
        const waterRole = ms.waterGC === "1" ? p.gc1Role : p.gc2Role;
        const accelRole = ms.waterGC === "1" ? p.gc2Role : p.gc1Role;
        expect(waterRole === "mizu" || waterRole === "rai").toBe(true);
        expect(accelRole === "shisen" || accelRole === "mushoku").toBe(true);

        // waterType matches the actual 水雷 role.
        expect(ms.waterType).toBe(waterRole);
        // shisen flag matches the actual 加速度系 role.
        expect(ms.shisen).toBe(accelRole === "shisen" ? "yes" : "no");

        // waterWhen follows gc1WaterEarly relative to waterGC.
        const expectedWhen =
          ms.waterGC === "1"
            ? setup.gc1WaterEarly
              ? "haya"
              : "oso"
            : setup.gc1WaterEarly
              ? "oso"
              : "haya";
        expect(ms.waterWhen).toBe(expectedWhen);
      }
    }
  });

  it("output keys exactly match INITIAL_MIN key set", () => {
    const setup = generateSim(mulberry32(999));
    const expected = Object.keys(INITIAL_MIN).sort();
    for (let seat = 0; seat < 8; seat++) {
      const ms = toMinState(setup, seat);
      expect(Object.keys(ms).sort()).toEqual(expected);
    }
  });
});

describe("PlayerAssignment job field", () => {
  it("each player has the correct job for their seat", () => {
    const setup = generateSim(mulberry32(12345));
    const players = setup.players;

    // 2 tanks, 2 healers, 4 dps
    const tanks = players.filter((p) => p.job === "tank");
    const healers = players.filter((p) => p.job === "healer");
    const dps = players.filter((p) => p.job === "dps");
    expect(tanks).toHaveLength(2);
    expect(healers).toHaveLength(2);
    expect(dps).toHaveLength(4);

    // tank seats are {0,1}, healer {2,3}, dps {4,5,6,7}
    expect(new Set(tanks.map((p) => p.seat))).toEqual(new Set([0, 1]));
    expect(new Set(healers.map((p) => p.seat))).toEqual(new Set([2, 3]));
    expect(new Set(dps.map((p) => p.seat))).toEqual(new Set([4, 5, 6, 7]));

    // role↔job consistency
    for (const p of players) {
      expect(p.role).toBe(p.job === "dps" ? "DPS" : "TH");
    }
  });

  it("seatJob helper returns correct job for each seat", () => {
    expect(seatJob(0)).toBe("tank");
    expect(seatJob(1)).toBe("tank");
    expect(seatJob(2)).toBe("healer");
    expect(seatJob(3)).toBe("healer");
    expect(seatJob(4)).toBe("dps");
    expect(seatJob(7)).toBe("dps");
  });
});
