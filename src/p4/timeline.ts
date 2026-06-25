/**
 * 処理順タイムラインの導出（純ロジック・UIなし）。
 *
 * MinState（自分の水雷タイプ/GC/早遅・加速度系の視線/無職、および GC1/GC2/ほのお/つなみの真偽）
 * から、処理順に並んだタイムライン Item を導出する。
 *
 * このモジュールは MinimumMode.tsx が以前インラインで持っていた導出ロジックを
 * そのまま抽出したもの。出力（ソート済み Item 列）は MinimumMode のレンダリングと
 * 1バイトも変えずに一致する。
 */

import { accel, raiMizuAction, tsunamiHonooAction, juso } from "@/p4/logic";
import { DEBUFF_ICON } from "@/p4/icons";
import type { Choice } from "@/p4/types";

/** 既定値（INITIAL_MIN と同一）。buildTimeline は欠損キーをこれで補完する。 */
const INITIAL_MIN: Record<string, string> = {
  waterType: "mizu",
  waterGC: "1",
  waterWhen: "haya",
  shisen: "yes",
  gc1: "shin",
  gc2: "shin",
  honoo: "shin",
  tsunami: "shin",
  thunda: "shin",
  blizza: "shin",
};

/** 導出タイムラインの1アイテム。 */
export type Item = {
  key: string;
  /** 処理順（小さいほど先） */
  phase: number;
  /** ブロック化するグループ（1=早水雷加速度, 4=遅水雷加速度, 100=記憶, それ以外=単独） */
  group: number;
  icon?: string;
  lucide?: "zap" | "snow" | "users";
  /** 2つ目のデバフアイコン（水雷＋加速度を1行に統合したとき用） */
  extraIcon?: string;
  /** 行動テキスト（null/空なら「—」） */
  text: string | null;
};

/**
 * MinState から処理順タイムライン Item 列を導出する。
 * MinimumMode が描画していたソート済みリストと同一の出力を返す。
 */
export function buildTimeline(min: Record<string, string>): Item[] {
  const v = (k: string) => min[k] ?? INITIAL_MIN[k] ?? "";

  const waterType = v("waterType"); // mizu | rai
  const waterGC = v("waterGC"); // "1" | "2"
  const waterWhen = v("waterWhen"); // haya | oso
  const shisen = v("shisen"); // yes | no
  const gc1 = v("gc1");
  const gc2 = v("gc2");
  const honoo = v("honoo");
  const tsunami = v("tsunami");

  // 加速度系は水雷の逆GC。
  const accelGC = waterGC === "1" ? "2" : "1";
  const gcTruth = (n: string): Choice => (n === "1" ? gc1 : gc2) as Choice;

  // 加速弾タイミング: 視線→GC1=早/GC2=遅、無職→GC1=遅/GC2=早。
  const accelWhen =
    accelGC === "1"
      ? shisen === "yes"
        ? "haya"
        : "oso"
      : shisen === "yes"
      ? "oso"
      : "haya";

  // 自分の水雷アクション（散開/頭割り）。
  const waterText = raiMizuAction(waterType, gcTruth(waterGC));
  const waterIcon = waterType === "rai" ? DEBUFF_ICON.rai : DEBUFF_ICON.mizu;
  // 自分の加速度アクション。水雷がない回なので頭割り/散会の頭数にも入る＝加速弾とセット表記。
  // 止まる→頭割り・止まる / 動く→散会・動く。
  const accelMove = accel(gcTruth(accelGC)); // 止まる / 動く / null
  // 加速度側(=自分が水雷を処理しない側)は頭数に入る＝止/動に関係なく必ず頭割り。
  const accelText = accelMove ? `頭割り・${accelMove}` : null;

  // --- 導出アイテムを処理順 phase / グループ group で組み立てる ---
  const items: Item[] = [];

  // 自分の水雷と加速度が同じタイミング(早/遅)なら1行に統合（アイコン2つ）。
  // 頭割り/散会(水雷)＋止まる/動く(加速度) を合体: 頭割り・止まる / 散会・止まる / 頭割り・動く / 散会・動く。
  const sameBlock = (waterWhen === "oso") === (accelWhen === "oso");
  const merge = sameBlock && !!waterText && !!accelMove;
  if (merge) {
    const head = waterText === "頭割り";
    items.push({
      key: "water_accel",
      phase: waterWhen === "oso" ? 4.0 : 1.0,
      group: waterWhen === "oso" ? 4 : 1,
      icon: waterIcon,
      extraIcon: DEBUFF_ICON.accel,
      text: `${head ? "頭割り" : "散会"}・${accelMove}`,
    });
    // 自分の水雷も加速度も無い側のGC(逆タイミング)では、頭割りの頭数に入る。
    items.push({
      key: "join",
      phase: waterWhen === "oso" ? 1.0 : 4.0,
      group: waterWhen === "oso" ? 1 : 4,
      lucide: "users",
      text: "頭割り",
    });
  } else {
    // ② 自分の水雷（早/遅は waterWhen）。group: 早=1 / 遅=4。
    items.push({
      key: "water",
      phase: waterWhen === "oso" ? 4.0 : 1.0,
      group: waterWhen === "oso" ? 4 : 1,
      icon: waterIcon,
      text: waterText,
    });
    // ② 自分の加速度（早/遅は accelWhen）。group: 早=1 / 遅=4。
    items.push({
      key: "accel",
      phase: accelWhen === "oso" ? 4.1 : 1.1,
      group: accelWhen === "oso" ? 4 : 1,
      icon: DEBUFF_ICON.accel,
      text: accelText,
    });
  }
  // ③ 視線（早 = GC1視線）: juso(gc1)。単独行。
  items.push({
    key: "juso_haya",
    phase: 2.0,
    group: 2,
    icon: DEBUFF_ICON.juso,
    text: juso(gc1 as Choice),
  });
  // ④ ほのお（必ず早）: tsunamiHonooAction。単独行。
  items.push({
    key: "honoo",
    phase: 3.0,
    group: 3,
    icon: DEBUFF_ICON.honoo,
    text: tsunamiHonooAction("honoo", honoo as Choice),
  });
  // ⑥ 視線（遅 = GC2視線）: juso(gc2)。単独行。
  items.push({
    key: "juso_oso",
    phase: 5.0,
    group: 5,
    icon: DEBUFF_ICON.juso,
    text: juso(gc2 as Choice),
  });
  // ⑦ つなみ（必ず遅）。単独行。
  items.push({
    key: "tsunami",
    phase: 6.0,
    group: 6,
    icon: DEBUFF_ICON.tsunami,
    text: tsunamiHonooAction("tsunami", tsunami as Choice),
  });

  // 処理順にソート。
  return [...items].sort((a, b) => a.phase - b.phase);
}

/**
 * 各 Item を sim クロック上の絶対秒へマップする（付与リビールは t=8..40 で進む）。
 * phase に基づき、処理フェーズ（t>=51）でのリビール時刻を返す。
 */
export function itemRevealSec(item: Item): number {
  const p = item.phase;
  if (p < 2) return 51; // 早水雷/加速度（group 1）
  if (p < 3) return 57; // 視線 早 / 見る見ない wave1
  if (p < 4) return 62; // ほのお
  if (p < 5) return 74; // 遅水雷/加速度（group 4）
  if (p < 6) return 79; // 視線 遅 wave2
  return 84; // つなみ
}
