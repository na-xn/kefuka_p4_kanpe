/**
 * セッションルームの純ロジック（Workers/DOM 依存なし）。
 *
 * Durable Object はこの純関数群を使うだけで、席割り当て・ホスト判定・
 * ロスター生成のルールはすべてここに集約する。アプリコード（generateSim 等）は
 * 一切 import しない（DO は「お題」を生成せず、ホストクライアントが生成して中継するだけ）。
 */

/** 1席の占有情報。 */
export type Seat = {
  /** 席番号 0..7。 */
  seat: number;
  /** プレイヤー名。 */
  name: string;
};

/** ロスター1エントリ（クライアントへ配る形）。 */
export type RosterEntry = {
  seat: number;
  name: string;
  isHost: boolean;
};

/** 席は 0..7 の 8 席。 */
export const MAX_SEATS = 8;

/**
 * 占有済み席集合から、空いている最小の席番号を返す。
 * 満席（8席すべて占有）なら null。
 */
export function lowestFreeSeat(taken: Iterable<number>): number | null {
  const set = new Set(taken);
  for (let s = 0; s < MAX_SEATS; s++) {
    if (!set.has(s)) return s;
  }
  return null;
}

/**
 * 占有席集合からホスト席（占有中の最小席番号）を返す。
 * 誰もいなければ null。
 */
export function hostSeat(taken: Iterable<number>): number | null {
  let min: number | null = null;
  for (const s of taken) {
    if (min === null || s < min) min = s;
  }
  return min;
}

/** ある席がホストか（= 占有中の最小席）。 */
export function isHostSeat(seat: number, taken: Iterable<number>): boolean {
  return hostSeat(taken) === seat;
}

/** 位置中継（pos）の正規化済みペイロード。 */
export type PosPayload = { x: number; y: number; fx: number; fy: number };

/**
 * 受信 pos メッセージから有限数値の {x,y,fx,fy} を取り出す（純バリデーション）。
 * 数値でない/非有限な値が一つでもあれば null（= 中継しない）。
 * DO は本関数で検証してから他接続へ中継する（自席エコーはしない）。
 */
export function parsePos(msg: { [k: string]: unknown }): PosPayload | null {
  const x = msg.x;
  const y = msg.y;
  const fx = msg.fx;
  const fy = msg.fy;
  for (const n of [x, y, fx, fy]) {
    if (typeof n !== "number" || !Number.isFinite(n)) return null;
  }
  return { x: x as number, y: y as number, fx: fx as number, fy: fy as number };
}

/**
 * 占有席リストからクライアント配布用ロスター（席昇順）を組み立てる。
 * 最小席が isHost=true になる。
 */
export function buildRoster(seats: Iterable<Seat>): RosterEntry[] {
  const list = [...seats];
  const host = hostSeat(list.map((s) => s.seat));
  return list
    .map((s) => ({ seat: s.seat, name: s.name, isHost: s.seat === host }))
    .sort((a, b) => a.seat - b.seat);
}
