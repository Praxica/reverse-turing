import { NextRequest, NextResponse } from 'next/server';
import { validateParticipantToken } from '@/lib/auth';
import { submitVerdict } from '@/lib/game/game-service';

/**
 * POST /api/game/[gameId]/judge - Submit judge's verdict
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ gameId: string }> }
) {
  try {
    const { gameId } = await params;
    const body = await request.json();
    const { token, humanIs, reason } = body;

    if (!token || !humanIs || !reason) {
      return NextResponse.json(
        { error: 'Token, humanIs (A or B), and reason are required' },
        { status: 400 }
      );
    }

    if (humanIs !== 'A' && humanIs !== 'B') {
      return NextResponse.json(
        { error: 'humanIs must be "A" or "B"' },
        { status: 400 }
      );
    }

    const participant = await validateParticipantToken(token);
    if (!participant || participant.gameId !== gameId) {
      return NextResponse.json({ error: 'Invalid token' }, { status: 401 });
    }

    if (participant.role !== 'JUDGE') {
      return NextResponse.json(
        { error: 'Only the judge can submit a verdict' },
        { status: 403 }
      );
    }

    // The service enforces state (JUDGING, or CONVERSATION after the
    // first completed round for an early call) atomically.
    await submitVerdict(gameId, humanIs, reason.trim());

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Failed to submit verdict:', error);
    return NextResponse.json(
      { error: 'Failed to submit verdict' },
      { status: 500 }
    );
  }
}
