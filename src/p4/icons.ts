/** 各デバフのアイコン（public/icon/）。担当やつなみ種別などの値で参照する。 */
export const DEBUFF_ICON = {
  rai: "/icon/fork_lightning.png", // フォークライトニング（雷）
  mizu: "/icon/water_compression.png", // 水属性圧縮（水）
  accel: "/icon/accelerator_bomb.png", // 加速度爆弾
  juso: "/icon/curse_screem.png", // 呪詛の叫声
  honoo: "/icon/chaos_fire.png", // 混沌の炎
  tsunami: "/icon/chaos_water.png", // 混沌の水
  aragan: "/icon/aragan_field.png", // アラガンフィールド
  shi: "/icon/death_over.png", // 死の超越
} as const;

/** 担当(雷/水/なし)の水雷アイコン。なし/未選択は null。 */
export function raiMizuIcon(role: string): string | null {
  if (role === "rai") return DEBUFF_ICON.rai;
  if (role === "mizu") return DEBUFF_ICON.mizu;
  return null;
}

/** つなみ/ほのお(炎/水)の混沌アイコン。 */
export function chaosIcon(role: string): string | null {
  if (role === "honoo") return DEBUFF_ICON.honoo;
  if (role === "tsunami") return DEBUFF_ICON.tsunami;
  return null;
}

/** GC3 担当(アラガン/死の超越)のアイコン。 */
export function gc3Icon(role: string): string | null {
  if (role === "aragan") return DEBUFF_ICON.aragan;
  if (role === "shi") return DEBUFF_ICON.shi;
  return null;
}
