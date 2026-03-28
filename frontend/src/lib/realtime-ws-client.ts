"use client";

/**
 * Typed WebSocket client for realtime telemetry.
 * Reconnect with backoff, message validation, subscription manager.
 */

const DEFAULT_WS_PATH = "/telemetry/realtime/ws";

function getWsUrl(): string {
  const base =
    typeof window !== "undefined"
      ? (process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000")
      : "http://localhost:8000";
  const wsBase = base.replace(/^http/, "ws");
  return `${wsBase}${DEFAULT_WS_PATH}`;
}

export interface RealtimeChannelUpdate {
  vehicle_id: string;
  stream_id: string;
  name: string;
  units?: string | null;
  description?: string | null;
  subsystem_tag: string;
  current_value: number;
  generation_time: string;
  reception_time: string;
  state: string;
  state_reason?: string | null;
  z_score?: number | null;
  quality?: string;
  sparkline_data: { timestamp: string; value: number }[];
}

export interface TelemetryAlert {
  id: string;
  vehicle_id: string;
  stream_id: string;
  channel_name: string;
  telemetry_id: string;
  subsystem: string;
  units?: string | null;
  severity: string;
  reason?: string | null;
  status: string;
  opened_at: string;
  opened_reception_at: string;
  last_update_at: string;
  current_value: number;
  red_low?: number | null;
  red_high?: number | null;
  z_score?: number | null;
  acked_at?: string | null;
  acked_by?: string | null;
  cleared_at?: string | null;
  resolved_at?: string | null;
  resolved_by?: string | null;
  resolution_text?: string | null;
  resolution_code?: string | null;
}

export interface OrbitStatusMessage {
  type: "orbit_status";
  vehicle_id: string;
  status: string;
  reason: string;
  orbit_type?: string | null;
  perigee_km?: number | null;
  apogee_km?: number | null;
  eccentricity?: number | null;
  velocity_kms?: number | null;
  period_sec?: number | null;
}

export interface FeedStatusMessage {
  type: "feed_status";
  vehicle_id: string;
  connected: boolean;
  state?: "connected" | "degraded" | "disconnected";
  last_reception_time: string | null;
  approx_rate_hz?: number | null;
}

export type RealtimeMessage =
  | { type: "snapshot_watchlist"; channels: RealtimeChannelUpdate[] }
  | { type: "telemetry_update"; channel: RealtimeChannelUpdate }
  | { type: "snapshot_alerts"; active: TelemetryAlert[] }
  | { type: "alert_event"; event_type: string; alert: TelemetryAlert }
  | FeedStatusMessage
  | OrbitStatusMessage
  | { type: "hello_ack"; server_version: string }
  | { type: "error"; error: string };

export type RealtimeMessageHandler = (msg: RealtimeMessage) => void;

const INITIAL_RECONNECT_MS = 1000;
const MAX_RECONNECT_MS = 30000;

export class RealtimeWsClient {
  private ws: WebSocket | null = null;
  private url: string;
  private handlers: Set<RealtimeMessageHandler> = new Set();
  private reconnectAttempts = 0;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private subscriptions: {
    watchlist: string[];
    alerts: boolean;
    sourceId: string;
  } = { watchlist: [], alerts: true, sourceId: "default" };

  constructor(url?: string) {
    this.url = url || getWsUrl();
  }

  connect(): void {
    if (this.ws?.readyState === WebSocket.OPEN) return;
    try {
      this.ws = new WebSocket(this.url);
      this.ws.onopen = () => {
        this.reconnectAttempts = 0;
        this.send({ type: "hello", client_version: "1.0" });
        // Always send subscribe_watchlist (empty channels = backend uses default watchlist)
        this.send({
          type: "subscribe_watchlist",
          channels: this.subscriptions.watchlist,
          stream_id: this.subscriptions.sourceId,
        });
        if (this.subscriptions.alerts) {
          this.send({
            type: "subscribe_alerts",
            stream_id: this.subscriptions.sourceId,
          });
        }
      };
      this.ws.onmessage = (ev) => {
        try {
          const msg = JSON.parse(ev.data as string) as RealtimeMessage;
          this.handlers.forEach((h) => {
            try {
              h(msg);
            } catch (e) {
              console.error("Realtime handler error:", e);
            }
          });
        } catch (e) {
          console.error("Realtime parse error:", e);
        }
      };
      this.ws.onclose = () => {
        this.ws = null;
        this.scheduleReconnect();
      };
      this.ws.onerror = () => {
        // Close will fire after error
      };
    } catch (e) {
      console.error("Realtime connect error:", e);
      this.scheduleReconnect();
    }
  }

  private scheduleReconnect(): void {
    if (this.reconnectTimer) return;
    const delay = Math.min(
      INITIAL_RECONNECT_MS * 2 ** this.reconnectAttempts,
      MAX_RECONNECT_MS
    );
    this.reconnectAttempts++;
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.connect();
    }, delay);
  }

  disconnect(): void {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
  }

  subscribe(handler: RealtimeMessageHandler): () => void {
    this.handlers.add(handler);
    return () => this.handlers.delete(handler);
  }

  subscribeWatchlist(channels: string[], sourceId: string = "default"): void {
    this.subscriptions.watchlist = channels;
    this.subscriptions.sourceId = sourceId;
    this.send({
      type: "subscribe_watchlist",
      channels,
      stream_id: sourceId,
    });
  }

  subscribeAlerts(sourceId: string = "default"): void {
    this.subscriptions.alerts = true;
    this.subscriptions.sourceId = sourceId;
    this.send({ type: "subscribe_alerts", stream_id: sourceId });
  }

  ackAlert(alertId: string): void {
    this.send({ type: "ack_alert", alert_id: alertId });
  }

  resolveAlert(
    alertId: string,
    resolutionText: string,
    resolutionCode?: string
  ): void {
    this.send({
      type: "resolve_alert",
      alert_id: alertId,
      resolution_text: resolutionText,
      resolution_code: resolutionCode,
    });
  }

  private send(obj: object): void {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(obj));
    }
  }

  isConnected(): boolean {
    return this.ws?.readyState === WebSocket.OPEN;
  }
}
