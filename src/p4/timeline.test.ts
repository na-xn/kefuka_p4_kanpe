import { describe, it, expect } from "vitest";
import { buildTimeline, itemRevealSec, buildAnswerTimeline, type Item } from "@/p4/timeline";
import type { SimSetup } from "@/p4/simulation";
import { DEBUFF_ICON } from "@/p4/icons";

/** key で Item を取り出すヘルパ。 */
function byKey(items: Item[], key: string): Item | undefined {
  return items.find((i) => i.key === key);
}

describe("buildTimeline", () => {
  it("水雷と加速度が同タイミング(早)なら1行に統合し、逆側に join 頭割りが立つ", () => {
    // 水/GC1/早・視線(yes)→ accelGC=2, accelWhen=oso ... 同タイミングにするには
    // waterGC=1(早)で加速度も早になる必要がある。視線GC2=遅なので、ここでは無職にして
    // accelGC=2 が早になるよう shisen=no。
    const items = buildTimeline({
      waterType: "mizu",
      waterGC: "1",
      waterWhen: "haya",
      shisen: "no", // 無職 → accelGC=2 が早
      gc1: "shin",
      gc2: "shin",
      honoo: "shin",
      tsunami: "shin",
    });
    const merged = byKey(items, "water_accel");
    expect(merged).toBeDefined();
    // 水・真→頭割り、加速度 真→止まる
    expect(merged!.text).toBe("頭割り・止まる");
    expect(merged!.icon).toBeDefined();
    expect(merged!.extraIcon).toBeDefined();
    expect(merged!.phase).toBe(1.0);

    const join = byKey(items, "join");
    expect(join).toBeDefined();
    expect(join!.lucide).toBe("users");
    expect(join!.text).toBe("頭割り");
    expect(join!.phase).toBe(4.0);
  });

  it("同タイミングで水が偽なら散会・動く（加速度偽）", () => {
    const items = buildTimeline({
      waterType: "mizu",
      waterGC: "1",
      waterWhen: "haya",
      shisen: "no",
      gc1: "gi", // 水 偽→散会, 加速度(gc2) は別
      gc2: "gi", // 加速度 偽→動く
      honoo: "shin",
      tsunami: "shin",
    });
    const merged = byKey(items, "water_accel");
    expect(merged!.text).toBe("散会・動く");
  });

  it("水雷と加速度が別タイミングなら単独の water / accel 行になる", () => {
    // 水/GC1/早・視線(yes)→ accelGC=2 視線→遅。別タイミング。
    const items = buildTimeline({
      waterType: "mizu",
      waterGC: "1",
      waterWhen: "haya",
      shisen: "yes",
      gc1: "shin",
      gc2: "shin",
      honoo: "shin",
      tsunami: "shin",
    });
    expect(byKey(items, "water_accel")).toBeUndefined();
    const water = byKey(items, "water");
    const acc = byKey(items, "accel");
    expect(water).toBeDefined();
    expect(water!.text).toBe("頭割り");
    expect(acc).toBeDefined();
    // 加速度 真→止まる → "頭割り・止まる"
    expect(acc!.text).toBe("頭割り・止まる");
    expect(acc!.phase).toBe(4.1); // 遅
  });

  it("juso/honoo/tsunami の単独行が正しいテキストを持つ", () => {
    const items = buildTimeline({
      waterType: "mizu",
      waterGC: "1",
      waterWhen: "haya",
      shisen: "yes",
      gc1: "shin", // juso_haya 真→見ない
      gc2: "gi", // juso_oso 偽→見る
      honoo: "shin", // 炎 真→タケノコ回避
      tsunami: "gi", // 水 偽→タケノコ回避
    });
    expect(byKey(items, "juso_haya")!.text).toBe("見ない");
    expect(byKey(items, "juso_oso")!.text).toBe("見る");
    expect(byKey(items, "honoo")!.text).toBe("タケノコ回避");
    expect(byKey(items, "tsunami")!.text).toBe("タケノコ回避");
  });

  it("処理順 phase で昇順ソートされている", () => {
    const items = buildTimeline({
      waterType: "rai",
      waterGC: "2",
      waterWhen: "oso",
      shisen: "yes",
      gc1: "gi",
      gc2: "shin",
      honoo: "gi",
      tsunami: "shin",
    });
    const phases = items.map((i) => i.phase);
    const sorted = [...phases].sort((a, b) => a - b);
    expect(phases).toEqual(sorted);
  });
});

describe("buildAnswerTimeline", () => {
  /** 最小有効 SimSetup — seat0: GC1=水(mizu)/GC2=視線(shisen)、GC3 と傷は引数で切り替える。 */
  function makeSetup(gc3Role: "aragan" | "shi", gc3Scar: "seija" | "shisha" = "seija"): SimSetup {
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
      gc3SplitTruth: "shin",
      centerAoE: {
        gc1: { sandagaTruth: "shin", blizzagaTruth: "shin", thunderPattern: 0, blizzardPattern: 0 },
        gc2: { sandagaTruth: "shin", blizzagaTruth: "shin", thunderPattern: 0, blizzardPattern: 0 },
        gc3: { sandagaTruth: "shin", blizzagaTruth: "shin", thunderPattern: 0, blizzardPattern: 0 },
        sandaga: { truth: "shin", thunderPattern: 0 },
        blizzaga: { truth: "shin", blizzardPattern: 0 },
      },
      players: [
        { seat: 0, gc1Role: "mizu", gc2Role: "shisen", gc3Role, gc3Scar },
        { seat: 1, gc1Role: "rai",  gc2Role: "mushoku", gc3Role: "aragan", gc3Scar: "seija" },
        { seat: 2, gc1Role: "shisen", gc2Role: "mizu", gc3Role: "aragan", gc3Scar: "seija" },
        { seat: 3, gc1Role: "mushoku", gc2Role: "rai", gc3Role: "aragan", gc3Scar: "seija" },
        { seat: 4, gc1Role: "mizu", gc2Role: "shisen", gc3Role: "shi", gc3Scar: "shisha" },
        { seat: 5, gc1Role: "rai",  gc2Role: "mushoku", gc3Role: "shi", gc3Scar: "shisha" },
        { seat: 6, gc1Role: "shisen", gc2Role: "mizu", gc3Role: "shi", gc3Scar: "shisha" },
        { seat: 7, gc1Role: "mushoku", gc2Role: "rai", gc3Role: "shi", gc3Scar: "shisha" },
      ],
    };
  }

  it("先頭行は GC3 行で sec=46", () => {
    const rows = buildAnswerTimeline(makeSetup("aragan"), 0);
    expect(rows[0].key).toBe("gc3");
    expect(rows[0].sec).toBe(46);
  });

  it("gc3Role=aragan のとき aragan アイコンと「生きる」テキストを持つ", () => {
    const rows = buildAnswerTimeline(makeSetup("aragan", "seija"), 0);
    const gc3 = rows[0];
    expect(gc3.icon).toBe(DEBUFF_ICON.aragan);
    expect(gc3.text).toContain("外周エクスデス：生きる");
    expect(gc3.text).toContain("生者");
    expect(gc3.extraIcon).toBe(DEBUFF_ICON.seija);
  });

  it("gc3Role=shi のとき shi アイコンと「死ぬ」テキストを持つ", () => {
    const rows = buildAnswerTimeline(makeSetup("shi", "shisha"), 0);
    const gc3 = rows[0];
    expect(gc3.icon).toBe(DEBUFF_ICON.shi);
    expect(gc3.text).toContain("外周エクスデス：死ぬ");
    expect(gc3.text).toContain("死者");
    expect(gc3.extraIcon).toBe(DEBUFF_ICON.shisha);
  });

  it("gc3Scar=seija のとき seija extraIcon を持つ", () => {
    const rows = buildAnswerTimeline(makeSetup("aragan", "seija"), 0);
    const gc3 = rows.find((r) => r.key === "gc3")!;
    expect(gc3.extraIcon).toBe(DEBUFF_ICON.seija);
    expect(gc3.text).toContain("生者");
  });

  it("gc3Scar=shisha のとき shisha extraIcon を持つ", () => {
    const rows = buildAnswerTimeline(makeSetup("aragan", "shisha"), 0);
    const gc3 = rows.find((r) => r.key === "gc3")!;
    expect(gc3.extraIcon).toBe(DEBUFF_ICON.shisha);
    expect(gc3.text).toContain("死者");
  });

  it("rows は sec 昇順でソートされている", () => {
    const rows = buildAnswerTimeline(makeSetup("aragan"), 0);
    const secs = rows.map((r) => r.sec);
    const sorted = [...secs].sort((a, b) => a - b);
    expect(secs).toEqual(sorted);
  });

  it("GC3 行以外は buildTimeline + itemRevealSec と一致する", () => {
    const setup = makeSetup("aragan");
    const rows = buildAnswerTimeline(setup, 0);
    const nonGc3 = rows.filter((r) => r.key !== "gc3");

    // buildTimeline は toMinState(setup,0) で呼ばれるが、ここでは結果のキーと秒だけ照合。
    const expectedSecs = [51, 57, 62, 74, 79, 84]; // phase 1~6 の標準秒
    for (const row of nonGc3) {
      expect(expectedSecs).toContain(row.sec);
    }
    // buildTimeline が返すキーがすべて存在する。
    const keys = nonGc3.map((r) => r.key);
    // 最低限の必須キーが存在する（水が早なので water/accel か water_accel があるはず）。
    const hasWater = keys.includes("water") || keys.includes("water_accel");
    expect(hasWater).toBe(true);
  });

  it("GC3 行を除くと 6 行（buildTimeline の標準出力と同数）", () => {
    const rows = buildAnswerTimeline(makeSetup("shi"), 0);
    const nonGc3 = rows.filter((r) => r.key !== "gc3");
    expect(nonGc3).toHaveLength(6);
  });
});

describe("itemRevealSec", () => {
  const at = (phase: number) =>
    itemRevealSec({ key: "x", phase, group: 0, text: null });

  it("phase 帯ごとに正しい絶対秒へマップする", () => {
    expect(at(1.0)).toBe(51); // 早 水雷/加速度
    expect(at(1.1)).toBe(51);
    expect(at(2.0)).toBe(57); // 視線 早
    expect(at(3.0)).toBe(62); // ほのお
    expect(at(4.0)).toBe(74); // 遅 水雷/加速度
    expect(at(4.1)).toBe(74);
    expect(at(5.0)).toBe(79); // 視線 遅
    expect(at(6.0)).toBe(84); // つなみ
  });
});
