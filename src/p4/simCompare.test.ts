import { describe, it, expect } from "vitest";
import { generateSim, toMinState } from "@/p4/simulation";
import { compareMinState } from "@/p4/simCompare";
import type { FieldCompare } from "@/p4/simCompare";

/** 決定的 RNG（線形合同法）。 */
function seeded(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 0x100000000;
  };
}

/** compareMinState が返す 8 キーの集合（thunda/blizza は除外）。 */
const EXPECTED_KEYS = new Set([
  "waterType",
  "waterGC",
  "waterWhen",
  "shisen",
  "gc1",
  "gc2",
  "honoo",
  "tsunami",
]);

describe("compareMinState", () => {
  it("returns 8 results (thunda/blizza excluded)", () => {
    const setup = generateSim(seeded(1));
    const correct = toMinState(setup, 0);
    const results = compareMinState(correct, correct);
    expect(results).toHaveLength(8);
    const keys = new Set(results.map((r) => r.key));
    expect(keys).toEqual(EXPECTED_KEYS);
  });

  it("all-correct input yields ok=true for every field", () => {
    const setup = generateSim(seeded(42));
    const correct = toMinState(setup, 0);
    const results = compareMinState(correct, correct);
    expect(results.every((r) => r.ok)).toBe(true);
  });

  it("flags wrong fields with ok=false and provides correct human labels", () => {
    const setup = generateSim(seeded(7));
    const correct = toMinState(setup, 0);

    // Manually flip waterType and gc1 to produce wrong answers.
    const wrong = {
      ...correct,
      waterType: correct.waterType === "mizu" ? "rai" : "mizu",
      gc1: correct.gc1 === "shin" ? "gi" : "shin",
    };

    const results = compareMinState(wrong, correct);
    const byKey = Object.fromEntries(results.map((r: FieldCompare) => [r.key, r]));

    // waterType: wrong
    expect(byKey.waterType.ok).toBe(false);
    expect(byKey.waterType.correct).toBe(correct.waterType === "mizu" ? "水" : "雷");
    expect(byKey.waterType.your).toBe(wrong.waterType === "mizu" ? "水" : "雷");

    // gc1: wrong
    expect(byKey.gc1.ok).toBe(false);
    expect(byKey.gc1.correct).toBe(correct.gc1 === "shin" ? "ほんと" : "うそ");

    // other fields: still correct
    expect(byKey.waterGC.ok).toBe(true);
    expect(byKey.gc2.ok).toBe(true);
  });

  it("all-wrong input yields ok=false for every field and length still 8", () => {
    const setup = generateSim(seeded(99));
    const correct = toMinState(setup, 0);

    // Invert every field (thunda/blizza excluded from compare, but still in correct).
    const invertMap: Record<string, Record<string, string>> = {
      waterType: { mizu: "rai", rai: "mizu" },
      waterGC: { "1": "2", "2": "1" },
      waterWhen: { haya: "oso", oso: "haya" },
      shisen: { yes: "no", no: "yes" },
      gc1: { shin: "gi", gi: "shin" },
      gc2: { shin: "gi", gi: "shin" },
      honoo: { shin: "gi", gi: "shin" },
      tsunami: { shin: "gi", gi: "shin" },
    };
    const wrong: Record<string, string> = {};
    for (const key of Object.keys(correct)) {
      wrong[key] = (invertMap[key]?.[correct[key]] ?? correct[key]);
    }

    const results = compareMinState(wrong, correct);
    expect(results).toHaveLength(8);
    expect(results.every((r) => !r.ok)).toBe(true);
  });

  it("human-readable labels are correct for known values", () => {
    const setup = generateSim(seeded(5));
    const correct = toMinState(setup, 0);
    const results = compareMinState(correct, correct);
    const byKey = Object.fromEntries(results.map((r: FieldCompare) => [r.key, r]));

    // waterType label
    expect(["水", "雷"]).toContain(byKey.waterType.correct);
    // waterGC label
    expect(["GC1", "GC2"]).toContain(byKey.waterGC.correct);
    // waterWhen label
    expect(["早", "遅"]).toContain(byKey.waterWhen.correct);
    // shisen label
    expect(["視線", "無職"]).toContain(byKey.shisen.correct);
    // truth labels (thunda/blizza no longer compared)
    for (const key of ["gc1", "gc2", "honoo", "tsunami"]) {
      expect(["ほんと", "うそ"]).toContain(byKey[key].correct);
    }
  });

  it("display order matches toMinState key order", () => {
    const setup = generateSim(seeded(13));
    const correct = toMinState(setup, 0);
    const results = compareMinState(correct, correct);
    const keys = results.map((r) => r.key);
    expect(keys).toEqual([
      "waterType",
      "waterGC",
      "waterWhen",
      "shisen",
      "gc1",
      "gc2",
      "honoo",
      "tsunami",
    ]);
  });
});
