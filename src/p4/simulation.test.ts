import { describe, it, expect } from "vitest";
import { INITIAL_MIN } from "@/components/p4/MinimumMode";
import {
  generateSim,
  toMinState,
  type GcRole,
  type Gc3Role,
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
