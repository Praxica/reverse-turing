'use client';

import { useEffect, useMemo, useRef } from 'react';
import { useGameStore } from '@/lib/stores/game-store';
import type { GameMessageUI } from '@/lib/game/types';
import { ParticipantChip } from './ParticipantChip';
import { WaitingDots } from './WaitingDots';

interface Round {
  question: GameMessageUI | null;
  answers: GameMessageUI[];
}

/** Each judge question opens a round; the answers that follow belong to it. */
function groupIntoRounds(messages: GameMessageUI[]): Round[] {
  const rounds: Round[] = [];
  for (const msg of messages) {
    if (msg.player === 'JUDGE') {
      rounds.push({ question: msg, answers: [] });
    } else {
      if (rounds.length === 0) rounds.push({ question: null, answers: [] });
      rounds[rounds.length - 1].answers.push(msg);
    }
  }
  return rounds;
}

export function GameConversation() {
  const { messages, thinkingPlayers, myRole, myLabel } = useGameStore();
  const scrollRef = useRef<HTMLDivElement>(null);
  const rounds = useMemo(() => groupIntoRounds(messages), [messages]);

  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' });
  }, [messages, thinkingPlayers]);

  const isMine = (player: 'A' | 'B') =>
    myRole === 'HUMAN_PLAYER' && player === myLabel;

  return (
    <div ref={scrollRef} className="min-h-0 flex-1 overflow-y-auto">
      <div className="mx-auto w-full max-w-2xl space-y-12 px-6 py-10">
        {rounds.length === 0 && (
          <p className="flex items-center justify-center gap-3 py-24 text-muted-foreground">
            {myRole === 'JUDGE' ? (
              'Ask your first question to begin.'
            ) : (
              <>
                Waiting for the first question
                <WaitingDots className="translate-y-0.5 opacity-70" />
              </>
            )}
          </p>
        )}

        {rounds.map((round, index) => {
          const isLast = index === rounds.length - 1;
          const pending = isLast
            ? thinkingPlayers.filter(
                (p) => !round.answers.some((a) => a.player === p)
              )
            : [];

          return (
            <section key={round.question?.id ?? `round-${index}`}>
              <p className="text-xs font-medium uppercase tracking-[0.08em] text-muted-foreground">
                Question {index + 1}
              </p>
              {round.question?.notes && (
                <details className="group mt-3 rounded-xl border border-dashed px-4 py-3">
                  <summary className="flex cursor-pointer list-none items-center justify-between text-sm font-medium text-muted-foreground outline-none hover:text-foreground">
                    What the judge was thinking before asking
                    <span className="text-xs group-open:hidden">Show</span>
                    <span className="hidden text-xs group-open:inline">Hide</span>
                  </summary>
                  <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
                    {round.question.notes}
                  </p>
                </details>
              )}
              {round.question && (
                <h2 className="mt-3 text-pretty text-xl font-medium leading-snug">
                  {round.question.content}
                  {round.question.isStreaming && <Caret />}
                </h2>
              )}

              {(round.answers.length > 0 || pending.length > 0) && (
                <div className="mt-5 space-y-3">
                  {round.answers.map((answer) => {
                    const label = answer.player as 'A' | 'B';
                    return (
                      <article
                        key={answer.id}
                        className="flex gap-3.5 rounded-xl border bg-card p-4 shadow-xs"
                      >
                        <ParticipantChip label={label} />
                        <div className="min-w-0 flex-1">
                          <p className="text-xs font-medium text-muted-foreground">
                            Participant {label}
                            {isMine(label) && ' · you'}
                          </p>
                          <p className="mt-1 whitespace-pre-wrap break-words">
                            {answer.content}
                            {answer.isStreaming && <Caret />}
                          </p>
                        </div>
                      </article>
                    );
                  })}

                  {pending.map((player) => (
                    <div
                      key={player}
                      className="flex items-center gap-3.5 rounded-xl border border-dashed p-4"
                    >
                      <ParticipantChip label={player} />
                      <div className="flex items-center gap-2 text-sm text-muted-foreground">
                        <span>Participant {player} is answering</span>
                        <WaitingDots className="opacity-70" />
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </section>
          );
        })}
      </div>
    </div>
  );
}

function Caret() {
  return (
    <span className="ml-0.5 inline-block h-[1.1em] w-[2px] translate-y-[0.2em] animate-pulse bg-foreground/70" />
  );
}
