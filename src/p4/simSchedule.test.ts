import { describe, it, expect } from "vitest";
import { generateSim } from "@/p4/simulation";
import type { SimSetup } from "@/p4/simulation";
import {
  buildRevealSchedule,
  gcRoleLabel,
  gc3RoleLabel,
  waveLabel,
  truthLabel,
  PROCESS_AT_SEC,
} from "@/p4/simSchedule";
import { DEBUFF_ICON } from "@/p4/icons";

/** 決定的 RNG（線形合同法）。 */
function seeded(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 0x100000000;
  };
}

describe("simSchedule", () => {
  it("builds 6 rows at t=8/16/24/32/40/40 in order", () => {
    const setup = generateSim(seeded(42));
    const rows = buildRevealSchedule(setup);
    expect(rows.map((r) => r.atSec)).toEqual([8, 16, 24, 32, 40, 40]);
    expect(rows.map((r) => r.key)).toEqual(["gc1", "wave1", "gc2", "wave2", "gc3", "gc3scar"]);
  });

  it("GC3 row carries no truth; others carry truth", () => {
    const setup = generateSim(seeded(7));
    const rows = buildRevealSchedule(setup);
    const byKey = Object.fromEntries(rows.map((r) => [r.key, r]));
    expect(byKey.gc3.truth).toBeUndefined();
    expect(byKey.gc3scar.truth).toBeUndefined();
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
    expect(PROCESS_AT_SEC).toBe(44);
  });

  it("GC3 row resolveSec is null", () => {
    const setup = generateSim(seeded(42));
    const rows = buildRevealSchedule(setup);
    const byKey = Object.fromEntries(rows.map((r) => [r.key, r]));
    expect(byKey.gc3.resolveSec).toBeNull();
    expect(byKey.gc3scar.resolveSec).toBeNull();
  });

  it("gc3scar row: icon and label reflect player's scar", () => {
    for (const seed of [1, 42, 99, 777]) {
      const setup = generateSim(seeded(seed));
      const me = setup.players.find((p) => p.seat === 0)!;
      const rows = buildRevealSchedule(setup, 0);
      const byKey = Object.fromEntries(rows.map((r) => [r.key, r]));
      const scar = byKey.gc3scar;
      expect(scar.atSec).toBe(40);
      if (me.gc3Scar === "seija") {
        expect(scar.icon).toBe(DEBUFF_ICON.seija);
        expect(scar.label).toBe("生者(生者の傷)");
      } else {
        expect(scar.icon).toBe(DEBUFF_ICON.shisha);
        expect(scar.label).toBe("死者(死者の傷)");
      }
    }
  });

  it("wave rows: honoo=62, tsunami=84", () => {
    // Build a setup with known wave types via fixed seed, or use overrides.
    // Seed 1: check wave types and confirm resolveSec.
    const setupA = generateSim(seeded(1));
    const rowsA = buildRevealSchedule(setupA);
    const byKeyA = Object.fromEntries(rowsA.map((r) => [r.key, r]));
    expect(byKeyA.wave1.resolveSec).toBe(setupA.wave1Type === "honoo" ? 62 : 84);
    expect(byKeyA.wave2.resolveSec).toBe(setupA.wave2Type === "honoo" ? 62 : 84);
  });

  it("wave rows resolveSec: honoo=62, tsunami=84 via forced setups", () => {
    // Construct minimal setups to force honoo/tsunami wave types.
    const base: SimSetup = {
      gc1Truth: "shin",
      gc2Truth: "shin",
      wave1Type: "honoo",
      wave1Truth: "shin",
      wave2Type: "tsunami",
      wave2Truth: "shin",
      gc1WaterEarly: true,
      thundaTruth: "shin",
      blizzaTruth: "shin",
      gc3BossAngle: 0,
      gc3SplitTruth: "shin",
      centerAoE: {
        gc1: { sandagaTruth: "shin", blizzagaTruth: "shin", thunderPattern: 0, blizzardPattern: 0 },
        gc2: { sandagaTruth: "shin", blizzagaTruth: "shin", thunderPattern: 0, blizzardPattern: 0 },
        gc3: { sandagaTruth: "shin", blizzagaTruth: "shin", thunderPattern: 0, blizzardPattern: 0 },
        sandaga: { truth: "shin", thunderPattern: 0 },
        blizzaga: { truth: "shin", blizzardPattern: 0 },
      },
      players: [
        { seat: 0, role: "TH", gc1Role: "mizu", gc2Role: "shisen", gc3Role: "aragan", gc3Scar: "seija" },
        { seat: 1, role: "TH", gc1Role: "rai", gc2Role: "mushoku", gc3Role: "aragan", gc3Scar: "seija" },
        { seat: 2, role: "TH", gc1Role: "shisen", gc2Role: "mizu", gc3Role: "aragan", gc3Scar: "seija" },
        { seat: 3, role: "TH", gc1Role: "mushoku", gc2Role: "rai", gc3Role: "aragan", gc3Scar: "seija" },
        { seat: 4, role: "DPS", gc1Role: "mizu", gc2Role: "shisen", gc3Role: "shi", gc3Scar: "shisha" },
        { seat: 5, role: "DPS", gc1Role: "rai", gc2Role: "mushoku", gc3Role: "shi", gc3Scar: "shisha" },
        { seat: 6, role: "DPS", gc1Role: "shisen", gc2Role: "mizu", gc3Role: "shi", gc3Scar: "shisha" },
        { seat: 7, role: "DPS", gc1Role: "mushoku", gc2Role: "rai", gc3Role: "shi", gc3Scar: "shisha" },
      ],
    };
    const rows = buildRevealSchedule(base);
    const byKey = Object.fromEntries(rows.map((r) => [r.key, r]));
    expect(byKey.wave1.resolveSec).toBe(62); // honoo
    expect(byKey.wave2.resolveSec).toBe(84); // tsunami
  });

  it("GC role resolveSec: 水雷 early/late by gc1WaterEarly", () => {
    // seat 0 = gc1Role:mizu (水雷 at GC1), gc2Role:shisen (加速度 at GC2)
    const baseEarly: SimSetup = {
      gc1Truth: "shin",
      gc2Truth: "shin",
      wave1Type: "honoo",
      wave1Truth: "shin",
      wave2Type: "tsunami",
      wave2Truth: "shin",
      gc1WaterEarly: true, // GC1 水雷 = 早
      thundaTruth: "shin",
      blizzaTruth: "shin",
      gc3BossAngle: 0,
      gc3SplitTruth: "shin",
      centerAoE: {
        gc1: { sandagaTruth: "shin", blizzagaTruth: "shin", thunderPattern: 0, blizzardPattern: 0 },
        gc2: { sandagaTruth: "shin", blizzagaTruth: "shin", thunderPattern: 0, blizzardPattern: 0 },
        gc3: { sandagaTruth: "shin", blizzagaTruth: "shin", thunderPattern: 0, blizzardPattern: 0 },
        sandaga: { truth: "shin", thunderPattern: 0 },
        blizzaga: { truth: "shin", blizzardPattern: 0 },
      },
      players: [
        { seat: 0, role: "TH", gc1Role: "mizu", gc2Role: "shisen", gc3Role: "aragan", gc3Scar: "seija" },
        { seat: 1, role: "TH", gc1Role: "rai", gc2Role: "mushoku", gc3Role: "aragan", gc3Scar: "seija" },
        { seat: 2, role: "TH", gc1Role: "shisen", gc2Role: "mizu", gc3Role: "aragan", gc3Scar: "seija" },
        { seat: 3, role: "TH", gc1Role: "mushoku", gc2Role: "rai", gc3Role: "aragan", gc3Scar: "seija" },
        { seat: 4, role: "DPS", gc1Role: "mizu", gc2Role: "shisen", gc3Role: "shi", gc3Scar: "shisha" },
        { seat: 5, role: "DPS", gc1Role: "rai", gc2Role: "mushoku", gc3Role: "shi", gc3Scar: "shisha" },
        { seat: 6, role: "DPS", gc1Role: "shisen", gc2Role: "mizu", gc3Role: "shi", gc3Scar: "shisha" },
        { seat: 7, role: "DPS", gc1Role: "mushoku", gc2Role: "rai", gc3Role: "shi", gc3Scar: "shisha" },
      ],
    };
    const rowsEarly = buildRevealSchedule(baseEarly);
    const byKeyEarly = Object.fromEntries(rowsEarly.map((r) => [r.key, r]));
    // GC1 mizu, gc1WaterEarly=true → early → 51
    expect(byKeyEarly.gc1.resolveSec).toBe(51);
    // GC2 shisen, gc===2 → early=true → 51... but wait: shisen at GC2: early=(gc===1) = false → 74
    expect(byKeyEarly.gc2.resolveSec).toBe(74);

    const baseLate: SimSetup = { ...baseEarly, gc1WaterEarly: false };
    const rowsLate = buildRevealSchedule(baseLate);
    const byKeyLate = Object.fromEntries(rowsLate.map((r) => [r.key, r]));
    // GC1 mizu, gc1WaterEarly=false → late → 74
    expect(byKeyLate.gc1.resolveSec).toBe(74);
    // GC2 shisen still → 74
    expect(byKeyLate.gc2.resolveSec).toBe(74);
  });

  it("GC role resolveSec: 視線 GC1=51, 視線 GC2=74", () => {
    // seat 0 with shisen at GC1
    const setupShisenGC1: SimSetup = {
      gc1Truth: "shin",
      gc2Truth: "shin",
      wave1Type: "honoo",
      wave1Truth: "shin",
      wave2Type: "tsunami",
      wave2Truth: "shin",
      gc1WaterEarly: true,
      thundaTruth: "shin",
      blizzaTruth: "shin",
      gc3BossAngle: 0,
      gc3SplitTruth: "shin",
      centerAoE: {
        gc1: { sandagaTruth: "shin", blizzagaTruth: "shin", thunderPattern: 0, blizzardPattern: 0 },
        gc2: { sandagaTruth: "shin", blizzagaTruth: "shin", thunderPattern: 0, blizzardPattern: 0 },
        gc3: { sandagaTruth: "shin", blizzagaTruth: "shin", thunderPattern: 0, blizzardPattern: 0 },
        sandaga: { truth: "shin", thunderPattern: 0 },
        blizzaga: { truth: "shin", blizzardPattern: 0 },
      },
      players: [
        { seat: 0, role: "TH", gc1Role: "shisen", gc2Role: "mizu", gc3Role: "aragan", gc3Scar: "seija" },
        { seat: 1, role: "TH", gc1Role: "mushoku", gc2Role: "rai", gc3Role: "aragan", gc3Scar: "seija" },
        { seat: 2, role: "TH", gc1Role: "mizu", gc2Role: "shisen", gc3Role: "aragan", gc3Scar: "seija" },
        { seat: 3, role: "TH", gc1Role: "rai", gc2Role: "mushoku", gc3Role: "aragan", gc3Scar: "seija" },
        { seat: 4, role: "DPS", gc1Role: "shisen", gc2Role: "mizu", gc3Role: "shi", gc3Scar: "shisha" },
        { seat: 5, role: "DPS", gc1Role: "mushoku", gc2Role: "rai", gc3Role: "shi", gc3Scar: "shisha" },
        { seat: 6, role: "DPS", gc1Role: "mizu", gc2Role: "shisen", gc3Role: "shi", gc3Scar: "shisha" },
        { seat: 7, role: "DPS", gc1Role: "rai", gc2Role: "mushoku", gc3Role: "shi", gc3Scar: "shisha" },
      ],
    };
    const rows1 = buildRevealSchedule(setupShisenGC1);
    const by1 = Object.fromEntries(rows1.map((r) => [r.key, r]));
    expect(by1.gc1.resolveSec).toBe(51); // shisen at GC1 → early

    // seat 0 with shisen at GC2
    const setupShisenGC2: SimSetup = {
      ...setupShisenGC1,
      players: [
        { seat: 0, role: "TH", gc1Role: "mizu", gc2Role: "shisen", gc3Role: "aragan", gc3Scar: "seija" },
        { seat: 1, role: "TH", gc1Role: "rai", gc2Role: "mushoku", gc3Role: "aragan", gc3Scar: "seija" },
        { seat: 2, role: "TH", gc1Role: "shisen", gc2Role: "mizu", gc3Role: "aragan", gc3Scar: "seija" },
        { seat: 3, role: "TH", gc1Role: "mushoku", gc2Role: "rai", gc3Role: "aragan", gc3Scar: "seija" },
        { seat: 4, role: "DPS", gc1Role: "mizu", gc2Role: "shisen", gc3Role: "shi", gc3Scar: "shisha" },
        { seat: 5, role: "DPS", gc1Role: "rai", gc2Role: "mushoku", gc3Role: "shi", gc3Scar: "shisha" },
        { seat: 6, role: "DPS", gc1Role: "shisen", gc2Role: "mizu", gc3Role: "shi", gc3Scar: "shisha" },
        { seat: 7, role: "DPS", gc1Role: "mushoku", gc2Role: "rai", gc3Role: "shi", gc3Scar: "shisha" },
      ],
    };
    const rows2 = buildRevealSchedule(setupShisenGC2);
    const by2 = Object.fromEntries(rows2.map((r) => [r.key, r]));
    expect(by2.gc2.resolveSec).toBe(74); // shisen at GC2 → late
  });

  it("GC role resolveSec: 無職 GC1=74, 無職 GC2=51", () => {
    // seat 0 with mushoku at GC1
    const setupMushokuGC1: SimSetup = {
      gc1Truth: "shin",
      gc2Truth: "shin",
      wave1Type: "honoo",
      wave1Truth: "shin",
      wave2Type: "tsunami",
      wave2Truth: "shin",
      gc1WaterEarly: true,
      thundaTruth: "shin",
      blizzaTruth: "shin",
      gc3BossAngle: 0,
      gc3SplitTruth: "shin",
      centerAoE: {
        gc1: { sandagaTruth: "shin", blizzagaTruth: "shin", thunderPattern: 0, blizzardPattern: 0 },
        gc2: { sandagaTruth: "shin", blizzagaTruth: "shin", thunderPattern: 0, blizzardPattern: 0 },
        gc3: { sandagaTruth: "shin", blizzagaTruth: "shin", thunderPattern: 0, blizzardPattern: 0 },
        sandaga: { truth: "shin", thunderPattern: 0 },
        blizzaga: { truth: "shin", blizzardPattern: 0 },
      },
      players: [
        { seat: 0, role: "TH", gc1Role: "mushoku", gc2Role: "mizu", gc3Role: "aragan", gc3Scar: "seija" },
        { seat: 1, role: "TH", gc1Role: "shisen", gc2Role: "rai", gc3Role: "aragan", gc3Scar: "seija" },
        { seat: 2, role: "TH", gc1Role: "mizu", gc2Role: "shisen", gc3Role: "aragan", gc3Scar: "seija" },
        { seat: 3, role: "TH", gc1Role: "rai", gc2Role: "mushoku", gc3Role: "aragan", gc3Scar: "seija" },
        { seat: 4, role: "DPS", gc1Role: "mushoku", gc2Role: "mizu", gc3Role: "shi", gc3Scar: "shisha" },
        { seat: 5, role: "DPS", gc1Role: "shisen", gc2Role: "rai", gc3Role: "shi", gc3Scar: "shisha" },
        { seat: 6, role: "DPS", gc1Role: "mizu", gc2Role: "shisen", gc3Role: "shi", gc3Scar: "shisha" },
        { seat: 7, role: "DPS", gc1Role: "rai", gc2Role: "mushoku", gc3Role: "shi", gc3Scar: "shisha" },
      ],
    };
    const rows1 = buildRevealSchedule(setupMushokuGC1);
    const by1 = Object.fromEntries(rows1.map((r) => [r.key, r]));
    expect(by1.gc1.resolveSec).toBe(74); // mushoku at GC1 → late

    // seat 0 with mushoku at GC2
    const setupMushokuGC2: SimSetup = {
      ...setupMushokuGC1,
      players: [
        { seat: 0, role: "TH", gc1Role: "mizu", gc2Role: "mushoku", gc3Role: "aragan", gc3Scar: "seija" },
        { seat: 1, role: "TH", gc1Role: "rai", gc2Role: "shisen", gc3Role: "aragan", gc3Scar: "seija" },
        { seat: 2, role: "TH", gc1Role: "shisen", gc2Role: "mizu", gc3Role: "aragan", gc3Scar: "seija" },
        { seat: 3, role: "TH", gc1Role: "mushoku", gc2Role: "rai", gc3Role: "aragan", gc3Scar: "seija" },
        { seat: 4, role: "DPS", gc1Role: "mizu", gc2Role: "mushoku", gc3Role: "shi", gc3Scar: "shisha" },
        { seat: 5, role: "DPS", gc1Role: "rai", gc2Role: "shisen", gc3Role: "shi", gc3Scar: "shisha" },
        { seat: 6, role: "DPS", gc1Role: "shisen", gc2Role: "mizu", gc3Role: "shi", gc3Scar: "shisha" },
        { seat: 7, role: "DPS", gc1Role: "mushoku", gc2Role: "rai", gc3Role: "shi", gc3Scar: "shisha" },
      ],
    };
    const rows2 = buildRevealSchedule(setupMushokuGC2);
    const by2 = Object.fromEntries(rows2.map((r) => [r.key, r]));
    expect(by2.gc2.resolveSec).toBe(51); // mushoku at GC2 → early
  });
});
