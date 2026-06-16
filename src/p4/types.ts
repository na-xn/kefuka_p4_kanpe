/** "shin"=真(本当), "gi"=偽(嘘), ""=未選択 */
export type Choice = "shin" | "gi" | "";
/** 担当セレクタの選択値（イベントごとに意味が変わる）/ "" = 未選択 */
export type Role = string;

export type State = Record<string, string>;

/** 1つの判定行の定義。resolve は揃った行動テキストを返す（未確定なら null）。 */
export type Judge = {
  /** 判定の安定 id（状態キー） */
  id: string;
  /** 行ラベル */
  label: string;
  /** 担当セレクタ（任意）。指定時は別の状態キー `${id}__role` を使う。mid は任意の3つ目。 */
  role?: {
    left: { value: Role; label: string };
    mid?: { value: Role; label: string };
    right: { value: Role; label: string };
  };
  /** 真/偽トグルを出すか（デフォルト true） */
  truth?: boolean;
  /** 揃った行動テキストを返す。揃っていなければ null */
  resolve: (v: { truth: Choice; role: Role }) => string | null;
};

export type EventDef = { id: string; name: string; judges: Judge[] };

export type MenuState = { x: number; y: number } | null;

/** フェーズ: 判定入力 → 処理フロー */
export type Phase = "input" | "process";
