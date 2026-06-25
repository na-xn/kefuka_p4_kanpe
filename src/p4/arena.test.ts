import { describe, it, expect } from "vitest";
import {
  CENTER,
  ZONES,
  clampToArena,
  inZone,
  inStackZone,
  inSpreadZone,
  isFacingCenter,
  aoeShape,
  isAoeSafe,
  gc3BossPos,
  splitColorAt,
  gc3RequiredColor,
  requiredAction,
  evaluate,
  ARENA_RADIUS,
  PLAYER_RADIUS,
  type Point,
} from "@/p4/arena";
import { generateSim, type SimSetup } from "@/p4/simulation";

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

describe("arena geometry", () => {
  it("inZone hits the zone center and misses far points", () => {
    expect(inZone(ZONES.h12, "h12")).toBe(true);
    expect(inZone({ x: ZONES.h12.x + 100, y: ZONES.h12.y }, "h12")).toBe(true); // <120
    expect(inZone({ x: ZONES.h12.x + 130, y: ZONES.h12.y }, "h12")).toBe(false); // >120
    expect(inZone(ZONES.h3, "h12")).toBe(false);
  });

  it("clampToArena keeps inside points, snaps outside ones", () => {
    const inside: Point = { x: 400, y: 400 };
    expect(clampToArena(inside)).toEqual(inside);
    const out: Point = { x: 400, y: 800 };
    const c = clampToArena(out);
    const d = Math.hypot(c.x - CENTER.x, c.y - CENTER.y);
    expect(d).toBeCloseTo(ARENA_RADIUS - PLAYER_RADIUS, 5);
  });

  it("stack zone requires h12/h6 and not h3/h9; spread requires h3/h9", () => {
    expect(inStackZone(ZONES.h12)).toBe(true);
    expect(inStackZone(ZONES.h6)).toBe(true);
    expect(inStackZone(ZONES.h3)).toBe(false);
    expect(inSpreadZone(ZONES.h3)).toBe(true);
    expect(inSpreadZone(ZONES.h9)).toBe(true);
    expect(inSpreadZone(ZONES.h12)).toBe(false);
  });
});

describe("facing", () => {
  it("dot(dir, center-p) sign decides facing", () => {
    // player below center, moving up (toward center) → facing
    const p: Point = { x: 400, y: 600 };
    expect(isFacingCenter(p, { x: 0, y: -1 })).toBe(true);
    expect(isFacingCenter(p, { x: 0, y: 1 })).toBe(false);
  });
});

describe("aoe shapes", () => {
  it("FLAME+ほんと=CIRCLE, FLAME+うそ=DONUT, FLOOD+ほんと=DONUT, FLOOD+うそ=CIRCLE", () => {
    expect(aoeShape("honoo", true)).toBe("CIRCLE");
    expect(aoeShape("honoo", false)).toBe("DONUT");
    expect(aoeShape("tsunami", true)).toBe("DONUT");
    expect(aoeShape("tsunami", false)).toBe("CIRCLE");
  });

  it("CIRCLE safe outside r=120, DONUT safe inside 80 or outside 220", () => {
    const o: Point = { x: 400, y: 400 };
    expect(isAoeSafe({ x: 400, y: 400 }, o, "CIRCLE")).toBe(false); // d=0 inside
    expect(isAoeSafe({ x: 400 + 130, y: 400 }, o, "CIRCLE")).toBe(true); // d=130 outside
    expect(isAoeSafe({ x: 400 + 50, y: 400 }, o, "DONUT")).toBe(true); // d=50 < 80
    expect(isAoeSafe({ x: 400 + 150, y: 400 }, o, "DONUT")).toBe(false); // 80<150<220
    expect(isAoeSafe({ x: 400 + 250, y: 400 }, o, "DONUT")).toBe(true); // d=250 > 220
  });
});

describe("gc3 split", () => {
  it("boss at angle 0 is to the right (3 o'clock)", () => {
    const b = gc3BossPos(0);
    expect(b.x).toBeGreaterThan(CENTER.x);
    expect(Math.round(b.y)).toBe(CENTER.y);
  });

  it("splitColorAt is consistent: points on opposite perpendicular sides differ", () => {
    const boss = gc3BossPos(0); // boss on +x axis, split line is the x-axis (boss→center)
    // boss→center points in -x. perpendicular separates +y vs -y.
    const above = splitColorAt({ x: 400, y: 300 }, boss);
    const below = splitColorAt({ x: 400, y: 500 }, boss);
    expect(above).not.toBe(below);
  });

  it("gc3RequiredColor: aragan=opposite scar color, shi=same; truth flips", () => {
    // shisha=BLUE scar. aragan(opposite)+ほんと → PINK
    expect(gc3RequiredColor("aragan", "shisha", true)).toBe("PINK");
    // shi(same)+ほんと → BLUE
    expect(gc3RequiredColor("shi", "shisha", true)).toBe("BLUE");
    // seija=PINK scar. aragan opposite → BLUE
    expect(gc3RequiredColor("aragan", "seija", true)).toBe("BLUE");
    expect(gc3RequiredColor("shi", "seija", true)).toBe("PINK");
    // うそ flips aragan/shi interpretation
    expect(gc3RequiredColor("aragan", "shisha", false)).toBe("BLUE");
    expect(gc3RequiredColor("shi", "shisha", false)).toBe("PINK");
  });
});

describe("requiredAction mapping", () => {
  const setup: SimSetup = generateSim(mulberry32(12345));

  it("gc3 returns a color and seishi label for every seat", () => {
    for (let seat = 0; seat < 8; seat++) {
      const r = requiredAction(setup, seat, "gc3");
      expect(r.kind).toBe("gc3");
      expect(["PINK", "BLUE"]).toContain(r.color);
      expect(r.label.length).toBeGreaterThan(0);
    }
  });

  it("each seat has exactly one water mechanic at early or late, with stack/spread kind", () => {
    for (let seat = 0; seat < 8; seat++) {
      const early = requiredAction(setup, seat, "early");
      const late = requiredAction(setup, seat, "late");
      // the water seat resolves at exactly one of early/late with stack|spread.
      const waterAt = [early, late].filter((r) => r.kind === "stack" || r.kind === "spread");
      expect(waterAt.length).toBe(1);
    }
  });

  it("honoo/tsunami always produce an aoe action with a shape", () => {
    for (let seat = 0; seat < 8; seat++) {
      const h = requiredAction(setup, seat, "honoo");
      const t = requiredAction(setup, seat, "tsunami");
      expect(h.kind).toBe("aoe");
      expect(["CIRCLE", "DONUT"]).toContain(h.shape);
      expect(t.kind).toBe("aoe");
      expect(["CIRCLE", "DONUT"]).toContain(t.shape);
    }
  });

  it("a shisen seat yields look/hide at a juso slot; a mushoku seat yields move/stop at early/late", () => {
    // find seats by role to assert mapping shape.
    let sawJuso = false;
    let sawBomb = false;
    for (let seat = 0; seat < 8; seat++) {
      for (const k of ["juso1", "juso2"] as const) {
        const r = requiredAction(setup, seat, k);
        if (r.kind === "look" || r.kind === "hide") sawJuso = true;
      }
      for (const k of ["early", "late"] as const) {
        const r = requiredAction(setup, seat, k);
        if (r.kind === "move" || r.kind === "stop") sawBomb = true;
      }
    }
    expect(sawJuso).toBe(true);
    expect(sawBomb).toBe(true);
  });
});

describe("evaluate pass/fail", () => {
  it("stack passes at h12, fails at h3", () => {
    const req = { kind: "stack" as const, label: "頭割り" };
    expect(evaluate(req, ZONES.h12, { x: 0, y: -1 }, false).ok).toBe(true);
    expect(evaluate(req, ZONES.h3, { x: 0, y: -1 }, false).ok).toBe(false);
  });

  it("spread passes at h3, fails at center", () => {
    const req = { kind: "spread" as const, label: "散開" };
    expect(evaluate(req, ZONES.h3, { x: 0, y: -1 }, false).ok).toBe(true);
    expect(evaluate(req, CENTER, { x: 0, y: -1 }, false).ok).toBe(false);
  });

  it("stop fails when moving, move fails when stopped", () => {
    expect(evaluate({ kind: "stop", label: "止まる" }, CENTER, { x: 0, y: -1 }, true).ok).toBe(false);
    expect(evaluate({ kind: "stop", label: "止まる" }, CENTER, { x: 0, y: -1 }, false).ok).toBe(true);
    expect(evaluate({ kind: "move", label: "動く" }, CENTER, { x: 0, y: -1 }, false).ok).toBe(false);
    expect(evaluate({ kind: "move", label: "動く" }, CENTER, { x: 0, y: -1 }, true).ok).toBe(true);
  });

  it("look/hide use facing", () => {
    const p: Point = { x: 400, y: 600 };
    expect(evaluate({ kind: "look", label: "見る" }, p, { x: 0, y: -1 }, false).ok).toBe(true);
    expect(evaluate({ kind: "hide", label: "見ない" }, p, { x: 0, y: -1 }, false).ok).toBe(false);
    expect(evaluate({ kind: "hide", label: "見ない" }, p, { x: 0, y: 1 }, false).ok).toBe(true);
  });

  it("aoe CIRCLE safe outside, gc3 color match", () => {
    const o: Point = { x: 400, y: 400 };
    const aoe = { kind: "aoe" as const, label: "x", shape: "CIRCLE" as const };
    expect(evaluate(aoe, { x: 600, y: 400 }, { x: 0, y: 0 }, false, o).ok).toBe(true);
    expect(evaluate(aoe, { x: 410, y: 400 }, { x: 0, y: 0 }, false, o).ok).toBe(false);

    const boss = gc3BossPos(0);
    const pink = { kind: "gc3" as const, label: "x", color: "PINK" as const };
    const at = splitColorAt({ x: 400, y: 300 }, boss);
    const r = evaluate(pink, { x: 400, y: 300 }, { x: 0, y: 0 }, false, undefined, boss);
    expect(r.ok).toBe(at === "PINK");
  });
});
