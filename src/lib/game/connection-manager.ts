import type { GameRole } from '@/generated/prisma/client';
import type { GameEvent } from './types';

interface Connection {
  controller: ReadableStreamDefaultController;
  role: GameRole;
  encoder: TextEncoder;
}

/**
 * In-memory SSE connection manager.
 * Tracks active SSE connections per game and provides broadcast/send capabilities.
 *
 * Note: This is a singleton that works for single-server deployments.
 * For multi-server scaling, replace with Redis pub/sub.
 */
class GameConnectionManager {
  private connections = new Map<string, Connection[]>();
  private pingIntervals = new Map<string, NodeJS.Timeout>();

  private getKey(gameId: string): string {
    return gameId;
  }

  register(
    gameId: string,
    role: GameRole,
    controller: ReadableStreamDefaultController
  ): void {
    const key = this.getKey(gameId);
    const connections = this.connections.get(key) ?? [];

    // Remove existing connection for same role (reconnect scenario)
    const filtered = connections.filter((c) => c.role !== role);

    filtered.push({
      controller,
      role,
      encoder: new TextEncoder(),
    });

    this.connections.set(key, filtered);

    // Start ping interval for this game if not already running
    if (!this.pingIntervals.has(key)) {
      const interval = setInterval(() => {
        this.broadcast(gameId, { type: 'ping', data: {} });
      }, 15000);
      this.pingIntervals.set(key, interval);
    }
  }

  unregister(gameId: string, role: GameRole): void {
    const key = this.getKey(gameId);
    const connections = this.connections.get(key);
    if (!connections) return;

    const filtered = connections.filter((c) => c.role !== role);

    if (filtered.length === 0) {
      this.connections.delete(key);
      const interval = this.pingIntervals.get(key);
      if (interval) {
        clearInterval(interval);
        this.pingIntervals.delete(key);
      }
    } else {
      this.connections.set(key, filtered);
    }
  }

  /**
   * Send an event to all connected clients for a game.
   */
  broadcast(gameId: string, event: GameEvent): void {
    const key = this.getKey(gameId);
    const connections = this.connections.get(key);
    if (!connections) return;

    const data = formatSSEMessage(event);
    const deadConnections: GameRole[] = [];

    for (const conn of connections) {
      try {
        conn.controller.enqueue(conn.encoder.encode(data));
      } catch {
        deadConnections.push(conn.role);
      }
    }

    // Clean up dead connections
    for (const role of deadConnections) {
      this.unregister(gameId, role);
    }
  }

  /**
   * Send an event to a specific role in a game.
   */
  sendTo(gameId: string, role: GameRole, event: GameEvent): void {
    const key = this.getKey(gameId);
    const connections = this.connections.get(key);
    if (!connections) return;

    const conn = connections.find((c) => c.role === role);
    if (!conn) return;

    const data = formatSSEMessage(event);
    try {
      conn.controller.enqueue(conn.encoder.encode(data));
    } catch {
      this.unregister(gameId, role);
    }
  }

  /**
   * Send an event to specific roles in a game.
   */
  sendToRoles(gameId: string, roles: GameRole[], event: GameEvent): void {
    for (const role of roles) {
      this.sendTo(gameId, role, event);
    }
  }

  /**
   * Check which roles are currently connected for a game.
   */
  getConnectedRoles(gameId: string): GameRole[] {
    const key = this.getKey(gameId);
    const connections = this.connections.get(key);
    if (!connections) return [];
    return connections.map((c) => c.role);
  }

  /**
   * Check if all required human roles (HUMAN_PLAYER + JUDGE) are connected.
   * LLM_PLAYER is server-side and always "connected".
   */
  isReadyToStart(gameId: string, judgeMode: 'HUMAN' | 'LLM'): boolean {
    const connected = this.getConnectedRoles(gameId);
    const hasHumanPlayer = connected.includes('HUMAN_PLAYER');
    const hasJudge = judgeMode === 'LLM' || connected.includes('JUDGE');
    return hasHumanPlayer && hasJudge;
  }

  /**
   * Clean up all connections for a game.
   */
  cleanup(gameId: string): void {
    const key = this.getKey(gameId);
    const connections = this.connections.get(key);
    if (connections) {
      for (const conn of connections) {
        try {
          conn.controller.close();
        } catch {
          // Already closed
        }
      }
    }
    this.connections.delete(key);
    const interval = this.pingIntervals.get(key);
    if (interval) {
      clearInterval(interval);
      this.pingIntervals.delete(key);
    }
  }
}

function formatSSEMessage(event: GameEvent): string {
  return `event: ${event.type}\ndata: ${JSON.stringify(event.data)}\n\n`;
}

// One instance per server process. Stored on globalThis so a dev-mode code
// reload reuses it; a fresh instance would have no connections, leaving
// open pages looking connected while receiving nothing.
const globalForConnections = globalThis as unknown as {
  gameConnectionManager?: GameConnectionManager;
};
export const connectionManager =
  globalForConnections.gameConnectionManager ?? new GameConnectionManager();
globalForConnections.gameConnectionManager = connectionManager;
