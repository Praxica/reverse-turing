import type { GameStatus, GameRole, GameVerdict } from '@/generated/prisma/client';

// Who a message is displayed as. Participants are anonymized to A/B;
// the judge's questions are shown as JUDGE.
export type SenderLabel = 'A' | 'B' | 'JUDGE';

// Conversation phase within a question round
export type RoundPhase = 'question' | 'answers';

// ─── SSE Event Types ────────────────────────────────────

export type GameEvent =
  | { type: 'player-joined'; data: { role: GameRole; displayName: string } }
  | { type: 'player-disconnected'; data: { role: GameRole } }
  | { type: 'game-status'; data: { status: GameStatus } }
  | { type: 'label-assigned'; data: { label: 'A' | 'B' } }
  | {
      type: 'message-history';
      data: {
        messages: Array<{
          messageId: string;
          player: SenderLabel;
          content: string;
          turnNumber: number;
          notes?: string;
        }>;
      };
    }
  | { type: 'phase'; data: { phase: RoundPhase; turnNumber: number } }
  | { type: 'thinking-start'; data: { player: 'A' | 'B' } }
  | { type: 'thinking-end'; data: { player: 'A' | 'B' } }
  | { type: 'message-start'; data: { player: SenderLabel; messageId: string } }
  | { type: 'message-chunk'; data: { messageId: string; text: string } }
  | { type: 'message-complete'; data: { messageId: string } }
  | { type: 'judge-notes'; data: { messageId: string; notes: string } }
  | { type: 'rematch'; data: { url: string } }
  | { type: 'judging-start'; data: Record<string, never> }
  | {
      type: 'verdict';
      data: {
        verdict: GameVerdict;
        reason: string;
        humanPlayer: 'A' | 'B';
        llmModel: string;
      };
    }
  | { type: 'error'; data: { message: string } }
  | { type: 'ping'; data: Record<string, never> };

// ─── Label Mapping ──────────────────────────────────────

export interface LabelMapping {
  A: GameRole;
  B: GameRole;
}

// ─── Client-side game state ─────────────────────────────

export interface GameMessageUI {
  id: string;
  player: SenderLabel;
  content: string;
  isStreaming: boolean;
  turnNumber: number;
  /** AI judge's case notes for this question, once revealed */
  notes?: string;
}

export interface GameState {
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
}
