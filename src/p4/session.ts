/**
 * 8人セッション同期のクライアント層（WebSocket）。
 *
 * サーバ（Cloudflare Durable Object「SessionRoom」）と JSON メッセージで会話する。
 * DO はお題を生成しない（席管理 + 中継のみ）。ホストクライアントが generateSim() で
 * 作った setup を `start` で送り、DO が全員へブロードキャストする。各クライアントは
 * 受け取った setup + 自分の席 + カウントダウンから開始時刻をローカルに算出して練習を回す。
 *
 * 同期の注意（要把握）: 開始時刻は「受信時刻 + startInMs」を各クライアントが個別に計算する
 * 簡易同期。WS のレイテンシ（通常数十〜百ms程度）ぶんだけ端末間でズレうる。実用上は十分。
 */

import { useCallback, useEffect, useRef, useState } from "react";
import type { SimSetup } from "@/p4/simulation";

/** Tauri ランタイム内か（web origin を持たないため WS の host を固定する）。 */
const IS_TAURI =
  typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

/** Tauri（デスクトップ）版が接続する本番ホスト。web は location.host を使う。 */
const TAURI_WS_HOST = "kefuka-p4-kanpe.na-xn.app";

/** セッションIDから WebSocket URL を組み立てる。 */
export function wsUrlFor(sessionId: string): string {
  const id = encodeURIComponent(sessionId);
  if (IS_TAURI) {
    return `wss://${TAURI_WS_HOST}/api/session/${id}/ws`;
  }
  const proto = location.protocol === "https:" ? "wss" : "ws";
  return `${proto}://${location.host}/api/session/${id}/ws`;
}

/** 接続ステータス。 */
export type SessionStatus =
  | "idle"
  | "connecting"
  | "joined"
  | "full"
  | "error"
  | "closed";

/** ロスター1エントリ（占有席）。 */
export type RosterEntry = { seat: number; name: string; isHost: boolean };

/** 8席ぶんのロスタースロット（占有 or NPC=空席）。 */
export type SeatSlot =
  | { seat: number; occupied: true; name: string; isHost: boolean; isMe: boolean }
  | { seat: number; occupied: false };

/** start 受信ペイロード。 */
export type StartPayload = { setup: SimSetup; startInMs: number };

/** useSession の戻り値。 */
export type SessionApi = {
  status: SessionStatus;
  mySeat: number | null;
  isHost: boolean;
  /** 常に 8 件（占有 or NPC）。席昇順。 */
  roster: SeatSlot[];
  connect: (sessionId: string, name: string) => void;
  disconnect: () => void;
  /** ホスト専用: お題開始を全員へ送る。 */
  sendStart: (setup: SimSetup, startInMs: number) => void;
  /** ホスト専用: ロビーへ戻すリセットを全員へ送る。 */
  sendReset: () => void;
};

/** start / reset を受け取るためのコールバック。 */
export type SessionCallbacks = {
  onStart?: (p: StartPayload) => void;
  onReset?: () => void;
};

/** 占有ロスター（最大8）から 8 スロット配列（NPC 補完）を作る。 */
function toSeatSlots(
  roster: RosterEntry[],
  mySeat: number | null,
): SeatSlot[] {
  const bySeat = new Map(roster.map((r) => [r.seat, r]));
  const slots: SeatSlot[] = [];
  for (let seat = 0; seat < 8; seat++) {
    const e = bySeat.get(seat);
    if (e) {
      slots.push({
        seat,
        occupied: true,
        name: e.name,
        isHost: e.isHost,
        isMe: seat === mySeat,
      });
    } else {
      slots.push({ seat, occupied: false });
    }
  }
  return slots;
}

/**
 * セッション接続を司る React フック。
 *
 * connect() で WS を張り join を送る。welcome / roster / start / reset を受けて
 * 状態とコールバックへ反映する。アンマウント時に自動で切断する。
 */
export function useSession(callbacks: SessionCallbacks = {}): SessionApi {
  const [status, setStatus] = useState<SessionStatus>("idle");
  const [mySeat, setMySeat] = useState<number | null>(null);
  const [isHost, setIsHost] = useState(false);
  const [roster, setRoster] = useState<RosterEntry[]>([]);

  const wsRef = useRef<WebSocket | null>(null);
  const nameRef = useRef<string>("");
  // コールバックは最新を ref で参照（再接続を誘発させない）。
  const cbRef = useRef<SessionCallbacks>(callbacks);
  cbRef.current = callbacks;
  // 自分の席を ref でも持ち、roster 受信時の isHost 判定に使う。
  const mySeatRef = useRef<number | null>(null);

  const disconnect = useCallback(() => {
    const ws = wsRef.current;
    wsRef.current = null;
    if (ws) {
      try {
        ws.close();
      } catch {
        /* noop */
      }
    }
    setStatus("closed");
    setMySeat(null);
    mySeatRef.current = null;
    setIsHost(false);
    setRoster([]);
  }, []);

  const connect = useCallback((sessionId: string, name: string) => {
    // 既存接続があれば閉じる。
    if (wsRef.current) {
      try {
        wsRef.current.close();
      } catch {
        /* noop */
      }
      wsRef.current = null;
    }
    setStatus("connecting");
    setMySeat(null);
    mySeatRef.current = null;
    setIsHost(false);
    setRoster([]);
    nameRef.current = name;

    let ws: WebSocket;
    try {
      ws = new WebSocket(wsUrlFor(sessionId));
    } catch {
      setStatus("error");
      return;
    }
    wsRef.current = ws;

    ws.onopen = () => {
      ws.send(JSON.stringify({ t: "join", name: nameRef.current }));
    };

    ws.onmessage = (ev) => {
      let msg: { t?: string; [k: string]: unknown };
      try {
        msg = JSON.parse(typeof ev.data === "string" ? ev.data : "");
      } catch {
        return;
      }
      switch (msg.t) {
        case "welcome": {
          const seat = msg.seat as number;
          setMySeat(seat);
          mySeatRef.current = seat;
          setIsHost(Boolean(msg.isHost));
          setStatus("joined");
          break;
        }
        case "full": {
          setStatus("full");
          break;
        }
        case "roster": {
          const seats = (msg.seats as RosterEntry[]) ?? [];
          setRoster(seats);
          // 自分の席のホスト状態を反映（ホスト昇格/降格を追従）。
          const me = mySeatRef.current;
          if (me != null) {
            const mine = seats.find((s) => s.seat === me);
            setIsHost(Boolean(mine?.isHost));
          }
          break;
        }
        case "start": {
          cbRef.current.onStart?.({
            setup: msg.setup as SimSetup,
            startInMs: (msg.startInMs as number) ?? 3000,
          });
          break;
        }
        case "reset": {
          cbRef.current.onReset?.();
          break;
        }
      }
    };

    ws.onerror = () => {
      // full で閉じられる場合は status を上書きしない。
      setStatus((s) => (s === "full" ? s : "error"));
    };

    ws.onclose = () => {
      if (wsRef.current === ws) wsRef.current = null;
      setStatus((s) => (s === "full" ? s : "closed"));
    };
  }, []);

  const sendStart = useCallback((setup: SimSetup, startInMs: number) => {
    const ws = wsRef.current;
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ t: "start", setup, startInMs }));
    }
  }, []);

  const sendReset = useCallback(() => {
    const ws = wsRef.current;
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ t: "reset" }));
    }
  }, []);

  // アンマウントで必ず切断。
  useEffect(() => {
    return () => {
      const ws = wsRef.current;
      wsRef.current = null;
      if (ws) {
        try {
          ws.close();
        } catch {
          /* noop */
        }
      }
    };
  }, []);

  return {
    status,
    mySeat,
    isHost,
    roster: toSeatSlots(roster, mySeat),
    connect,
    disconnect,
    sendStart,
    sendReset,
  };
}
