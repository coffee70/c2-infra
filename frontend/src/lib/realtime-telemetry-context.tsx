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
  source_id: string;
  connected: boolean;
  state?: FeedState;
  last_reception_time: number | string | null;
  approx_rate_hz?: number | null;
}

export interface FeedStatus {
  source_id: string;
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
    source_id: status.source_id,
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
  /** Source/run id for subscription. */
  sourceId: string;
  /** Optional initial state per channel (from API/snapshot). */
  initialChannels?: InitialChannelInput[];
  children: ReactNode;
}

/**
 * Single place for live telemetry subscription and state.
 * Creates one WebSocket client, subscribes to channelNames for sourceId,
 * handles snapshot_watchlist and telemetry_update, and exposes channel state + isLive.
 * Consumers use useRealtimeTelemetry() or useRealtimeChannel(name).
 */
export function RealtimeTelemetryProvider({
  channelNames,
  sourceId,
  initialChannels = [],
  children,
}: RealtimeTelemetryProviderProps) {
  const [client] = useState(() => new RealtimeWsClient());
  const initialChannelState = useMemo(
    () => buildInitialChannelState(initialChannels),
    [initialChannels]
  );
  const currentSourceIdRef = useRef(sourceId);
  const initialChannelStateRef = useRef(initialChannelState);

  useEffect(() => {
    currentSourceIdRef.current = sourceId;
    initialChannelStateRef.current = initialChannelState;
  }, [initialChannelState, sourceId]);

  useEffect(() => {
    setChannelStore((prev) => {
      if (prev.sourceId !== sourceId) {
        return {
          sourceId,
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
        sourceId,
        channelsByName: nextChannelsByName,
      };
    });
  }, [channelNames, initialChannelState, sourceId]);

  const [channelStore, setChannelStore] = useState<{
    sourceId: string;
    channelsByName: Record<string, LiveChannelState>;
  }>(() => ({
    sourceId,
    channelsByName: initialChannelState,
  }));
  const [feedStatusStore, setFeedStatusStore] = useState<{
    sourceId: string;
    feedStatus: FeedStatus | null;
  }>({
    sourceId,
    feedStatus: null,
  });

  const channelsByName =
    channelStore.sourceId === sourceId
      ? channelStore.channelsByName
      : initialChannelState;
  const feedStatus =
    feedStatusStore.sourceId === sourceId ? feedStatusStore.feedStatus : null;

  const isLive = feedStatus?.state === "connected";

  const handleMessage = useCallback(
    (msg: RealtimeMessage) => {
      const activeSourceId = currentSourceIdRef.current;
      if (msg.type === "snapshot_watchlist" && msg.channels) {
        setChannelStore((prev) => {
          const base =
            prev.sourceId === activeSourceId
              ? prev.channelsByName
              : initialChannelStateRef.current;
          const next = { ...base };
          for (const ch of msg.channels) {
            const existing = next[ch.name];
            next[ch.name] = toLiveState(ch, existing?.liveData);
          }
          return {
            sourceId: activeSourceId,
            channelsByName: next,
          };
        });
      } else if (msg.type === "telemetry_update" && msg.channel) {
        const ch = msg.channel;
        setChannelStore((prev) => {
          const base =
            prev.sourceId === activeSourceId
              ? prev.channelsByName
              : initialChannelStateRef.current;
          const existing = base[ch.name];
          const newPoint = { timestamp: ch.generation_time, value: ch.current_value };
          const liveData = existing
            ? [...existing.liveData, newPoint].slice(-100)
            : [newPoint];
          return {
            sourceId: activeSourceId,
            channelsByName: {
              ...base,
              [ch.name]: toLiveState(ch, liveData),
            },
          };
        });
      } else if (msg.type === "feed_status" && msg.source_id === activeSourceId) {
        setFeedStatusStore({
          sourceId: activeSourceId,
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
    client.subscribeWatchlist(channelNames, sourceId);
  }, [client, channelNames, sourceId]);

  useEffect(() => {
    let cancelled = false;

    fetch(`${API_URL}/ops/feed-status?source_id=${encodeURIComponent(sourceId)}`, {
      cache: "no-store",
    })
      .then((r) => (r.ok ? r.json() : null))
      .then((data: FeedStatusResponse | null) => {
        if (!cancelled && data) {
          setFeedStatusStore({
            sourceId,
            feedStatus: normalizeFeedStatus(data),
          });
        }
      })
      .catch(() => {});

    return () => {
      cancelled = true;
    };
  }, [sourceId]);

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
