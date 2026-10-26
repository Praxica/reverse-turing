import { NextRequest, NextResponse } from 'next/server';
import { validateParticipantToken } from '@/lib/auth';
import {
  submitHumanAnswer,
  submitJudgeQuestion,
} from '@/lib/game/game-service';

/**
 * POST /api/game/[gameId]/message
 * - JUDGE token: submit the round's question
 * - HUMAN_PLAYER token: submit an answer to the current question
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ gameId: string }> }
) {
  try {
    const { gameId } = await params;
    const body = await request.json();
    const { token, content } = body;

    if (!token || typeof content !== 'string' || !content.trim()) {
      return NextResponse.json(
        { error: 'Token and content are required' },
        { status: 400 }
      );
    }

    const participant = await validateParticipantToken(token);
    if (!participant || participant.gameId !== gameId) {
      return NextResponse.json({ error: 'Invalid token' }, { status: 401 });
    }

    const trimmed = content.trim();

    if (participant.role === 'JUDGE') {
      const { messageId } = await submitJudgeQuestion(gameId, trimmed);
      return NextResponse.json({ success: true, messageId });
    }

    if (participant.role === 'HUMAN_PLAYER') {
      const { messageId } = await submitHumanAnswer(gameId, trimmed);
      return NextResponse.json({ success: true, messageId });
    }

    return NextResponse.json(
      { error: 'This participant cannot send messages' },
      { status: 403 }
    );
  } catch (error) {
    const message =
      error instanceof Error ? error.message : 'Failed to submit message';
    console.error('Failed to submit message:', error);
    return NextResponse.json({ error: message }, { status: 409 });
  }
}
