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
  MECHANIC_SEC,
  WAVE_DETONATE_DELAY,
  mechanicPlaceSec,
  mechanicResolveSec,
  END_SEC,
  NORTH_ANGLE,
  exdeathNorthRotation,
  rotateAround,
  exdeathZones,
  inZoneAt,
  ZONE_RADIUS,
  roleCardinal,
  roleCardinalPoint,
  evaluateRoleWater,
  type Point,
  type RequiredAction,
} from "@/p4/arena";
import { generateSim, toMinState, type SimSetup } from "@/p4/simulation";

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

  it("gc3 split truth(gi) flips the required color vs shin (every role×scar)", () => {
    // 参照 checkWave3SplitSafety: wave3BossB.currentEffect が うそ なら
    // アラガン/超越の解釈が反転 → 立つべき色も反転する。
    const seatOf = (role: "aragan" | "shi", scar: "seija" | "shisha") =>
      setup.players.find((p) => p.gc3Role === role && p.gc3Scar === scar)?.seat;
    for (const role of ["aragan", "shi"] as const) {
      for (const scar of ["seija", "shisha"] as const) {
        const seat = seatOf(role, scar);
        if (seat === undefined) continue;
        const shinReq = requiredAction(
          { ...setup, gc3SplitTruth: "shin" },
          seat,
          "gc3",
        );
        const giReq = requiredAction(
          { ...setup, gc3SplitTruth: "gi" },
          seat,
          "gc3",
        );
        // 真偽の反転で要求色が必ず入れ替わる（PINK↔BLUE）。
        expect(shinReq.color).not.toBe(giReq.color);
        expect(giReq.color).toBe(gc3RequiredColor(role, scar, false));
        expect(shinReq.color).toBe(gc3RequiredColor(role, scar, true));
      }
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

  it("加速度系(視線/無職)の席は必ず env(早/遅)で加速弾(止/動)を解決する", () => {
    // 参照 SET2 = BOMB(+EYE)。視線でも無職でも加速弾は env チェックで解決する。
    // 加速弾は env スロットで解決するが、その形は2通り:
    //  (a) 水雷と衝突しない → standalone な stop/move kind。
    //  (b) 水雷と同じ env スロットに衝突 → 水雷の位置要求(stack/spread/filler)に
    //      乗る move フィールド（位置と移動を合体）。
    // どちらか「ちょうど一方」で、env スロットで爆弾が解決していることを保証する。
    for (let seat = 0; seat < 8; seat++) {
      const p = setup.players.find((pl) => pl.seat === seat)!;
      const isAccel = (r: string) => r === "shisen" || r === "mushoku";
      if (!isAccel(p.gc1Role) && !isAccel(p.gc2Role)) continue;
      const early = requiredAction(setup, seat, "early");
      const late = requiredAction(setup, seat, "late");
      const bombResolved = (r: ReturnType<typeof requiredAction>) =>
        r.kind === "stop" || r.kind === "move" || r.move !== undefined;
      const bombAt = [early, late].filter(bombResolved);
      // 加速度系の席はちょうど1つの env スロットで爆弾を解決する（standalone か合体のいずれか）。
      expect(bombAt.length).toBe(1);
      // その解決は standalone な stop/move か、合体の move フィールドの「どちらか一方」。
      const r = bombAt[0];
      const standalone = r.kind === "stop" || r.kind === "move";
      const merged = r.move !== undefined;
      expect(standalone !== merged).toBe(true); // XOR
    }
  });

  it("視線(shisen)の席は爆弾(env)と魔眼(juso)の両方を解決する — 視線だけにならない", () => {
    // 参照: 視線プレイヤーのバグ「視線だけついて加速度がつかない」の回帰防止。
    for (let seat = 0; seat < 8; seat++) {
      const p = setup.players.find((pl) => pl.seat === seat)!;
      const hasShisen = p.gc1Role === "shisen" || p.gc2Role === "shisen";
      if (!hasShisen) continue;
      const envBomb = ["early", "late"].some((k) => {
        const r = requiredAction(setup, seat, k as "early" | "late");
        // 爆弾は standalone(stop/move) か、水雷と合体した move フィールドのいずれかで解決。
        return r.kind === "stop" || r.kind === "move" || r.move !== undefined;
      });
      const jusoEye = ["juso1", "juso2"].some((k) => {
        const r = requiredAction(setup, seat, k as "juso1" | "juso2");
        return r.kind === "look" || r.kind === "hide";
      });
      expect(envBomb).toBe(true);
      expect(jusoEye).toBe(true);
    }
  });

  it("水雷と加速弾が同 env スロットに衝突したら位置(stack/spread/filler)+move を合体する", () => {
    // 衝突時: その env キーの要求は 位置 kind と move の両方を持ち、ラベルは「位置・止/動」。
    let sawMerge = false;
    for (let seat = 0; seat < 8; seat++) {
      for (const k of ["early", "late"] as const) {
        const r = requiredAction(setup, seat, k);
        if (r.move === undefined) continue;
        sawMerge = true;
        // 合体は必ず位置 kind（stack/spread/filler）に乗る。
        expect(["stack", "spread", "filler"]).toContain(r.kind);
        // move は止(stop)/動(move)。
        expect(["stop", "move"]).toContain(r.move);
        // ラベルは「位置・止/動」の合体表記（カンペ buildTimeline と一致）。
        const moveLabel = r.move === "stop" ? "止まる" : "動く";
        expect(r.label.endsWith(`・${moveLabel}`)).toBe(true);
      }
    }
    // この seed では水雷×加速弾の衝突が少なくとも1席で起きる。
    expect(sawMerge).toBe(true);
  });

  it("合体要求は位置 or 移動のどちらかが誤れば evaluate で不合格", () => {
    // 合体要求（位置 stack/spread/filler + move）を構成し、4象限で確認する。
    // stack + stop: 正しい位置(h12) かつ 停止 のみ合格。
    const stackStop = { kind: "stack" as const, label: "頭割り・止まる", move: "stop" as const };
    const dir: Point = { x: 0, y: -1 };
    // 位置○ 移動○（停止）→ 合格。
    expect(evaluate(stackStop, ZONES.h12, dir, false).ok).toBe(true);
    // 位置○ 移動×（移動中）→ 不合格（move 違反）。
    const r1 = evaluate(stackStop, ZONES.h12, dir, true);
    expect(r1.ok).toBe(false);
    expect(r1.reason).toContain("止まっていない");
    // 位置× 移動○（停止）→ 不合格（位置違反）。
    expect(evaluate(stackStop, ZONES.h3, dir, false).ok).toBe(false);
    // 位置× 移動×（移動中）→ 不合格。
    expect(evaluate(stackStop, ZONES.h3, dir, true).ok).toBe(false);

    // spread + move: 正しい位置(h3) かつ 移動中 のみ合格。
    const spreadMove = { kind: "spread" as const, label: "散開・動く", move: "move" as const };
    expect(evaluate(spreadMove, ZONES.h3, dir, true).ok).toBe(true);
    const r2 = evaluate(spreadMove, ZONES.h3, dir, false);
    expect(r2.ok).toBe(false);
    expect(r2.reason).toContain("動いていない");
    expect(evaluate(spreadMove, ZONES.h12, dir, true).ok).toBe(false);
  });

  it("env 爆弾解決スロットは buildTimeline の accelWhen 法則に一致する（視線/無職×GC）", () => {
    // accelWhen: accelGC=1 → 視線=早/無職=遅, accelGC=2 → 視線=遅/無職=早。
    // accelGC = 水雷GC の逆。env 爆弾は早=early/遅=late で解決する。
    for (let seat = 0; seat < 8; seat++) {
      const ms = toMinState(setup, seat);
      const accelGc = ms.waterGC === "1" ? "2" : "1";
      const accelIsShisen = ms.shisen === "yes";
      const accelEarly =
        accelGc === "1" ? accelIsShisen : !accelIsShisen;
      const expectedSlot: "early" | "late" = accelEarly ? "early" : "late";
      // expectedSlot で爆弾が解決している（standalone か move 合体のいずれか）。
      const r = requiredAction(setup, seat, expectedSlot);
      const resolvedHere =
        r.kind === "stop" || r.kind === "move" || r.move !== undefined;
      expect(resolvedHere).toBe(true);
      // 逆スロットでは爆弾は解決しない（その席の env 位置はあるが move/stop/move フィールドは無い）。
      const other: "early" | "late" = expectedSlot === "early" ? "late" : "early";
      const ro = requiredAction(setup, seat, other);
      const resolvedThere =
        ro.kind === "stop" || ro.kind === "move" || ro.move !== undefined;
      expect(resolvedThere).toBe(false);
    }
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

describe("つなみ/ほのお 設置→起爆タイミング（参照 processDebuffTrigger +3000ms）", () => {
  it("起爆遅延は 3 秒", () => {
    expect(WAVE_DETONATE_DELAY).toBe(3);
  });

  it("設置秒はデバフ満了秒（ほのお=62 / つなみ=84）", () => {
    expect(mechanicPlaceSec("honoo")).toBe(62);
    expect(mechanicPlaceSec("tsunami")).toBe(84);
    expect(mechanicPlaceSec("honoo")).toBe(MECHANIC_SEC.honoo);
    expect(mechanicPlaceSec("tsunami")).toBe(MECHANIC_SEC.tsunami);
  });

  it("死亡判定秒は 設置+3（ほのお=65 / つなみ=87）", () => {
    expect(mechanicResolveSec("honoo")).toBe(65);
    expect(mechanicResolveSec("tsunami")).toBe(87);
    expect(mechanicResolveSec("honoo")).toBe(MECHANIC_SEC.honoo + WAVE_DETONATE_DELAY);
    expect(mechanicResolveSec("tsunami")).toBe(MECHANIC_SEC.tsunami + WAVE_DETONATE_DELAY);
  });

  it("波以外の機構は 設置=判定（即時、遅延なし）", () => {
    for (const k of ["gc3", "early", "juso1", "late", "juso2"] as const) {
      expect(mechanicPlaceSec(k)).toBe(MECHANIC_SEC[k]);
      expect(mechanicResolveSec(k)).toBe(MECHANIC_SEC[k]);
    }
  });
});

describe("END_SEC（タイムライン終了クロック凍結）", () => {
  it("END_SEC は最終記憶解決(≈87s)より後の 90s", () => {
    expect(END_SEC).toBe(90);
    expect(END_SEC).toBeGreaterThan(mechanicResolveSec("tsunami")); // 87
    expect(END_SEC).toBeGreaterThan(MECHANIC_SEC.tsunami);
  });
});

describe("エクスデス北フレーム（1回目 水雷処理の回転ゾーン）", () => {
  it("NORTH_ANGLE は h12 方向（-PI/2）", () => {
    expect(NORTH_ANGLE).toBeCloseTo(-Math.PI / 2, 9);
  });

  it("回転量はエクスデス方向 − 標準北", () => {
    for (let a = 0; a < 8; a++) {
      const exdeathAngle = (a * Math.PI) / 4;
      expect(exdeathNorthRotation(a)).toBeCloseTo(exdeathAngle - NORTH_ANGLE, 9);
    }
  });

  it("回転後の h12（北）はエクスデス方向に一致する", () => {
    for (let a = 0; a < 8; a++) {
      const zones = exdeathZones(a);
      const boss = gc3BossPos(a);
      // h12 方向角（CENTER から）= エクスデス方向角（CENTER から）。
      const zoneAngle = Math.atan2(zones.h12.y - CENTER.y, zones.h12.x - CENTER.x);
      const bossAngle = Math.atan2(boss.y - CENTER.y, boss.x - CENTER.x);
      const norm = (t: number) => Math.atan2(Math.sin(t), Math.cos(t));
      expect(norm(zoneAngle - bossAngle)).toBeCloseTo(0, 6);
    }
  });

  it("回転後のゾーンは CENTER から 180 の距離を保つ（合同変換）", () => {
    const zones = exdeathZones(3);
    for (const z of [zones.h12, zones.h3, zones.h6, zones.h9]) {
      expect(Math.hypot(z.x - CENTER.x, z.y - CENTER.y)).toBeCloseTo(180, 6);
    }
  });

  it("rotateAround(angle=0) は恒等", () => {
    const p: Point = { x: 123, y: 456 };
    const r = rotateAround(p, 0);
    expect(r.x).toBeCloseTo(p.x, 9);
    expect(r.y).toBeCloseTo(p.y, 9);
  });

  it("angle=0（エクスデス東）: 北は東(h3 標準位置)へ回り、散開ゾーンは縦(h12/h6)へ移る", () => {
    // gc3BossAngle=0 → exdeathAngle=0(東)。回転量 = 0 - (-PI/2) = +PI/2。
    // h12(北)→東、h3(東)→南、h6(南)→西、h9(西)→北。
    const zones = exdeathZones(0);
    // 散開(spread)= 回転後 h3/h9。回転後 h3 は標準 h6 位置、h9 は標準 h12 位置（縦）。
    expect(zones.h3.x).toBeCloseTo(ZONES.h6.x, 5);
    expect(zones.h3.y).toBeCloseTo(ZONES.h6.y, 5);
    expect(zones.h9.x).toBeCloseTo(ZONES.h12.x, 5);
    expect(zones.h9.y).toBeCloseTo(ZONES.h12.y, 5);
  });

  it("evaluate(spread, zones=exdeathZones): 回転後の散開ゾーンで合否が決まる", () => {
    const req = { kind: "spread", label: "散開" } as const;
    const zones = exdeathZones(0); // 散開は縦(標準 h12/h6 位置)に回る。
    const dir: Point = { x: 0, y: -1 };
    // 回転後 h9（= 標準 h12 位置）に立てば spread OK。
    const okP = ZONES.h12;
    expect(evaluate(req, okP, dir, false, undefined, undefined, zones).ok).toBe(true);
    // 標準 h3（東）は回転後の散開ゾーンではない → NG。
    const ngP = ZONES.h3;
    expect(evaluate(req, ngP, dir, false, undefined, undefined, zones).ok).toBe(false);
    // 固定ゾーン（2回目相当）なら標準 h3 で OK。
    expect(evaluate(req, ngP, dir, false).ok).toBe(true);
  });

  it("inZoneAt は中心一致で真、ZONE_RADIUS 超で偽", () => {
    const c: Point = { x: 200, y: 200 };
    expect(inZoneAt(c, c)).toBe(true);
    expect(inZoneAt({ x: c.x + ZONE_RADIUS - 1, y: c.y }, c)).toBe(true);
    expect(inZoneAt({ x: c.x + ZONE_RADIUS + 1, y: c.y }, c)).toBe(false);
  });
});

describe("ロール別 水雷/フィラー カーディナル", () => {
  it("roleCardinal: TH stack→h12 / TH spread→h9 / DPS stack→h6 / DPS spread→h3", () => {
    expect(roleCardinal("TH", true)).toBe("h12");
    expect(roleCardinal("TH", false)).toBe("h9");
    expect(roleCardinal("DPS", true)).toBe("h6");
    expect(roleCardinal("DPS", false)).toBe("h3");
  });

  it("TH: 頭割りは h12 で合格・他で不合格、散開は h9 で合格", () => {
    expect(evaluateRoleWater("TH", true, ZONES.h12).ok).toBe(true);
    expect(evaluateRoleWater("TH", true, ZONES.h6).ok).toBe(false); // 誤カーディナル
    expect(evaluateRoleWater("TH", false, ZONES.h9).ok).toBe(true);
    expect(evaluateRoleWater("TH", false, ZONES.h12).ok).toBe(false);
  });

  it("DPS: 頭割りは h6 で合格、散開は h3 で合格、誤カーディナルは不合格", () => {
    expect(evaluateRoleWater("DPS", true, ZONES.h6).ok).toBe(true);
    expect(evaluateRoleWater("DPS", true, ZONES.h12).ok).toBe(false);
    expect(evaluateRoleWater("DPS", false, ZONES.h3).ok).toBe(true);
    expect(evaluateRoleWater("DPS", false, ZONES.h9).ok).toBe(false);
  });

  it("不合格理由にカーディナル文字+方角が入る", () => {
    expect(evaluateRoleWater("TH", true, ZONES.h6).reason).toContain("A(北)");
    expect(evaluateRoleWater("DPS", false, ZONES.h9).reason).toContain("B(東)");
  });

  it("エクスデス回転: 早(exdeathZones)は gc3BossAngle で回り、遅(ZONES)は固定", () => {
    const angle = 3; // 非ゼロ
    const zones = exdeathZones(angle);
    const role = "TH" as const;
    const isStack = true;
    // 早の正解点 = exdeathZones[roleCardinal]。回転している。
    const earlyPt = roleCardinalPoint(role, isStack, zones);
    expect(earlyPt).toEqual(zones[roleCardinal(role, isStack)]);
    // 遅の正解点 = 固定 ZONES。
    const latePt = roleCardinalPoint(role, isStack);
    expect(latePt).toEqual(ZONES[roleCardinal(role, isStack)]);
    // 回転点で早は合格、遅(固定)は不合格（gc3BossAngle≠0 なのでズレる）。
    expect(evaluateRoleWater(role, isStack, earlyPt, zones).ok).toBe(true);
    expect(evaluateRoleWater(role, isStack, earlyPt).ok).toBe(false);
    // 固定点で遅は合格、早(回転)は不合格。
    expect(evaluateRoleWater(role, isStack, latePt).ok).toBe(true);
    expect(evaluateRoleWater(role, isStack, latePt, zones).ok).toBe(false);
  });
});

describe("evaluate(role): ロール別水雷判定（PlayArena 採点パス回帰）", () => {
  // ロールを渡さない旧来の寛容判定（互換）。
  it("ロール未指定: 頭割りは h12/h6 どちらでも合格（旧来のロール非依存）", () => {
    const stack: RequiredAction = { kind: "stack", label: "頭割り" };
    expect(evaluate(stack, ZONES.h12, { x: 0, y: -1 }, false).ok).toBe(true);
    expect(evaluate(stack, ZONES.h6, { x: 0, y: -1 }, false).ok).toBe(true);
  });

  // ロール指定: TH/DPS で立つ場所が必ず分かれる（本バグの修正点）。
  it("TH: 頭割りは A(h12) のみ合格・DPS の C(h6) では不合格", () => {
    const stack: RequiredAction = { kind: "stack", label: "頭割り" };
    expect(evaluate(stack, ZONES.h12, { x: 0, y: -1 }, false, undefined, undefined, ZONES, "TH").ok).toBe(true);
    expect(evaluate(stack, ZONES.h6, { x: 0, y: -1 }, false, undefined, undefined, ZONES, "TH").ok).toBe(false);
  });

  it("DPS: 頭割りは C(h6) のみ合格・TH の A(h12) では不合格（=報告バグ）", () => {
    const stack: RequiredAction = { kind: "stack", label: "頭割り" };
    // 報告バグの再現と封じ込め: DPS が TH 水雷位置(h12)に立っても合格しない。
    expect(evaluate(stack, ZONES.h12, { x: 0, y: -1 }, false, undefined, undefined, ZONES, "DPS").ok).toBe(false);
    expect(evaluate(stack, ZONES.h6, { x: 0, y: -1 }, false, undefined, undefined, ZONES, "DPS").ok).toBe(true);
  });

  it("filler(頭割り集合) もロール別に分かれる", () => {
    const filler: RequiredAction = { kind: "filler", label: "頭割り（集合）" };
    expect(evaluate(filler, ZONES.h6, { x: 0, y: -1 }, false, undefined, undefined, ZONES, "DPS").ok).toBe(true);
    expect(evaluate(filler, ZONES.h12, { x: 0, y: -1 }, false, undefined, undefined, ZONES, "DPS").ok).toBe(false);
  });

  it("spread もロール別: TH=D(h9) / DPS=B(h3)", () => {
    const spread: RequiredAction = { kind: "spread", label: "散開" };
    expect(evaluate(spread, ZONES.h9, { x: 0, y: -1 }, false, undefined, undefined, ZONES, "TH").ok).toBe(true);
    expect(evaluate(spread, ZONES.h3, { x: 0, y: -1 }, false, undefined, undefined, ZONES, "TH").ok).toBe(false);
    expect(evaluate(spread, ZONES.h3, { x: 0, y: -1 }, false, undefined, undefined, ZONES, "DPS").ok).toBe(true);
    expect(evaluate(spread, ZONES.h9, { x: 0, y: -1 }, false, undefined, undefined, ZONES, "DPS").ok).toBe(false);
  });

  it("ロール別 + 加速弾合体(req.move): 位置が正しくても止/動が誤りなら不合格", () => {
    const stackMove: RequiredAction = { kind: "stack", label: "頭割り・止まる", move: "stop" };
    // DPS が C(h6) に正しく立っていても、移動中(moving=true)なら停止要求に不合格。
    expect(evaluate(stackMove, ZONES.h6, { x: 0, y: -1 }, true, undefined, undefined, ZONES, "DPS").ok).toBe(false);
    expect(evaluate(stackMove, ZONES.h6, { x: 0, y: -1 }, false, undefined, undefined, ZONES, "DPS").ok).toBe(true);
  });

  // PlayArena の採点パスを忠実に再現: requiredAction → evaluate(zones, role)。
  // TH(席0) / DPS(席4) × 早(exdeathZones)/遅(ZONES) で、自ロール正解は合格・他ロールは不合格。
  it("PlayArena 採点パス: 席0=TH / 席4=DPS が自ロール正解のみ合格（早/遅とも）", () => {
    const stillDir = { x: 0, y: -1 };
    for (let s = 0; s < 30; s++) {
      const setup = generateSim(mulberry32(s + 1));
      for (const seat of [0, 4] as const) {
        const myRole = setup.players.find((p) => p.seat === seat)!.role;
        const otherRole = myRole === "TH" ? "DPS" : "TH";
        for (const key of ["early", "late"] as const) {
          const req = requiredAction(setup, seat, key);
          if (req.kind !== "stack" && req.kind !== "filler" && req.kind !== "spread") continue;
          const isStack = req.kind !== "spread";
          const zones = key === "early" ? exdeathZones(setup.gc3BossAngle) : ZONES;
          const myPt = roleCardinalPoint(myRole, isStack, zones);
          const otherPt = roleCardinalPoint(otherRole, isStack, zones);
          // 加速弾が合体しているなら移動要求を満たす moving を選ぶ（"move"→true / "stop"→false）。
          const moving = req.move === "move";
          // 自ロール正解カーディナル + 正しい移動状態では合格。
          expect(evaluate(req, myPt, stillDir, moving, undefined, undefined, zones, myRole).ok).toBe(true);
          // 他ロールのカーディナルでは不合格（DPS が TH 水雷位置に立っても通らない）。
          expect(evaluate(req, otherPt, stillDir, moving, undefined, undefined, zones, myRole).ok).toBe(false);
        }
      }
    }
  });
});
