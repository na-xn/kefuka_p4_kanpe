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
