import { NextRequest } from 'next/server';
import { validateParticipantToken } from '@/lib/auth';
import { connectionManager } from '@/lib/game/connection-manager';
import { prisma } from '@/lib/db';
import { startGame } from '@/lib/game/game-service';
import { getLabelForRole, getSenderLabel } from '@/lib/game/message-delivery';
import type { GameEvent, LabelMapping } from '@/lib/game/types';

export const runtime = 'nodejs'; // SSE needs long-lived connections
export const dynamic = 'force-dynamic';

/**
 * GET /api/game/[gameId]/events?token=<token> - SSE stream
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ gameId: string }> }
) {
  const { gameId } = await params;
  const token = request.nextUrl.searchParams.get('token');

  if (!token) {
    return new Response('Token required', { status: 401 });
  }

  const participant = await validateParticipantToken(token);
  if (!participant || participant.gameId !== gameId) {
    return new Response('Invalid token', { status: 401 });
  }

  // LLM_PLAYER shouldn't connect via SSE (it's server-side)
  if (participant.role === 'LLM_PLAYER') {
    return new Response('LLM player does not use SSE', { status: 400 });
  }
  const role = participant.role as 'HUMAN_PLAYER' | 'JUDGE';

  const stream = new ReadableStream({
    start(controller) {
      const encoder = new TextEncoder();
      const send = (event: GameEvent) => {
        controller.enqueue(
          encoder.encode(
            `event: ${event.type}\ndata: ${JSON.stringify(event.data)}\n\n`
          )
        );
      };

      // Register connection
      connectionManager.register(gameId, participant.role, controller);

      // Update participant connection status
      prisma.gameParticipant
        .update({
          where: { id: participant.id },
          data: { isConnected: true, joinedAt: new Date() },
        })
        .catch(console.error);

      // Notify others that this player joined
      connectionManager.broadcast(gameId, {
        type: 'player-joined',
        data: {
          role: participant.role,
          displayName: participant.displayName,
        },
      });

      // Initial state sync (also covers reconnects/refreshes)
      syncClientState(gameId, role, send).catch(console.error);

      // Check if game is ready to auto-start
      checkAndStartGame(gameId, participant.game.judgeMode).catch(
        console.error
      );

      // Handle client disconnect
      request.signal.addEventListener('abort', () => {
        connectionManager.unregister(gameId, participant.role);
        prisma.gameParticipant
          .update({
            where: { id: participant.id },
            data: { isConnected: false },
          })
          .catch(console.error);

        connectionManager.broadcast(gameId, {
          type: 'player-disconnected',
          data: { role: participant.role },
        });
      });
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
    },
  });
}

/**
 * Send the connecting client everything it needs to render current state:
 * game status, its label (player only), delivered message history, and
 * the current turn.
 */
async function syncClientState(
  gameId: string,
  role: 'HUMAN_PLAYER' | 'JUDGE',
  send: (event: GameEvent) => void
): Promise<void> {
  const game = await prisma.game.findUnique({
    where: { id: gameId },
    include: {
      messages: { orderBy: [{ turnNumber: 'asc' }, { createdAt: 'asc' }] },
    },
  });
  if (!game) return;

  send({ type: 'game-status', data: { status: game.status } });

  if (!game.labelMapping) return; // Still in lobby — nothing more to sync

  const labelMapping = game.labelMapping as unknown as LabelMapping;

  if (role === 'HUMAN_PLAYER') {
    send({
      type: 'label-assigned',
      data: { label: getLabelForRole('HUMAN_PLAYER', labelMapping) },
    });
  }

  // Replay messages this client is allowed to see: anything fully
  // delivered, their own submissions, and judge questions (questions
  // aren't timing-sensitive, so mid-stream reconnects still get them).
  const ownRole = role;
  const visibleMessages = game.messages.filter(
    (m) =>
      m.deliveredAt !== null ||
      m.senderRole === ownRole ||
      m.senderRole === 'JUDGE'
  );
  // Case notes are revealed only for rounds whose answers are both out
  const revealedRounds = new Set<number>();
  if (game.showJudgeNotes) {
    const delivered = new Map<number, number>();
    for (const m of game.messages) {
      if (m.senderRole !== 'JUDGE' && m.deliveredAt !== null) {
        delivered.set(m.turnNumber, (delivered.get(m.turnNumber) ?? 0) + 1);
      }
    }
    for (const [turn, count] of delivered) {
      if (count >= 2) revealedRounds.add(turn);
    }
  }

  if (visibleMessages.length > 0) {
    send({
      type: 'message-history',
      data: {
        messages: visibleMessages.map((m) => ({
          messageId: m.id,
          player: getSenderLabel(m.senderRole, labelMapping),
          content: m.content,
          turnNumber: m.turnNumber,
          notes:
            m.senderRole === 'JUDGE' &&
            m.privateNotes &&
            revealedRounds.has(m.turnNumber)
              ? m.privateNotes
              : undefined,
        })),
      },
    });
  }

  // A finished game: restore the result too (it is otherwise only sent live)
  if (game.status === 'COMPLETED' && game.verdict) {
    send({
      type: 'verdict',
      data: {
        verdict: game.verdict,
        reason: game.verdictReason ?? '',
        humanPlayer: getLabelForRole('HUMAN_PLAYER', labelMapping),
        llmModel: game.model,
      },
    });
  }

  // Restore round phase mid-conversation.
  // activePlayer doubles as the phase lock: JUDGE = awaiting question,
  // HUMAN_PLAYER = answers phase, null = revealing.
  if (game.status === 'CONVERSATION') {
    if (game.activePlayer === 'JUDGE') {
      send({
        type: 'phase',
        data: { phase: 'question', turnNumber: game.currentTurn },
      });
    } else if (game.activePlayer === 'HUMAN_PLAYER') {
      send({
        type: 'phase',
        data: { phase: 'answers', turnNumber: game.currentTurn },
      });
      if (role === 'JUDGE') {
        send({ type: 'thinking-start', data: { player: 'A' } });
        send({ type: 'thinking-start', data: { player: 'B' } });
      }
    }
  }
}

async function checkAndStartGame(
  gameId: string,
  judgeMode: string
): Promise<void> {
  const game = await prisma.game.findUnique({ where: { id: gameId } });
  if (!game || game.status !== 'LOBBY') return;

  if (
    connectionManager.isReadyToStart(gameId, judgeMode as 'HUMAN' | 'LLM')
  ) {
    // startGame is internally atomic — safe if two connections race here
    await startGame(gameId);
  }
}
