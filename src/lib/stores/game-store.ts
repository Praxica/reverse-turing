import { create } from 'zustand';
import type { GameStatus, GameRole, GameVerdict } from '@/generated/prisma/client';
import type { GameMessageUI, GameEvent, RoundPhase } from '@/lib/game/types';

interface GameStore {
  // State
  gameId: string | null;
  status: GameStatus | null;
  myRole: GameRole | null;
  myLabel: 'A' | 'B' | null;
  messages: GameMessageUI[];
  phase: { phase: RoundPhase; turnNumber: number } | null;
  thinkingPlayers: Array<'A' | 'B'>;
  verdict: {
    verdict: GameVerdict;
    reason: string;
    humanPlayer: 'A' | 'B';
    llmModel: string;
  } | null;
  connectedRoles: GameRole[];
  isConnected: boolean;
  topic: string | null;
  errorMessage: string | null;
  /** Set when another participant starts a follow-up game */
  rematchUrl: string | null;

  // Actions
  initialize: (params: {
    gameId: string;
    myRole: GameRole;
    status: GameStatus;
    topic?: string;
  }) => void;
  setConnected: (connected: boolean) => void;
  processEvent: (event: GameEvent) => void;
  addLocalMessage: (msg: GameMessageUI) => void;
  endPhaseLocally: () => void;
  reset: () => void;
}

const initialState = {
  gameId: null,
  status: null,
  myRole: null,
  myLabel: null,
  messages: [],
  phase: null,
  thinkingPlayers: [] as Array<'A' | 'B'>,
  verdict: null,
  connectedRoles: [],
  isConnected: false,
  topic: null,
  errorMessage: null,
  rematchUrl: null,
};

export const useGameStore = create<GameStore>((set, get) => ({
  ...initialState,

  initialize: ({ gameId, myRole, status, topic }) => {
    set({
      gameId,
      myRole,
      status,
      topic: topic ?? null,
      messages: [],
    });
  },

  setConnected: (connected) => set({ isConnected: connected }),

  processEvent: (event) => {
    const state = get();

    switch (event.type) {
      case 'player-joined':
        set({
          connectedRoles: [
            ...state.connectedRoles.filter((r) => r !== event.data.role),
            event.data.role,
          ],
        });
        break;

      case 'player-disconnected':
        set({
          connectedRoles: state.connectedRoles.filter(
            (r) => r !== event.data.role
          ),
        });
        break;

      case 'game-status':
        set({ status: event.data.status as GameStatus });
        break;

      case 'label-assigned':
        set({ myLabel: event.data.label });
        break;

      case 'message-history':
        // Full replay from the server (connect/reconnect)
        set({
          messages: event.data.messages.map((m) => ({
            id: m.messageId,
            player: m.player,
            content: m.content,
            isStreaming: false,
            turnNumber: m.turnNumber,
            notes: m.notes,
          })),
        });
        break;

      case 'phase':
        set({
          phase: { phase: event.data.phase, turnNumber: event.data.turnNumber },
        });
        break;

      case 'thinking-start':
        set({
          thinkingPlayers: [
            ...state.thinkingPlayers.filter((p) => p !== event.data.player),
            event.data.player,
          ],
        });
        break;

      case 'thinking-end':
        set({
          thinkingPlayers: state.thinkingPlayers.filter(
            (p) => p !== event.data.player
          ),
        });
        break;

      case 'message-start':
        // Ignore if already present (e.g. replayed via message-history)
        if (state.messages.some((m) => m.id === event.data.messageId)) {
          break;
        }
        set({
          messages: [
            ...state.messages,
            {
              id: event.data.messageId,
              player: event.data.player,
              content: '',
              isStreaming: true,
              turnNumber: state.phase?.turnNumber ?? 0,
            },
          ],
        });
        break;

      case 'message-chunk': {
        set({
          messages: state.messages.map((msg) =>
            // Only append to actively streaming messages — protects
            // completed/replayed messages from duplicate chunks
            msg.id === event.data.messageId && msg.isStreaming
              ? { ...msg, content: msg.content + event.data.text }
              : msg
          ),
        });
        break;
      }

      case 'message-complete':
        set({
          messages: state.messages.map((msg) =>
            msg.id === event.data.messageId
              ? { ...msg, isStreaming: false }
              : msg
          ),
        });
        break;

      case 'judge-notes':
        set({
          messages: state.messages.map((msg) =>
            msg.id === event.data.messageId
              ? { ...msg, notes: event.data.notes }
              : msg
          ),
        });
        break;

      case 'rematch':
        set({ rematchUrl: event.data.url });
        break;

      case 'judging-start':
        set({ status: 'JUDGING', thinkingPlayers: [], phase: null });
        break;

      case 'verdict':
        set({
          verdict: event.data,
          status: 'COMPLETED',
          thinkingPlayers: [],
          phase: null,
        });
        break;

      case 'ping':
        break;

      case 'error':
        console.error('Game error:', event.data.message);
        set({ errorMessage: event.data.message });
        break;
    }
  },

  addLocalMessage: (msg) =>
    set((state) => ({ messages: [...state.messages, msg] })),

  // After submitting, stop showing the input until the next phase event
  endPhaseLocally: () => set({ phase: null }),

  reset: () => set(initialState),
}));
