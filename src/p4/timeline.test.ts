import { describe, it, expect } from "vitest";
import { buildTimeline, itemRevealSec, type Item } from "@/p4/timeline";

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
