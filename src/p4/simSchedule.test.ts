import { describe, it, expect } from "vitest";
import { generateSim } from "@/p4/simulation";
import {
  buildRevealSchedule,
  gcRoleLabel,
  gc3RoleLabel,
  waveLabel,
  truthLabel,
  PROCESS_AT_SEC,
} from "@/p4/simSchedule";

/** 決定的 RNG（線形合同法）。 */
function seeded(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 0x100000000;
  };
}

describe("simSchedule", () => {
  it("builds 5 rows at t=8/16/24/32/40 in order", () => {
    const setup = generateSim(seeded(42));
    const rows = buildRevealSchedule(setup);
    expect(rows.map((r) => r.atSec)).toEqual([8, 16, 24, 32, 40]);
    expect(rows.map((r) => r.key)).toEqual(["gc1", "wave1", "gc2", "wave2", "gc3"]);
  });

  it("GC3 row carries no truth; others carry truth", () => {
    const setup = generateSim(seeded(7));
    const rows = buildRevealSchedule(setup);
    const byKey = Object.fromEntries(rows.map((r) => [r.key, r]));
    expect(byKey.gc3.truth).toBeUndefined();
    expect(byKey.gc1.truth).toBe(setup.gc1Truth);
    expect(byKey.gc2.truth).toBe(setup.gc2Truth);
    expect(byKey.wave1.truth).toBe(setup.wave1Truth);
    expect(byKey.wave2.truth).toBe(setup.wave2Truth);
  });

  it("reflects seat 0 assignment and wave types", () => {
    const setup = generateSim(seeded(99));
    const me = setup.players.find((p) => p.seat === 0)!;
    const rows = buildRevealSchedule(setup);
    const byKey = Object.fromEntries(rows.map((r) => [r.key, r]));
    expect(byKey.gc1.label).toBe(gcRoleLabel(me.gc1Role));
    expect(byKey.gc2.label).toBe(gcRoleLabel(me.gc2Role));
    expect(byKey.gc3.label).toBe(gc3RoleLabel(me.gc3Role));
    expect(byKey.wave1.label).toBe(waveLabel(setup.wave1Type));
    expect(byKey.wave2.label).toBe(waveLabel(setup.wave2Type));
  });

  it("labels and process threshold", () => {
    expect(truthLabel("shin")).toBe("ほんと");
    expect(truthLabel("gi")).toBe("うそ");
    expect(PROCESS_AT_SEC).toBe(50);
  });
});
