// Beta 4 M25 — Brainstorm tab (§8.6): purple blurb, the gradient
// `Structure timeline into notes` action, the NEEDS FILLING OUT jump list,
// and a mini chat on the SHARED Brainstorm session (M15 / §11).
import { useCallback, useMemo } from 'react';
import type { TimelinesStore } from '../../timelinesTypes';
import { useMiniAgentChat, type MiniChatInvoke } from './useMiniAgentChat';
import MiniAgentChat from './MiniAgentChat';
import { needsFillingOut } from './needsFilling';

export interface BrainstormTabProps {
  store: TimelinesStore;
  activeTimelineId: string;
  /** Jump to a canvas item (NEEDS FILLING OUT click → axis scroll + select). */
  onJumpTo: (itemId: string) => void;
  showToast: (message: string, level?: 'info' | 'warn' | 'error') => void;
}

const invokeBrainstorm: MiniChatInvoke = async (prompt, history) => {
  const api = window.api;
  if (typeof api?.agentBrainstorm !== 'function') {
    throw new Error('Brainstorm agent unavailable — check your provider settings.');
  }
  const response = await api.agentBrainstorm(prompt, history);
  return response.text;
};

/** Compact timeline digest the structure action hands the agent. */
function timelineDigest(store: TimelinesStore, timelineId: string): string {
  const timeline = store.timelines.find((t) => t.id === timelineId);
  const lines: string[] = [`Timeline: ${timeline?.name ?? 'Untitled'}`];
  for (const era of store.eras.filter((e) => e.timelineId === timelineId)) {
    lines.push(`Era: ${era.name}`);
  }
  for (const span of store.spans.filter((s) => s.timelineId === timelineId && !s.rowId)) {
    lines.push(`Span: ${span.name}`);
  }
  for (const event of store.events.filter((e) => e.timelineId === timelineId)) {
    lines.push(`Event: ${event.name}${event.summary ? ` — ${event.summary}` : ''}`);
  }
  return lines.join('\n');
}

export default function BrainstormTab({ store, activeTimelineId, onJumpTo, showToast }: BrainstormTabProps) {
  const chat = useMiniAgentChat('brainstorm', invokeBrainstorm);
  const needs = useMemo(() => needsFillingOut(store, activeTimelineId), [store, activeTimelineId]);

  const structureIntoNotes = useCallback(() => {
    if (chat.busy) return;
    const digest = timelineDigest(store, activeTimelineId);
    showToast('Asked the Brainstorm agent to structure the timeline into notes');
    void chat.send(
      'Look over this timeline and structure it into vault notes — one note per era, span and key event, ' +
        'with what we know so far and what still needs deciding. Then suggest which events to flesh out first.\n\n' +
        digest,
    );
  }, [chat, store, activeTimelineId, showToast]);

  return (
    <div className="trp-stack" data-testid="trp-brainstorm-tab">
      <div className="trp-blurb trp-blurb--brainstorm">
        <div className="trp-blurb-title">Brainstorm Agent — notes keeper</div>
        <div className="trp-blurb-sub">
          Manages your notes. Ask it to look over the timeline and structure all of it into the
          vault, then flesh out the events together in its chat.
        </div>
        <button
          type="button"
          className="trp-grad-btn"
          onClick={structureIntoNotes}
          disabled={chat.busy}
          data-testid="trp-structure-notes"
        >
          Structure timeline into notes
        </button>
      </div>

      <div className="trp-card">
        <div className="trp-label">NEEDS FILLING OUT</div>
        {needs.length === 0 ? (
          <div className="trp-hint" data-testid="trp-needs-empty">
            Nothing thin right now — every event has substance.
          </div>
        ) : (
          <div className="trp-needs" data-testid="trp-needs-list">
            {needs.map((n) => (
              <button
                key={n.id}
                type="button"
                className="trp-need"
                onClick={() => onJumpTo(n.id)}
                title="Jump to it on the timeline"
                data-testid={`trp-need-${n.id}`}
              >
                <span className="trp-need-title">{n.title}</span>
                <span className="trp-need-detail">{n.detail}</span>
              </button>
            ))}
          </div>
        )}
      </div>

      <MiniAgentChat
        chat={chat}
        accent="brainstorm"
        placeholder="Ask about your notes…"
        testidPrefix="trp-brainstorm"
      />
    </div>
  );
}
