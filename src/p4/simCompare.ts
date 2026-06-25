/**
 * 手動入力モードの答え合わせ用ユーティリティ（純ロジック・UIなし）。
 *
 * compareMinState() で player が入力した MinState と正解 MinState を比較し、
 * フィールドごとの結果を返す。
 */

/** 1フィールドの比較結果。 */
export type FieldCompare = {
  key: string;
  /** 日本語フィールド名。 */
  label: string;
  /** プレイヤーが入力した値の人間可読ラベル。 */
  your: string;
  /** 正解の人間可読ラベル。 */
  correct: string;
  /** 正解なら true。 */
  ok: boolean;
};

/** toMinState が返す 10 キーを表示順で定義。 */
const FIELD_DEFS: { key: string; label: string }[] = [
  { key: "waterType", label: "水雷" },
  { key: "waterGC", label: "水雷GC" },
  { key: "waterWhen", label: "水雷早遅" },
  { key: "shisen", label: "加速度系" },
  { key: "gc1", label: "GC1" },
  { key: "gc2", label: "GC2" },
  { key: "honoo", label: "ほのお" },
  { key: "tsunami", label: "つなみ" },
  { key: "thunda", label: "サンダガ" },
  { key: "blizza", label: "ブリザガ" },
];

/** 生の MinState 値を人間可読ラベルへ変換する。 */
function humanLabel(value: string): string {
  switch (value) {
    case "mizu":
      return "水";
    case "rai":
      return "雷";
    case "1":
      return "GC1";
    case "2":
      return "GC2";
    case "haya":
      return "早";
    case "oso":
      return "遅";
    case "yes":
      return "視線";
    case "no":
      return "無職";
    case "shin":
      return "ほんと";
    case "gi":
      return "うそ";
    default:
      return value;
  }
}

/**
 * プレイヤーが入力した MinState と正解 MinState を比較して、
 * toMinState が返す 10 フィールドすべての比較結果を返す。
 *
 * @param your   プレイヤーが入力した MinState（Record<string,string>）。
 * @param correct toMinState() が返した正解 MinState。
 */
export function compareMinState(
  your: Record<string, string>,
  correct: Record<string, string>,
): FieldCompare[] {
  return FIELD_DEFS.map(({ key, label }) => {
    const yourVal = your[key] ?? "";
    const correctVal = correct[key] ?? "";
    return {
      key,
      label,
      your: humanLabel(yourVal),
      correct: humanLabel(correctVal),
      ok: yourVal === correctVal,
    };
  });
}
