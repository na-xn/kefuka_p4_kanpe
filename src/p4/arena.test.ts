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
  inThunderStrip,
  inBlizzardQuadrant,
  centerAoeSafe,
  centerAoeSafeGeometry,
  THUNDER_STRIP_W,
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

describe("center AoE geometry (サンダガ/ブリザガ)", () => {
  // THUNDER_STRIP_W = 175; concrete points below are derived from rotX/rotY math.
  expect(THUNDER_STRIP_W).toBe(175);

  it("inThunderStrip per pattern matches reference rotX/rotY cases", () => {
    // pattern 0: rotX in [-W,0) or [W,2W]. rotX=(px-py)/√2.
    // px=300,py=0 -> rotX≈212 in [175,350] -> in strip.
    expect(inThunderStrip({ x: 700, y: 400 }, 0)).toBe(true);
    // center -> rotX=0 -> not in (0 excluded from [-W,0)).
    expect(inThunderStrip({ x: 400, y: 400 }, 0)).toBe(false);
    // pattern 1: rotX in [-2W,-W) or [0,W). px=70,py=0 -> rotX≈49 in [0,175).
    expect(inThunderStrip({ x: 470, y: 400 }, 1)).toBe(true);
    // pattern 2: rotY in [-W,0) or [W,2W]. rotY=(px+py)/√2.
    // px=0,py=300 -> rotY≈212 in [175,350].
    expect(inThunderStrip({ x: 400, y: 700 }, 2)).toBe(true);
    // pattern 3: rotY in [-2W,-W) or [0,W). px=0,py=70 -> rotY≈49 in [0,175).
    expect(inThunderStrip({ x: 400, y: 470 }, 3)).toBe(true);
    // sanity: invalid pattern -> false.
    expect(inThunderStrip({ x: 700, y: 400 }, 9)).toBe(false);
  });

  it("inBlizzardQuadrant per pattern", () => {
    // pattern 0: (px>=0&&py<=0)||(px<=0&&py>=0) -> NE & SW quadrants.
    expect(inBlizzardQuadrant({ x: 500, y: 300 }, 0)).toBe(true); // px>0,py<0
    expect(inBlizzardQuadrant({ x: 300, y: 500 }, 0)).toBe(true); // px<0,py>0
    expect(inBlizzardQuadrant({ x: 500, y: 500 }, 0)).toBe(false); // px>0,py>0
    // pattern 1: the other two quadrants.
    expect(inBlizzardQuadrant({ x: 500, y: 500 }, 1)).toBe(true); // SE
    expect(inBlizzardQuadrant({ x: 300, y: 300 }, 1)).toBe(true); // NW
    expect(inBlizzardQuadrant({ x: 500, y: 300 }, 1)).toBe(false);
  });

  it("centerAoeSafe truth: must avoid the shown faces", () => {
    // A point in BOTH thunder(pat0) and blizzard(pat0).
    // (500,300): blizzard pat0 true; thunder pat0: px=100,py=-100 -> rotX=200/√2≈141 -> not [175,350], rotX>=0 not in [-W,0)->false.
    // Pick a point clearly in thunder pat0 and clearly out of blizzard pat0:
    const inThunderOnly: Point = { x: 700, y: 400 }; // thunder pat0 true, blizzard pat0: px=300,py=0 -> py<=0&px>=0 -> true actually
    // recompute: (700,400): px=300,py=0. blizzard pat0 (px>=0&&py<=0) true.
    expect(inThunderStrip(inThunderOnly, 0)).toBe(true);
    expect(inBlizzardQuadrant(inThunderOnly, 0)).toBe(true);
    // shin/shin: shown faces fire -> this point is hit (in both) -> unsafe.
    expect(
      centerAoeSafe(inThunderOnly, {
        thunderPattern: 0,
        blizzardPattern: 0,
        sandagaShin: true,
        blizzagaShin: true,
      }),
    ).toBe(false);

    // A point OUT of both shown faces is safe under shin/shin.
    // center (400,400): thunder pat0 false, blizzard pat0: px=0,py=0 -> (0>=0&&0<=0) true. not safe.
    // Use (350,450): px=-50,py=50. blizzard pat0: (px<=0&&py>=0) true. hmm.
    // Find point out of blizzard pat0: need NOT(px>=0&py<=0) and NOT(px<=0&py>=0) -> px,py same sign nonzero.
    // (500,500): px=100,py=100. blizzard pat0 false. thunder pat0: rotX=0 -> false. -> out of both.
    const outBoth: Point = { x: 500, y: 500 };
    expect(inThunderStrip(outBoth, 0)).toBe(false);
    expect(inBlizzardQuadrant(outBoth, 0)).toBe(false);
    expect(
      centerAoeSafe(outBoth, {
        thunderPattern: 0,
        blizzardPattern: 0,
        sandagaShin: true,
        blizzagaShin: true,
      }),
    ).toBe(true);
  });

  it("centerAoeSafe fake: must avoid the complement", () => {
    // outBoth (500,500): out of both shown faces.
    // gi/gi (fake): the OTHER face fires -> the complement is hit -> being OUT means hit -> unsafe.
    const outBoth: Point = { x: 500, y: 500 };
    expect(
      centerAoeSafe(outBoth, {
        thunderPattern: 0,
        blizzardPattern: 0,
        sandagaShin: false,
        blizzagaShin: false,
      }),
    ).toBe(false);
    // A point inside both shown faces is SAFE under gi/gi.
    const inBoth: Point = { x: 700, y: 400 };
    expect(inThunderStrip(inBoth, 0)).toBe(true);
    expect(inBlizzardQuadrant(inBoth, 0)).toBe(true);
    expect(
      centerAoeSafe(inBoth, {
        thunderPattern: 0,
        blizzardPattern: 0,
        sandagaShin: false,
        blizzagaShin: false,
      }),
    ).toBe(true);
  });

  it("centerAoeSafeGeometry thunder: 雷十字のみ判定（象限は無視）", () => {
    // 雷十字内 / shin → 被弾（unsafe）。象限は無視されるので blizzard 設定は影響しない。
    const inThunder: Point = { x: 700, y: 400 };
    expect(inThunderStrip(inThunder, 0)).toBe(true);
    const params = {
      thunderPattern: 0,
      blizzardPattern: 0,
      sandagaShin: true,
      blizzagaShin: true, // この面が誤って効くなら結果が変わる。
    };
    expect(centerAoeSafeGeometry(inThunder, params, "thunder")).toBe(false);
    // 雷十字外 / shin → 安全（象限内でも thunder 判定では無視）。
    const inBlizzOnly: Point = { x: 500, y: 300 }; // px>0, py<0 → 象限0内、雷十字外
    expect(inThunderStrip(inBlizzOnly, 0)).toBe(false);
    expect(centerAoeSafeGeometry(inBlizzOnly, params, "thunder")).toBe(true);
  });

  it("centerAoeSafeGeometry blizzard: 象限のみ判定（雷十字は無視）", () => {
    const inBlizz: Point = { x: 500, y: 300 }; // 象限0内
    expect(inBlizzardQuadrant(inBlizz, 0)).toBe(true);
    const params = {
      thunderPattern: 0,
      blizzardPattern: 0,
      sandagaShin: true, // 無視される。
      blizzagaShin: true,
    };
    expect(centerAoeSafeGeometry(inBlizz, params, "blizzard")).toBe(false);
    // 象限外 → 安全。
    const outBlizz: Point = { x: 500, y: 500 }; // 象限1側
    expect(inBlizzardQuadrant(outBlizz, 0)).toBe(false);
    expect(centerAoeSafeGeometry(outBlizz, params, "blizzard")).toBe(true);
  });

  it("centerAoeSafeGeometry cross は centerAoeSafe と一致", () => {
    const p: Point = { x: 700, y: 400 };
    const params = {
      thunderPattern: 0,
      blizzardPattern: 0,
      sandagaShin: true,
      blizzagaShin: false,
    };
    expect(centerAoeSafeGeometry(p, params, "cross")).toBe(centerAoeSafe(p, params));
  });
});
