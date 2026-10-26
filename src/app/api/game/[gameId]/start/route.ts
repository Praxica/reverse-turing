import { NextRequest, NextResponse } from 'next/server';
import { getAuthenticatedUser } from '@/lib/auth';
import { prisma } from '@/lib/db';
import { startGame } from '@/lib/game/game-service';

/**
 * POST /api/game/[gameId]/start - Force-start game (host only)
 */
export async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ gameId: string }> }
) {
  try {
    const { gameId } = await params;

    const user = await getAuthenticatedUser();
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const game = await prisma.game.findUnique({ where: { id: gameId } });
    if (!game) {
      return NextResponse.json({ error: 'Game not found' }, { status: 404 });
    }

    if (game.hostUserId !== user.id) {
      return NextResponse.json({ error: 'Not the game host' }, { status: 403 });
    }

    if (game.status !== 'LOBBY') {
      return NextResponse.json(
        { error: 'Game has already started' },
        { status: 400 }
      );
    }

    await startGame(gameId);

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Failed to start game:', error);
    return NextResponse.json(
      { error: 'Failed to start game' },
      { status: 500 }
    );
  }
}
