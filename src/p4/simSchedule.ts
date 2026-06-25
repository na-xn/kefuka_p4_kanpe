/**
 * 練習モード（シミュレーション）の「実戦タイム」リビールスケジュールと
 * 役割→アイコン/ラベルのマッピング（純ロジック・UIなし）。
 *
 * SimulationMode.tsx から参照する。各リビール行が「経過秒 atSec で開示される」
 * という形のスケジュールを定義する（1x基準）。speed で割って短縮可能。
 */

import { DEBUFF_ICON } from "@/p4/icons";
import type {
  SimSetup,
  GcRole,
  Gc3Role,
  WaveType,
  Truth,
} from "@/p4/simulation";

/** リビール1行（席0視点で順次開示される割当）。 */
export type RevealRow = {
  /** 一意キー。 */
  key: string;
  /** 1x 基準で開示される経過秒。 */
  atSec: number;
  /** 行見出し（例: "GC1 役割"）。 */
  caption: string;
  /** デバフアイコン src。 */
  icon: string;
  /** 役割/属性の日本語ラベル（例: "水", "ほのお(炎)"）。 */
  label: string;
  /** 真偽（ある行のみ。GC3 役割など真偽を持たない行は undefined）。 */
  truth?: Truth;
};

/** GcRole → アイコン src。 */
export function gcRoleIcon(role: GcRole): string {
  switch (role) {
    case "mizu":
      return DEBUFF_ICON.mizu;
    case "rai":
      return DEBUFF_ICON.rai;
    case "shisen":
      return DEBUFF_ICON.juso;
    case "mushoku":
      return DEBUFF_ICON.accel;
  }
}

/** GcRole → 日本語ラベル。 */
export function gcRoleLabel(role: GcRole): string {
  switch (role) {
    case "mizu":
      return "水";
    case "rai":
      return "雷";
    case "shisen":
      return "視線(呪詛)";
    case "mushoku":
      return "無職(加速度)";
  }
}

/** Gc3Role → アイコン src。 */
export function gc3RoleIcon(role: Gc3Role): string {
  return role === "aragan" ? DEBUFF_ICON.aragan : DEBUFF_ICON.shi;
}

/** Gc3Role → 日本語ラベル。 */
export function gc3RoleLabel(role: Gc3Role): string {
  return role === "aragan" ? "アラガン" : "死の超越";
}

/** WaveType → アイコン src。 */
export function waveIcon(t: WaveType): string {
  return t === "honoo" ? DEBUFF_ICON.honoo : DEBUFF_ICON.tsunami;
}

/** WaveType → 日本語ラベル。 */
export function waveLabel(t: WaveType): string {
  return t === "honoo" ? "ほのお(炎)" : "つなみ(水)";
}

/** Truth → 日本語ラベル（ほんと/うそ）。 */
export function truthLabel(t: Truth): string {
  return t === "shin" ? "ほんと" : "うそ";
}

/** 処理フェーズへ自動遷移する経過秒（1x 基準）。 */
export const PROCESS_AT_SEC = 50;

/**
 * 席 0 視点のリビールスケジュール（1x 基準）を組み立てる。
 *
 * - t=8  → GC1 役割 + GC1 真偽
 * - t=16 → 1回目 つなみ/ほのお + 真偽
 * - t=24 → GC2 役割 + GC2 真偽
 * - t=32 → 2回目 つなみ/ほのお + 真偽
 * - t=40 → GC3 役割（真偽なし）
 */
export function buildRevealSchedule(setup: SimSetup): RevealRow[] {
  const me = setup.players.find((p) => p.seat === 0);
  if (!me) throw new Error("seat 0 not found in setup");
  return [
    {
      key: "gc1",
      atSec: 8,
      caption: "GC1 役割",
      icon: gcRoleIcon(me.gc1Role),
      label: gcRoleLabel(me.gc1Role),
      truth: setup.gc1Truth,
    },
    {
      key: "wave1",
      atSec: 16,
      caption: "1回目 つなみ/ほのお",
      icon: waveIcon(setup.wave1Type),
      label: waveLabel(setup.wave1Type),
      truth: setup.wave1Truth,
    },
    {
      key: "gc2",
      atSec: 24,
      caption: "GC2 役割",
      icon: gcRoleIcon(me.gc2Role),
      label: gcRoleLabel(me.gc2Role),
      truth: setup.gc2Truth,
    },
    {
      key: "wave2",
      atSec: 32,
      caption: "2回目 つなみ/ほのお",
      icon: waveIcon(setup.wave2Type),
      label: waveLabel(setup.wave2Type),
      truth: setup.wave2Truth,
    },
    {
      key: "gc3",
      atSec: 40,
      caption: "GC3 役割",
      icon: gc3RoleIcon(me.gc3Role),
      label: gc3RoleLabel(me.gc3Role),
    },
  ];
}
