import { describe, it, expect } from "vitest";
import {
  CENTER_GC_SEC,
  CENTER_SANDAGA,
  CENTER_BLIZZAGA,
  CENTER_CAST_LEN,
  SPLIT_SEC,
  FINAL_MEMORY_SEC,
  MECHANIC_SEC,
  MECH_ORDER,
  CAST_EVENTS,
  APPLY_SEC,
  activeCenterCast,
  activeOuterCast,
  castProgress,
  centerResolutions,
  centerTruths,
} from "@/p4/playTimeline";
import type { SimSetup } from "@/p4/simulation";

/** テスト用の最小 setup（centerAoE のみ関心）。 */
function setupWith(centerAoE: SimSetup["centerAoE"]): SimSetup {
  return {
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
    centerAoE,
    players: [],
  };
}

const CENTER: SimSetup["centerAoE"] = {
  gc1: { sandagaTruth: "shin", blizzagaTruth: "gi", thunderPattern: 1, blizzardPattern: 0 },
  gc2: { sandagaTruth: "gi", blizzagaTruth: "shin", thunderPattern: 2, blizzardPattern: 1 },
  gc3: { sandagaTruth: "shin", blizzagaTruth: "shin", thunderPattern: 3, blizzardPattern: 0 },
  sandaga: { truth: "gi", thunderPattern: 0 },
  blizzaga: { truth: "shin", blizzardPattern: 1 },
};

describe("playTimeline schedule constants (参照 sim.html 抽出)", () => {
  it("中央グランドクロスは t=4/16/28 に解決", () => {
    expect(CENTER_GC_SEC).toEqual({ gc1: 4, gc2: 16, gc3: 28 });
  });
  it("mid-fight サンダガ 53→57 / ブリザガ 70→74（各 4s）", () => {
    expect(CENTER_SANDAGA).toEqual({ castStart: 53, resolveSec: 57 });
    expect(CENTER_BLIZZAGA).toEqual({ castStart: 70, resolveSec: 74 });
    expect(CENTER_SANDAGA.resolveSec - CENTER_SANDAGA.castStart).toBe(CENTER_CAST_LEN);
    expect(CENTER_BLIZZAGA.resolveSec - CENTER_BLIZZAGA.castStart).toBe(CENTER_CAST_LEN);
  });
  it("エクスデス分断 ≈41 / 最終記憶 87", () => {
    expect(SPLIT_SEC).toBe(41);
    expect(FINAL_MEMORY_SEC).toBe(87);
  });
  it("役割機構の解決秒（gc3=41/early=51/juso1=57/honoo=62/late=74/juso2=79/tsunami=84）", () => {
    expect(MECHANIC_SEC).toEqual({
      gc3: 41,
      early: 51,
      juso1: 57,
      honoo: 62,
      late: 74,
      juso2: 79,
      tsunami: 84,
    });
    expect([...MECH_ORDER]).toEqual([
      "gc3",
      "early",
      "juso1",
      "honoo",
      "late",
      "juso2",
      "tsunami",
    ]);
  });
});

describe("CAST_EVENTS（単一の真実：3ボスのキャスト窓）", () => {
  const byBoss = (b: string) => CAST_EVENTS.filter((e) => e.boss === b);

  it("boss0 中央は サンダガ／ブリザガ を [0–4],[12–16],[24–28] で詠唱", () => {
    const c = byBoss("center");
    expect(c.map((e) => [e.start, e.end])).toEqual([
      [0, 4],
      [12, 16],
      [24, 28],
    ]);
    expect(c.every((e) => e.name === "サンダガ／ブリザガ" && e.kind === "centerGC")).toBe(true);
    expect(c.map((e) => e.instance)).toEqual(["gc1", "gc2", "gc3"]);
  });

  it("boss1 8時 outer は つなみ/ほのお を [4–12],[16–24] で詠唱（←欠落していたキャスト）", () => {
    const w = byBoss("outer8");
    expect(w.map((e) => [e.start, e.end])).toEqual([
      [4, 12],
      [16, 24],
    ]);
    expect(w.every((e) => e.kind === "wave" && e.name === "WAVE")).toBe(true);
    expect(w.map((e) => e.instance)).toEqual(["wave1", "wave2"]);
  });

  it("boss2 4時 outer は グランドクロス を [0–8],[12–20],[24–32] で詠唱", () => {
    const g = byBoss("outer4");
    expect(g.map((e) => [e.start, e.end])).toEqual([
      [0, 8],
      [12, 20],
      [24, 32],
    ]);
    expect(g.every((e) => e.kind === "grandCross" && e.name === "グランドクロス")).toBe(true);
  });

  it("付与時刻 APPLY_SEC は所有 cast の end に一致（役割=8/20/32, 波=12/24）", () => {
    expect(APPLY_SEC).toEqual({ gc1Role: 8, gc2Role: 20, gc3Role: 32, wave1: 12, wave2: 24 });
    // boss2 グランドクロスの end = 役割付与秒。
    const g = byBoss("outer4").map((e) => e.end);
    expect(g).toEqual([APPLY_SEC.gc1Role, APPLY_SEC.gc2Role, APPLY_SEC.gc3Role]);
    // boss1 波の end = 波付与秒。
    const w = byBoss("outer8").map((e) => e.end);
    expect(w).toEqual([APPLY_SEC.wave1, APPLY_SEC.wave2]);
  });
});

describe("activeOuterCast", () => {
  it("8時 outer は [4–12]/[16–24] でアクティブ、窓外は null", () => {
    expect(activeOuterCast("outer8", 4)?.instance).toBe("wave1");
    expect(activeOuterCast("outer8", 8)?.instance).toBe("wave1");
    expect(activeOuterCast("outer8", 20)?.instance).toBe("wave2");
    // 窓間（13.5～16 前）は null。
    expect(activeOuterCast("outer8", 14)).toBeNull();
    // 全 wave 完了後（25.5 以降）は null。
    expect(activeOuterCast("outer8", 30)).toBeNull();
  });
  it("4時 outer は グランドクロス窓でアクティブ", () => {
    expect(activeOuterCast("outer4", 0)?.kind).toBe("grandCross");
    expect(activeOuterCast("outer4", 16)?.instance).toBe("gc2");
    expect(activeOuterCast("outer4", 30)?.instance).toBe("gc3");
  });
  it("8時 outer のキャストは wave kind（属性は描画側で解決）", () => {
    expect(activeOuterCast("outer8", 6)?.kind).toBe("wave");
  });
});

describe("activeCenterCast", () => {
  it("各窓で正しいキャスト（名前・geometry）を返す", () => {
    expect(activeCenterCast(4)?.instance).toBe("gc1");
    // 中央ボスは サンダガ/ブリザガ（magic charge）を詠唱する（グランドクロスではない）。
    expect(activeCenterCast(4)?.name).toBe("サンダガ／ブリザガ");
    expect(activeCenterCast(4)?.name).not.toContain("グランドクロス");
    expect(activeCenterCast(4)?.geometry).toBe("cross");
    expect(activeCenterCast(16)?.instance).toBe("gc2");
    expect(activeCenterCast(28)?.instance).toBe("gc3");

    const sd = activeCenterCast(55);
    expect(sd?.instance).toBe("sandaga");
    expect(sd?.name).toBe("サンダガ");
    expect(sd?.geometry).toBe("thunder");

    const bz = activeCenterCast(72);
    expect(bz?.instance).toBe("blizzaga");
    expect(bz?.name).toBe("ブリザガ");
    expect(bz?.geometry).toBe("blizzard");

    expect(activeCenterCast(85)?.geometry).toBe("cross"); // 最終記憶
  });
  it("キャスト窓の外（待機）では null", () => {
    expect(activeCenterCast(35)).toBeNull(); // GC3(28+1.5) 後 ～ サンダガ(53-4) 前
    expect(activeCenterCast(63)).toBeNull(); // サンダガ後 ～ ブリザガ前
  });
  it("中央キャストはバー名（文字）を必ず持つ", () => {
    for (const t of [3, 4, 16, 28, 54, 71, 85]) {
      const c = activeCenterCast(t);
      if (c) expect(c.name.length).toBeGreaterThan(0);
    }
  });
});

describe("castProgress", () => {
  it("castStart で 0、resolveSec で 1", () => {
    const sd = activeCenterCast(53)!;
    expect(castProgress(53, sd)).toBeCloseTo(0, 5);
    expect(castProgress(57, sd)).toBeCloseTo(1, 5);
    expect(castProgress(55, sd)).toBeCloseTo(0.5, 5);
  });
});

describe("centerResolutions", () => {
  it("解決秒・真偽・パターンを setup から導出（gc1/gc2/gc3 両面 + 単発）", () => {
    const rs = centerResolutions(setupWith(CENTER));
    const byInst = Object.fromEntries(rs.map((r) => [r.instance, r]));
    expect(byInst.gc1.resolveSec).toBe(4);
    expect(byInst.gc1.geometry).toBe("cross");
    expect(byInst.gc1.params.sandagaShin).toBe(true); // gc1.sandagaTruth shin
    expect(byInst.gc1.params.blizzagaShin).toBe(false); // gc1.blizzagaTruth gi
    expect(byInst.gc2.resolveSec).toBe(16);
    expect(byInst.gc3.resolveSec).toBe(28);

    expect(byInst.sandaga.resolveSec).toBe(57);
    expect(byInst.sandaga.geometry).toBe("thunder");
    expect(byInst.sandaga.params.sandagaShin).toBe(false); // sandaga.truth gi
    expect(byInst.blizzaga.resolveSec).toBe(74);
    expect(byInst.blizzaga.geometry).toBe("blizzard");
    expect(byInst.blizzaga.params.blizzagaShin).toBe(true); // blizzaga.truth shin
  });
});

describe("centerTruths（真偽インジケータ: ハードコードでなく実データ）", () => {
  it("グランドクロスは上下両面の真偽を返す", () => {
    const s = setupWith(CENTER);
    expect(centerTruths(s, "gc1")).toEqual({ sandaga: true, blizzaga: false });
    expect(centerTruths(s, "gc2")).toEqual({ sandaga: false, blizzaga: true });
    expect(centerTruths(s, "gc3")).toEqual({ sandaga: true, blizzaga: true });
  });
  it("単発は該当面のみ（サンダガ=上のみ / ブリザガ=下のみ）", () => {
    const s = setupWith(CENTER);
    expect(centerTruths(s, "sandaga")).toEqual({ sandaga: false, blizzaga: null });
    expect(centerTruths(s, "blizzaga")).toEqual({ sandaga: null, blizzaga: true });
  });
  it("真偽は うそ固定ではなく setup を反映する（gi も shin も出る）", () => {
    const allGi = setupWith({
      ...CENTER,
      gc1: { sandagaTruth: "gi", blizzagaTruth: "gi", thunderPattern: 0, blizzardPattern: 0 },
    });
    expect(centerTruths(allGi, "gc1")).toEqual({ sandaga: false, blizzaga: false });
    const allShin = setupWith({
      ...CENTER,
      gc1: { sandagaTruth: "shin", blizzagaTruth: "shin", thunderPattern: 0, blizzardPattern: 0 },
    });
    expect(centerTruths(allShin, "gc1")).toEqual({ sandaga: true, blizzaga: true });
  });
});
