import type { Choice, Role } from "@/p4/types";

/** 雷/水 × 真/偽 の散開・頭割りマッピング（①B / ③B 共通） */
export function raiMizuAction(role: Role, truth: Choice): string | null {
  if (!role || !truth) return null;
  const spread = "💥 散開（1人）";
  const stack = "🤝 頭割り";
  if (role === "rai") return truth === "shin" ? spread : stack;
  // mizu
  return truth === "shin" ? stack : spread;
}

/** 炎/水 × 真/偽 のタケノコ・ドーナツマッピング（② / ④ 共通） */
export function tsunamiHonooAction(role: Role, truth: Choice): string | null {
  if (!role || !truth) return null;
  if (role === "honoo") return truth === "shin" ? "🎍 タケノコ回避【炎】" : "🍩 ドーナツ＝中央で動かない";
  // tsunami(水)
  return truth === "shin" ? "🍩 ドーナツ＝中央で動かない" : "🎍 タケノコ回避【水】";
}

/** 呪詛の叫声: 真→見ない / 偽→見る */
export function juso(truth: Choice): string | null {
  if (!truth) return null;
  return truth === "shin" ? "👁 見ない" : "👁 見る";
}

/** 加速度爆弾: 真→止まる / 偽→動く */
export function accel(truth: Choice): string | null {
  if (!truth) return null;
  return truth === "shin" ? "🛑 止まる" : "🏃 動く";
}

/**
 * 生者の傷（GC3）の生死判定。担当 × 真偽（本当/嘘）で生きる／死ぬを返す。
 * - アラガン: 本当→生きる / 嘘→死ぬ
 * - 死の超越: 本当→死ぬ / 嘘→生きる
 * 未確定なら null。
 */
export function seishi(role: Role, truth: Choice): string | null {
  if (!role || !truth) return null;
  const live = "生きる（無敵/ダメージ受けない）";
  const die = "死ぬ（ダメージ受ける）";
  if (role === "aragan") return truth === "shin" ? live : die;
  // shi（死の超越）
  return truth === "shin" ? die : live;
}
