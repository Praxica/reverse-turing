import { NextRequest, NextResponse } from 'next/server';
import { validateParticipantToken } from '@/lib/auth';
import { cancelGame, createRematch } from '@/lib/game/game-service';
import { connectionManager } from '@/lib/game/connection-manager';
import type { GameRole } from '@/generated/prisma/client';

/**
 * POST /api/game/[gameId]/rematch - Start a new game with the same
 * settings, abandoning this one if it is still running. Authorized by a
 * participant token.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ gameId: string }> }
) {
  try {
    const { gameId } = await params;
    const { token } = await request.json();

    const participant = token ? await validateParticipantToken(token) : null;
    if (
      !participant ||
      participant.gameId !== gameId ||
      participant.role === 'LLM_PLAYER'
    ) {
      return NextResponse.json({ error: 'Invalid token' }, { status: 401 });
    }

    const paths = await createRematch(gameId);

    // Invite the other participant, if they are still on the results screen
    for (const [role, url] of Object.entries(paths) as [GameRole, string][]) {
      if (role !== participant.role) {
        connectionManager.sendTo(gameId, role, {
          type: 'rematch',
          data: { url },
        });
      }
    }

    // Starting over mid-game abandons the current one for everybody
    const { status } = participant.game;
    if (status !== 'COMPLETED' && status !== 'CANCELLED') {
      await cancelGame(gameId);
    }

    return NextResponse.json({ url: paths[participant.role] });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : 'Failed to start a new game';
    console.error('Failed to start rematch:', error);
    return NextResponse.json({ error: message }, { status: 409 });
  }
}
