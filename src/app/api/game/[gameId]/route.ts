import { NextRequest, NextResponse } from 'next/server';
import { getAuthenticatedUser, validateParticipantToken } from '@/lib/auth';
import { getGameWithDetails } from '@/lib/game/game-service';

/**
 * GET /api/game/[gameId] - Get game details
 * - Host (Clerk auth): full details including join tokens.
 * - Participant (token query param): sanitized view — no tokens, no
 *   sender roles, no label mapping until the game is COMPLETED.
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ gameId: string }> }
) {
  try {
    const { gameId } = await params;
    const token = request.nextUrl.searchParams.get('token');

    const game = await getGameWithDetails(gameId);
    if (!game) {
      return NextResponse.json({ error: 'Game not found' }, { status: 404 });
    }

    if (token) {
      const participant = await validateParticipantToken(token);
      if (!participant || participant.gameId !== gameId) {
        return NextResponse.json({ error: 'Invalid token' }, { status: 401 });
      }

      // Sanitized view: never leak tokens or who-is-who
      const completed = game.status === 'COMPLETED';
      return NextResponse.json({
        id: game.id,
        topic: game.topic,
        status: game.status,
        maxTurns: game.maxTurns,
        judgeMode: game.judgeMode,
        currentTurn: game.currentTurn,
        labelMapping: completed ? game.labelMapping : undefined,
        verdict: completed ? game.verdict : undefined,
        verdictReason: completed ? game.verdictReason : undefined,
        completedAt: game.completedAt,
      });
    }

    // No token: must be the host
    const user = await getAuthenticatedUser();
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    if (game.hostUserId !== user.id) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    return NextResponse.json(game);
  } catch (error) {
    console.error('Failed to get game:', error);
    return NextResponse.json(
      { error: 'Failed to get game' },
      { status: 500 }
    );
  }
}
