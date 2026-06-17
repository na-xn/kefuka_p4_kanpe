import type { Choice, Role } from "@/p4/types";

/**
 * 雷/水/なし × 真/偽 の散開・頭割りマッピング。
 * - 雷: 本当→散開 / 嘘→頭割り
 * - 水: 本当→頭割り / 嘘→散開
 * - なし（雷も水も付かない無職）: 真偽に関係なく必ず頭割り参加
 */
export function raiMizuAction(role: Role, truth: Choice): string | null {
  if (!role) return null;
  const spread = "💥 散開（1人）";
  const stack = "🤝 頭割り";
  if (role === "nashi") return stack; // 無職＝頭割り参加（真偽不問）
  if (!truth) return null;
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

/**
 * マジックアウトの XNOR 判定。記憶値とマジックアウト値が
 * 一致なら "shin"（本当→踏まない）、不一致なら "gi"（嘘→踏む）。
 * どちらか未確定なら null。
 */
export function magicFinal(memory: Choice, out: Choice): "shin" | "gi" | null {
  if (!memory || !out) return null;
  return memory === out ? "shin" : "gi";
}

/** 真偽から踏む/踏まないテキスト。shin→"踏まない" / gi→"踏む" / それ以外→null。 */
export function fumuText(f: Choice | null): string | null {
  return f === "shin" ? "踏まない" : f === "gi" ? "踏む" : null;
}
