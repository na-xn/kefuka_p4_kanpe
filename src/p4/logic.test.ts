import { describe, it, expect } from "vitest";
import {
  raiMizuAction,
  tsunamiHonooAction,
  juso,
  accel,
  seishi,
  magicFinal,
  fumuText,
} from "@/p4/logic";

describe("raiMizuAction", () => {
  const spread = "💥 散開（1人）";
  const stack = "🤝 頭割り";
  it("rai × shin = 散開", () => expect(raiMizuAction("rai", "shin")).toBe(spread));
  it("rai × gi = 頭割り", () => expect(raiMizuAction("rai", "gi")).toBe(stack));
  it("mizu × shin = 頭割り", () => expect(raiMizuAction("mizu", "shin")).toBe(stack));
  it("mizu × gi = 散開", () => expect(raiMizuAction("mizu", "gi")).toBe(spread));
  it("nashi × shin = 頭割り（水判定）", () => expect(raiMizuAction("nashi", "shin")).toBe(stack));
  it("nashi × gi = 散開", () => expect(raiMizuAction("nashi", "gi")).toBe(spread));
  it("未入力 → null（role 空）", () => expect(raiMizuAction("", "shin")).toBeNull());
  it("未入力 → null（truth 空）", () => expect(raiMizuAction("rai", "")).toBeNull());
});

describe("tsunamiHonooAction", () => {
  it("honoo × shin = タケノコ【炎】", () =>
    expect(tsunamiHonooAction("honoo", "shin")).toBe("🎍 タケノコ回避【炎】"));
  it("honoo × gi = ドーナツ", () =>
    expect(tsunamiHonooAction("honoo", "gi")).toBe("🍩 ドーナツ＝中央で動かない"));
  it("tsunami × shin = ドーナツ", () =>
    expect(tsunamiHonooAction("tsunami", "shin")).toBe("🍩 ドーナツ＝中央で動かない"));
  it("tsunami × gi = タケノコ【水】", () =>
    expect(tsunamiHonooAction("tsunami", "gi")).toBe("🎍 タケノコ回避【水】"));
  it("未入力 → null（role 空）", () => expect(tsunamiHonooAction("", "shin")).toBeNull());
  it("未入力 → null（truth 空）", () => expect(tsunamiHonooAction("honoo", "")).toBeNull());
});

describe("juso", () => {
  it("shin = 見ない", () => expect(juso("shin")).toBe("👁 見ない"));
  it("gi = 見る", () => expect(juso("gi")).toBe("👁 見る"));
  it("\"\" → null", () => expect(juso("")).toBeNull());
});

describe("accel", () => {
  it("shin = 止まる", () => expect(accel("shin")).toBe("🛑 止まる"));
  it("gi = 動く", () => expect(accel("gi")).toBe("🏃 動く"));
  it("\"\" → null", () => expect(accel("")).toBeNull());
});

describe("seishi", () => {
  const live = "生きる（無敵/ダメージ受けない）";
  const die = "死ぬ（ダメージ受ける）";
  it("aragan × shin = 生きる", () => expect(seishi("aragan", "shin")).toBe(live));
  it("aragan × gi = 死ぬ", () => expect(seishi("aragan", "gi")).toBe(die));
  it("shi × shin = 死ぬ", () => expect(seishi("shi", "shin")).toBe(die));
  it("shi × gi = 生きる", () => expect(seishi("shi", "gi")).toBe(live));
  it("未入力 → null（role 空）", () => expect(seishi("", "shin")).toBeNull());
  it("未入力 → null（truth 空）", () => expect(seishi("aragan", "")).toBeNull());
});

describe("magicFinal", () => {
  it("一致 (shin, shin) → shin", () => expect(magicFinal("shin", "shin")).toBe("shin"));
  it("一致 (gi, gi) → shin", () => expect(magicFinal("gi", "gi")).toBe("shin"));
  it("不一致 (shin, gi) → gi", () => expect(magicFinal("shin", "gi")).toBe("gi"));
  it("不一致 (gi, shin) → gi", () => expect(magicFinal("gi", "shin")).toBe("gi"));
  it("片方未入力 (memory 空) → null", () => expect(magicFinal("", "shin")).toBeNull());
  it("片方未入力 (out 空) → null", () => expect(magicFinal("shin", "")).toBeNull());
});

describe("fumuText", () => {
  it("shin → 踏まない", () => expect(fumuText("shin")).toBe("踏まない"));
  it("gi → 踏む", () => expect(fumuText("gi")).toBe("踏む"));
  it("\"\" → null", () => expect(fumuText("")).toBeNull());
  it("null → null", () => expect(fumuText(null)).toBeNull());
});
