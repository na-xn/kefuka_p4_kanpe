import type { Judge, EventDef } from "@/p4/types";
import { raiMizuAction, tsunamiHonooAction } from "@/p4/logic";

// 各GCは「担当(雷/水)＋GC真偽1つ」。この1つの真偽が呪詛・雷水・加速度すべてを決める。
export const gcJudges = (suffix: string): Judge[] => [
  {
    id: `gc${suffix}_role`,
    label: "担当（雷/水/なし）＋GC真偽",
    role: {
      left: { value: "rai", label: "雷" },
      mid: { value: "mizu", label: "水" },
      right: { value: "nashi", label: "なし" },
    },
    resolve: ({ truth, role }) => raiMizuAction(role, truth),
  },
];

export const tsunamiJudges = (suffix: string): Judge[] => [
  {
    id: `wave${suffix}_type`,
    label: "種類",
    role: { left: { value: "honoo", label: "炎(ほのお)" }, right: { value: "tsunami", label: "水(つなみ)" } },
    resolve: ({ truth, role }) => tsunamiHonooAction(role, truth),
  },
];

export const EVENTS: EventDef[] = [
  { id: "gc1", name: "グランドクロス 1回目", judges: gcJudges("1") },
  { id: "wave1", name: "つなみ / ほのお 1回目", judges: tsunamiJudges("1") },
  { id: "gc2", name: "グランドクロス 2回目", judges: gcJudges("2") },
  { id: "wave2", name: "つなみ / ほのお 2回目", judges: tsunamiJudges("2") },
  {
    id: "gc3",
    name: "グランドクロス 3回目（生者の傷）",
    judges: [
      {
        id: "gc3_role",
        label: "担当",
        truth: false,
        role: {
          left: { value: "aragan", label: "アラガンフィールド" },
          right: { value: "shi", label: "死の超越" },
        },
        resolve: () => null,
      },
      {
        id: "gc3_mu",
        label: "無の氾濫",
        resolve: () => null,
      },
    ],
  },
  {
    id: "magic",
    name: "マジックチャージ → マジックアウト",
    judges: [
      { id: "magic_thunda", label: "もりもりサンダガ（記憶）", resolve: () => null },
      { id: "magic_blizza", label: "ひろげるブリザガ（記憶）", resolve: () => null },
      { id: "magic_out", label: "マジックアウト", resolve: () => null },
    ],
  },
];

/** 判定入力フェーズで表示するイベント（①〜⑤。⑥マジックは出さない） */
export const INPUT_EVENTS = EVENTS.filter((e) => e.id !== "magic");
