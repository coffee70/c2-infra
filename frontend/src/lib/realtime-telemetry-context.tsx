"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import {
  RealtimeWsClient,
  type FeedStatusMessage,
  type RealtimeChannelUpdate,
  type RealtimeMessage,
} from "./realtime-ws-client";

const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";

/** Single channel state: value, timestamp, state, and rolling live points for sparklines. */
export interface LiveChannelState {
  name: string;
  value: number | null;
  lastTimestamp: string | null;
  state: string;
  stateReason: string | null;
  zScore: number | null;
  units?: string | null;
  description?: string | null;
  subsystem_tag: string;
  /** Rolling list of recent points (from stream); cap at 100. */
  liveData: { timestamp: string; value: number }[];
  /** Sparkline from server snapshot; may be replaced by liveData as updates arrive. */
  sparkline_data: { timestamp: string; value: number }[];
}

/** Initial channel shape (from API/snapshot) to seed state. */
export interface InitialChannelInput {
  name: string;
  current_value: number | null;
  last_timestamp: string | null;
  state: string;
  state_reason?: string | null;
  z_score?: number | null;
  units?: string | null;
  description?: string | null;
  subsystem_tag: string;
  sparkline_data?: { timestamp: string; value: number }[];
}

function buildInitialChannelState(
  initialChannels: InitialChannelInput[]
): Record<string, LiveChannelState> {
  const init: Record<string, LiveChannelState> = {};
  for (const ch of initialChannels) {
    init[ch.name] = toLiveState(ch, []);
  }
  return init;
}

function toLiveState(
  ch: RealtimeChannelUpdate | InitialChannelInput,
  liveData?: { timestamp: string; value: number }[]
): LiveChannelState {
  const lastTs = "generation_time" in ch ? ch.generation_time : ch.last_timestamp;
  const value = "current_value" in ch ? ch.current_value : (ch as InitialChannelInput).current_value;
  const state = ch.state;
  const stateReason = "state_reason" in ch ? ch.state_reason ?? null : (ch as InitialChannelInput).state_reason ?? null;
  const zScore = "z_score" in ch ? ch.z_score ?? null : (ch as InitialChannelInput).z_score ?? null;
  const spark =
    ("sparkline_data" in ch ? ch.sparkline_data : (ch as InitialChannelInput).sparkline_data) ?? [];
  return {
    name: ch.name,
    value,
    lastTimestamp: lastTs,
    state,
    stateReason,
    zScore,
    units: "units" in ch ? ch.units : (ch as InitialChannelInput).units,
    description: "description" in ch ? ch.description : (ch as InitialChannelInput).description,
    subsystem_tag: ch.subsystem_tag,
    liveData: liveData ?? [],
    sparkline_data: spark ?? [],
  };
}

type FeedState = "connected" | "degraded" | "disconnected";

interface FeedStatusResponse {
  vehicle_id: string;
  connected: boolean;
  state?: FeedState;
  last_reception_time: number | string | null;
  approx_rate_hz?: number | null;
}

export interface FeedStatus {
  vehicle_id: string;
  connected: boolean;
  state: FeedState;
  last_reception_time: string | null;
  approx_rate_hz: number | null;
}

function deriveFeedState(status: {
  connected: boolean;
  state?: FeedState;
  last_reception_time: number | string | null;
}): FeedState {
  if (status.state) return status.state;
  if (status.connected) return "connected";
  return status.last_reception_time != null ? "degraded" : "disconnected";
}

function normalizeFeedStatus(
  status: FeedStatusMessage | FeedStatusResponse
): FeedStatus {
  const lastReceptionTime =
    typeof status.last_reception_time === "number"
      ? new Date(status.last_reception_time * 1000).toISOString()
      : status.last_reception_time;

  return {
    vehicle_id: status.vehicle_id,
    connected: status.connected,
    state: deriveFeedState(status),
    last_reception_time: lastReceptionTime,
    approx_rate_hz: status.approx_rate_hz ?? null,
  };
}

interface RealtimeTelemetryContextValue {
  /** Channel state by name (always reflects latest from stream or initial). */
  channelsByName: Record<string, LiveChannelState>;
  /** Channels as array (for overview list); order matches subscription order where possible. */
  channelsArray: LiveChannelState[];
  /** Current backend feed health for the active source/run. */
  feedStatus: FeedStatus | null;
  /** True when backend feed health says the active source/run is connected. */
  isLive: boolean;
  /** Raw client for adding extra handlers (e.g. alerts, orbit). May be null before connect. */
  client: RealtimeWsClient | null;
  /** Get state for one channel; returns undefined if not in subscription. */
  getChannel: (name: string) => LiveChannelState | undefined;
}

const RealtimeTelemetryContext = createContext<RealtimeTelemetryContextValue | null>(null);

export interface RealtimeTelemetryProviderProps {
  /** Channel names to subscribe to (watchlist). */
  channelNames: string[];
  /** Logical vehicle id for feed health lookups and status messages. */
  vehicleId: string;
  /** Optional explicit stream/run id for realtime subscription. */
  streamId?: string | null;
  /** Optional initial state per channel (from API/snapshot). */
  initialChannels?: InitialChannelInput[];
  children: ReactNode;
}

/**
 * Single place for live telemetry subscription and state.
 * Creates one WebSocket client, subscribes to channelNames for vehicleId/streamId,
 * handles snapshot_watchlist and telemetry_update, and exposes channel state + isLive.
 * Consumers use useRealtimeTelemetry() or useRealtimeChannel(name).
 */
export function RealtimeTelemetryProvider({
  channelNames,
  vehicleId,
  streamId = null,
  initialChannels = [],
  children,
}: RealtimeTelemetryProviderProps) {
  const [client] = useState(() => new RealtimeWsClient());
  const subscriptionKey = `${vehicleId}::${streamId ?? ""}`;
  const initialChannelState = useMemo(
    () => buildInitialChannelState(initialChannels),
    [initialChannels]
  );
  const [channelStore, setChannelStore] = useState<{
    subscriptionKey: string;
    channelsByName: Record<string, LiveChannelState>;
  }>(() => ({
    subscriptionKey,
    channelsByName: initialChannelState,
  }));
  const [feedStatusStore, setFeedStatusStore] = useState<{
    vehicleId: string;
    feedStatus: FeedStatus | null;
  }>({
    vehicleId,
    feedStatus: null,
  });
  const currentVehicleIdRef = useRef(vehicleId);
  const currentSubscriptionKeyRef = useRef(subscriptionKey);
  const initialChannelStateRef = useRef(initialChannelState);

  useEffect(() => {
    currentVehicleIdRef.current = vehicleId;
    currentSubscriptionKeyRef.current = subscriptionKey;
    initialChannelStateRef.current = initialChannelState;
  }, [initialChannelState, subscriptionKey, streamId, vehicleId]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setChannelStore((prev) => {
        if (prev.subscriptionKey !== subscriptionKey) {
          return {
            subscriptionKey,
            channelsByName: initialChannelState,
          };
        }

        const nextChannelsByName: Record<string, LiveChannelState> = {};
        for (const name of channelNames) {
          const existing = prev.channelsByName[name];
          const initial = initialChannelState[name];
          if (existing) {
            nextChannelsByName[name] = existing;
          } else if (initial) {
            nextChannelsByName[name] = initial;
          }
        }

        const prevNames = Object.keys(prev.channelsByName);
        const nextNames = Object.keys(nextChannelsByName);
        const unchanged =
          prevNames.length === nextNames.length
          && nextNames.every((name) => prev.channelsByName[name] === nextChannelsByName[name]);
        if (unchanged) {
          return prev;
        }

        return {
          subscriptionKey,
          channelsByName: nextChannelsByName,
        };
      });
    }, 0);
    return () => window.clearTimeout(timer);
  }, [channelNames, initialChannelState, subscriptionKey]);

  const channelsByName =
    channelStore.subscriptionKey === subscriptionKey
      ? channelStore.channelsByName
      : initialChannelState;
  const feedStatus =
    feedStatusStore.vehicleId === vehicleId ? feedStatusStore.feedStatus : null;

  const isLive = feedStatus?.state === "connected";

  const handleMessage = useCallback(
    (msg: RealtimeMessage) => {
      const activeVehicleId = currentVehicleIdRef.current;
      const activeSubscriptionKey = currentSubscriptionKeyRef.current;
      if (msg.type === "snapshot_watchlist" && msg.channels) {
        setChannelStore((prev) => {
          const base =
            prev.subscriptionKey === activeSubscriptionKey
              ? prev.channelsByName
              : initialChannelStateRef.current;
          const next = { ...base };
          for (const ch of msg.channels) {
            const existing = next[ch.name];
            next[ch.name] = toLiveState(ch, existing?.liveData);
          }
          return {
            subscriptionKey: activeSubscriptionKey,
            channelsByName: next,
          };
        });
      } else if (msg.type === "telemetry_update" && msg.channel) {
        const ch = msg.channel;
        setChannelStore((prev) => {
          const base =
            prev.subscriptionKey === activeSubscriptionKey
              ? prev.channelsByName
              : initialChannelStateRef.current;
          const existing = base[ch.name];
          const newPoint = { timestamp: ch.generation_time, value: ch.current_value };
          const liveData = existing
            ? [...existing.liveData, newPoint].slice(-100)
            : [newPoint];
          return {
            subscriptionKey: activeSubscriptionKey,
            channelsByName: {
              ...base,
              [ch.name]: toLiveState(ch, liveData),
            },
          };
        });
      } else if (msg.type === "feed_status" && msg.vehicle_id === activeVehicleId) {
        setFeedStatusStore({
          vehicleId: activeVehicleId,
          feedStatus: normalizeFeedStatus(msg),
        });
      }
    },
    []
  );

  useEffect(() => {
    const unsubscribe = client.subscribe(handleMessage);
    client.connect();
    return () => {
      unsubscribe();
      client.disconnect();
    };
  }, [client, handleMessage]);

  useEffect(() => {
    client.subscribeWatchlist(channelNames, vehicleId, streamId);
  }, [client, channelNames, streamId, vehicleId]);

  useEffect(() => {
    let cancelled = false;

    fetch(`${API_URL}/ops/feed-status?vehicle_id=${encodeURIComponent(vehicleId)}`, {
      cache: "no-store",
    })
      .then((r) => (r.ok ? r.json() : null))
      .then((data: FeedStatusResponse | null) => {
        if (!cancelled && data) {
          setFeedStatusStore({
            vehicleId,
            feedStatus: normalizeFeedStatus(data),
          });
        }
      })
      .catch(() => {});

    return () => {
      cancelled = true;
    };
  }, [vehicleId]);

  const channelsArray = useMemo(() => {
    const order = channelNames.length ? channelNames : Object.keys(channelsByName);
    return order.map((name) => channelsByName[name]).filter(Boolean);
  }, [channelNames, channelsByName]);

  const getChannel = useCallback(
    (name: string) => channelsByName[name],
    [channelsByName]
  );

  const value = useMemo<RealtimeTelemetryContextValue>(
    () => ({
      channelsByName,
      channelsArray,
      feedStatus,
      isLive,
      client,
      getChannel,
    }),
    [channelsByName, channelsArray, feedStatus, isLive, client, getChannel]
  );

  return (
    <RealtimeTelemetryContext.Provider value={value}>
      {children}
    </RealtimeTelemetryContext.Provider>
  );
}

export function useRealtimeTelemetry(): RealtimeTelemetryContextValue {
  const ctx = useContext(RealtimeTelemetryContext);
  if (!ctx) {
    throw new Error("useRealtimeTelemetry must be used within RealtimeTelemetryProvider");
  }
  return ctx;
}

/**
 * Optional hook: get state for a single channel. Use inside RealtimeTelemetryProvider.
 * Returns undefined if provider is not mounted or channel not in subscription.
 */
export function useRealtimeChannel(channelName: string): LiveChannelState | undefined {
  const ctx = useContext(RealtimeTelemetryContext);
  return ctx?.getChannel(channelName);
}

/**
 * Optional hook: get client from context to add extra handlers (alerts, orbit).
 * Returns null if provider not mounted or client not yet created.
 */
export function useRealtimeClient(): RealtimeWsClient | null {
  const ctx = useContext(RealtimeTelemetryContext);
  return ctx?.client ?? null;
}

export function useRealtimeFeedStatus(): FeedStatus | null {
  const ctx = useContext(RealtimeTelemetryContext);
  return ctx?.feedStatus ?? null;
}
