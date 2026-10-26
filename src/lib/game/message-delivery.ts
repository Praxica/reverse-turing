import type { GameRole } from '@/generated/prisma/client';
import { connectionManager } from './connection-manager';
import type { LabelMapping, SenderLabel } from './types';

/**
 * Streams a finished message to recipients at a uniform character rate.
 * Human answers, LLM answers, and judge questions all go through this
 * pipeline identically, so delivery timing carries no signal.
 */
export async function deliverMessage(params: {
  gameId: string;
  messageId: string;
  content: string;
  senderLabel: SenderLabel;
  streamingDelay: number; // ms per character
  recipients: GameRole[]; // Who should receive the streamed message
}): Promise<void> {
  const { gameId, messageId, content, senderLabel, streamingDelay, recipients } =
    params;

  for (const role of recipients) {
    connectionManager.sendTo(gameId, role, {
      type: 'message-start',
      data: { player: senderLabel, messageId },
    });
  }

  // Stream in chunks of a few characters at the configured rate.
  // A delay of 0 (simulated games) sends the whole message at once.
  const chunkSize = streamingDelay > 0 ? 4 : content.length || 1;
  for (let i = 0; i < content.length; i += chunkSize) {
    const chunk = content.slice(i, i + chunkSize);
    for (const role of recipients) {
      connectionManager.sendTo(gameId, role, {
        type: 'message-chunk',
        data: { messageId, text: chunk },
      });
    }
    if (streamingDelay > 0) await sleep(streamingDelay * chunkSize);
  }

  for (const role of recipients) {
    connectionManager.sendTo(gameId, role, {
      type: 'message-complete',
      data: { messageId },
    });
  }
}

export function getLabelForRole(
  role: GameRole,
  labelMapping: LabelMapping
): 'A' | 'B' {
  if (labelMapping.A === role) return 'A';
  return 'B';
}

/** Display label for any message sender (judge questions show as JUDGE). */
export function getSenderLabel(
  role: GameRole,
  labelMapping: LabelMapping
): SenderLabel {
  if (role === 'JUDGE') return 'JUDGE';
  return getLabelForRole(role, labelMapping);
}

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
