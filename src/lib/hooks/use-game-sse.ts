'use client';

import { useEffect, useRef, useCallback } from 'react';
import { useGameStore } from '@/lib/stores/game-store';
import type { GameEvent } from '@/lib/game/types';

export function useGameSSE(gameId: string | null, token: string | null) {
  const eventSourceRef = useRef<EventSource | null>(null);
  const lastEventAt = useRef(0);
  const { processEvent, setConnected } = useGameStore();

  const connect = useCallback(() => {
    if (!gameId || !token) return;

    // Close existing connection
    if (eventSourceRef.current) {
      eventSourceRef.current.close();
    }

    const url = `/api/game/${gameId}/events?token=${encodeURIComponent(token)}`;
    const es = new EventSource(url);
    eventSourceRef.current = es;

    es.onopen = () => {
      setConnected(true);
    };

    es.onerror = () => {
      setConnected(false);
      // EventSource auto-reconnects
    };

    // Keyed by event type so adding a GameEvent without subscribing to
    // it here is a compile error (EventSource drops unlistened events).
    const subscribed: Record<GameEvent['type'], true> = {
      'player-joined': true,
      'player-disconnected': true,
      'game-status': true,
      'label-assigned': true,
      'message-history': true,
      phase: true,
      'thinking-start': true,
      'thinking-end': true,
      'message-start': true,
      'message-chunk': true,
      'message-complete': true,
      'judge-notes': true,
      rematch: true,
      'judging-start': true,
      verdict: true,
      error: true,
      ping: true,
    };
    const eventTypes = Object.keys(subscribed);

    for (const eventType of eventTypes) {
      es.addEventListener(eventType, (e: MessageEvent) => {
        // The browser's own connection-error event shares the name "error"
        // but carries no data; only server-sent events are handled here.
        if (typeof e.data !== 'string') return;
        lastEventAt.current = Date.now();
        try {
          const data = JSON.parse(e.data);
          processEvent({ type: eventType, data } as GameEvent);
        } catch (err) {
          console.error(`Failed to parse SSE event "${eventType}":`, err);
        }
      });
    }
  }, [gameId, token, processEvent, setConnected]);

  useEffect(() => {
    connect();

    // The server pings every 15s. If nothing at all has arrived for a
    // while the stream is dead even if the browser still reports it open,
    // so reconnect; the server replays current state on connect.
    lastEventAt.current = Date.now();
    const watchdog = setInterval(() => {
      if (Date.now() - lastEventAt.current > 40_000) {
        lastEventAt.current = Date.now();
        connect();
      }
    }, 10_000);

    return () => {
      clearInterval(watchdog);
      if (eventSourceRef.current) {
        eventSourceRef.current.close();
        eventSourceRef.current = null;
      }
      setConnected(false);
    };
  }, [connect, setConnected]);

  const reconnect = useCallback(() => {
    connect();
  }, [connect]);

  return { reconnect };
}
