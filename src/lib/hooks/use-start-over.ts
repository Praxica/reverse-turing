'use client';

import { useCallback, useState } from 'react';

/**
 * Start a new game with the same settings. If the current game is still
 * running it is abandoned. Navigates to the new game on success.
 */
export function useStartOver(gameId: string, token: string) {
  const [isStarting, setIsStarting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const startOver = useCallback(async () => {
    setIsStarting(true);
    setError(null);
    try {
      const res = await fetch(`/api/game/${gameId}/rematch`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token }),
      });
      const body = await res.json();
      if (!res.ok || !body.url) {
        throw new Error(body.error || 'Could not start a new game');
      }
      // Full navigation so the new game starts from a clean client state
      window.location.assign(body.url);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not start a new game');
      setIsStarting(false);
    }
  }, [gameId, token]);

  return { startOver, isStarting, error };
}
