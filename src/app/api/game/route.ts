import { NextRequest, NextResponse } from 'next/server';
import { getAuthenticatedUser } from '@/lib/auth';
import { createGame } from '@/lib/game/game-service';

/**
 * POST /api/game - Create a new game (requires auth)
 */
export async function POST(request: NextRequest) {
  try {
    const user = await getAuthenticatedUser();
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body = await request.json();
    const { topic, model, systemPrompt, maxTurns, streamingDelay, judgeMode, judgeModel, showJudgeNotes } = body;

    if (!model) {
      return NextResponse.json(
        { error: 'Model is required' },
        { status: 400 }
      );
    }

    // Clamp numeric settings to sane ranges (guards NaN from the form too)
    const safeMaxTurns = Number.isFinite(maxTurns)
      ? Math.min(15, Math.max(1, Math.floor(maxTurns)))
      : undefined;
    const safeStreamingDelay = Number.isFinite(streamingDelay)
      ? Math.min(200, Math.max(5, Math.floor(streamingDelay)))
      : undefined;

    const { game, participants } = await createGame({
      hostUserId: user.id,
      topic,
      model,
      systemPrompt,
      maxTurns: safeMaxTurns,
      streamingDelay: safeStreamingDelay,
      judgeMode: judgeMode === 'LLM' ? 'LLM' : 'HUMAN',
      judgeModel,
      showJudgeNotes: judgeMode === 'LLM' && showJudgeNotes === true,
    });

    return NextResponse.json({ game, participants });
  } catch (error) {
    console.error('Failed to create game:', error);
    return NextResponse.json(
      { error: 'Failed to create game' },
      { status: 500 }
    );
  }
}
