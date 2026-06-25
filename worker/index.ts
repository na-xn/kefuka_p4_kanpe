/**
 * Cloudflare Worker エントリ + Durable Object「SessionRoom」。
 *
 * 役割分担（重要）:
 * - Worker fetch: `/api/session/:id/ws` の WebSocket アップグレードを DO へ橋渡し。
 *   それ以外のリクエストは ASSETS（静的 SPA）へフォールバック。
 * - SessionRoom (DO): 「ただのセッション部屋」。席管理とメッセージ中継のみ。
 *   アプリコード（generateSim 等）は一切 import しない。お題はホストクライアントが
 *   生成して `start` で送り、DO は全員へブロードキャストするだけ。
 *
 * WebSocket は Hibernation API を使う（acceptWebSocket + webSocketMessage 等）。
 * 各接続には serializeAttachment で {seat,name} を載せ、ハイバネーション復帰後も
 * 接続→席の対応を復元できるようにする。
 */

import { DurableObject } from "cloudflare:workers";
import {
  lowestFreeSeatForRole,
  hostSeat,
  buildRoster,
  parsePos,
} from "./room-logic";
import type { Seat, Job } from "./room-logic";

export interface Env {
  ASSETS: Fetcher;
  SESSION: DurableObjectNamespace<SessionRoom>;
}

/** 接続に紐づける属性（hibernation を跨いで保持）。 */
type Attachment = { seat: number; name: string };

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    // GET /api/session/:id/ws → DO へ。
    const m = url.pathname.match(/^\/api\/session\/([^/]+)\/ws$/);
    if (m) {
      if (request.headers.get("Upgrade") !== "websocket") {
        return new Response("expected websocket upgrade", { status: 426 });
      }
      const id = env.SESSION.idFromName(decodeURIComponent(m[1]));
      const stub = env.SESSION.get(id);
      return stub.fetch(request);
    }
    // それ以外は静的アセット（SPA）。
    return env.ASSETS.fetch(request);
  },
} satisfies ExportedHandler<Env>;

export class SessionRoom extends DurableObject<Env> {
  /** WebSocket アップグレードを受け、ペアの server 側を accept してハンドシェイクを返す。 */
  override async fetch(_request: Request): Promise<Response> {
    const pair = new WebSocketPair();
    const client = pair[0];
    const server = pair[1];
    // Hibernation API で accept（メッセージは webSocketMessage 等で受ける）。
    this.ctx.acceptWebSocket(server);
    return new Response(null, { status: 101, webSocket: client });
  }

  /** 現在 accept 中の全 WS から占有席リストを復元する（hibernation セーフ）。 */
  private takenSeats(): Seat[] {
    const seats: Seat[] = [];
    for (const ws of this.ctx.getWebSockets()) {
      const att = ws.deserializeAttachment() as Attachment | null;
      if (att && typeof att.seat === "number") {
        seats.push({ seat: att.seat, name: att.name });
      }
    }
    return seats;
  }

  /** 全 WS へ JSON を送る。 */
  private broadcast(msg: unknown): void {
    const json = JSON.stringify(msg);
    for (const ws of this.ctx.getWebSockets()) {
      try {
        ws.send(json);
      } catch {
        /* 送れない接続は無視（close で掃除される） */
      }
    }
  }

  /** sender を除く全 WS へ JSON を送る（エコーしない中継用）。 */
  private broadcastToOthers(sender: WebSocket, msg: unknown): void {
    const json = JSON.stringify(msg);
    for (const ws of this.ctx.getWebSockets()) {
      if (ws === sender) continue;
      try {
        ws.send(json);
      } catch {
        /* 送れない接続は無視（close で掃除される） */
      }
    }
  }

  /** 現在のロスターを全員へブロードキャスト。 */
  private broadcastRoster(): void {
    this.broadcast({ t: "roster", seats: buildRoster(this.takenSeats()) });
  }

  override async webSocketMessage(
    ws: WebSocket,
    message: string | ArrayBuffer,
  ): Promise<void> {
    let msg: { t?: string; [k: string]: unknown };
    try {
      msg = JSON.parse(typeof message === "string" ? message : "");
    } catch {
      return; // 不正な JSON は無視
    }

    const att = ws.deserializeAttachment() as Attachment | null;

    if (msg.t === "join") {
      // 既に席を持っているなら無視（多重 join）。
      if (att) return;
      // 選択ロール（tank/healer/dps）。クライアントは常に有効値を送るが、
      // 不正値は満席扱い（席を割り当てない）で防御する。
      const role = msg.role;
      const validRole =
        role === "tank" || role === "healer" || role === "dps"
          ? (role as Job)
          : null;
      const taken = this.takenSeats().map((s) => s.seat);
      const seat =
        validRole === null ? null : lowestFreeSeatForRole(taken, validRole);
      if (seat === null) {
        // そのロール枠が満席（または不正ロール） → 拒否して閉じる。
        ws.send(JSON.stringify({ t: "full" }));
        ws.close(1013, "session full");
        return;
      }
      const name = typeof msg.name === "string" && msg.name.trim() ? msg.name.trim().slice(0, 24) : `Player${seat + 1}`;
      ws.serializeAttachment({ seat, name } satisfies Attachment);
      // この席がホスト（= 占有中の最小席）か。
      const taken2 = this.takenSeats().map((s) => s.seat);
      const isHost = hostSeat(taken2) === seat;
      ws.send(JSON.stringify({ t: "welcome", seat, isHost }));
      this.broadcastRoster();
      return;
    }

    // 以降は join 済みの接続のみ。
    if (!att) return;

    if (msg.t === "start") {
      // ホスト（最小席）のみ。
      if (hostSeat(this.takenSeats().map((s) => s.seat)) !== att.seat) return;
      this.broadcast({
        t: "start",
        setup: msg.setup,
        startInMs: msg.startInMs,
        kind: msg.kind,
      });
      return;
    }

    if (msg.t === "reset") {
      if (hostSeat(this.takenSeats().map((s) => s.seat)) !== att.seat) return;
      this.broadcast({ t: "reset" });
      return;
    }

    if (msg.t === "pos") {
      // 自席の位置を他の接続へ中継（エコーしない・永続化しない・ホスト判定不要）。
      // 不正な数値は parsePos が弾く。
      const pos = parsePos(msg);
      if (!pos) return;
      this.broadcastToOthers(ws, {
        t: "pos",
        seat: att.seat,
        x: pos.x,
        y: pos.y,
        fx: pos.fx,
        fy: pos.fy,
      });
      return;
    }
  }

  override async webSocketClose(
    ws: WebSocket,
    _code: number,
    _reason: string,
    _wasClean: boolean,
  ): Promise<void> {
    try {
      ws.close();
    } catch {
      /* 既に閉じている */
    }
    // 席は attachment ごと消えるので、残りの接続でロスターを再計算して配る。
    // ホストが抜けた場合は新しい最小席が自動でホストに昇格する。
    this.broadcastRoster();
  }

  override async webSocketError(ws: WebSocket): Promise<void> {
    try {
      ws.close();
    } catch {
      /* noop */
    }
    this.broadcastRoster();
  }
}
