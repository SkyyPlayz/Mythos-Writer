/**
 * PLAN-058 L7 (FD-4) — Partner quick-command chips (v2.6 §4).
 * Hub partner panel only; Timeline partner tab keeps legacy PARTNER_ACTIONS (L4).
 */

import type { Scene, Story } from '../types';
import type { TimelinesStore } from '../timelinesTypes';
import { refuseUnlessProviderReady } from '../agents/coachInvoke';
import { buildBetaReadSourceText, type BetaScopeOption } from '../beta/textAssembly';
import type { PartnerHandId } from '../agents/partnerIdentity';
import { storyTimelineId } from '../timeline2/notesToTimeline';

/** Same gate as ContinuityPanel / DesktopShell archive panels. */
type ContinuitySettingsSnap = {
  archiveContinuityEnabled?: boolean;
  agents?: { archive?: { enabled?: boolean } };
} | null | undefined;

export function archiveContinuityEnabledFromSettings(
  settings: ContinuitySettingsSnap,
): boolean {
  return (settings?.agents?.archive?.enabled ?? true)
    && (settings?.archiveContinuityEnabled ?? true);
}

export type PartnerQuickCommandId =
  | 'beta-read'
  | 'continuity'
  | 'notes-to-timeline'
  | 'timeline-to-notes';

export const PARTNER_QUICK_COMMANDS: ReadonlyArray<{
  id: PartnerQuickCommandId;
  label: string;
  hand: PartnerHandId;
  description: string;
  color: string;
}> = [
  {
    id: 'beta-read',
    label: 'Beta read',
    hand: 'analyst',
    description: 'Run a beta read and show the report in this thread.',
    color: '#8ad9ff',
  },
  {
    id: 'continuity',
    label: 'Continuity',
    hand: 'archivist',
    description: 'Scan the active scene for story ↔ vault continuity flags.',
    color: '#f5d76e',
  },
  {
    id: 'notes-to-timeline',
    label: 'Notes→timeline',
    hand: 'archivist',
    description: 'Rebuild the story timeline from notes and manuscript.',
    color: '#f5d76e',
  },
  {
    id: 'timeline-to-notes',
    label: 'Timeline→notes',
    hand: 'archivist',
    description: 'Ask the partner to structure the open timeline into vault notes.',
    color: '#9b5fff',
  },
];

/** Default chat prompts for commands that post into the partner thread (60:50 advanced overrides). */
export const DEFAULT_QUICK_COMMAND_PROMPTS: Record<
  Extract<PartnerQuickCommandId, 'timeline-to-notes'>,
  string
> = {
  'timeline-to-notes':
    'Look over this timeline and structure it into vault notes — one note per era, span and key event, ' +
    'with what we know so far and what still needs deciding. Then suggest which events to flesh out first.',
};

export function resolveQuickCommandPrompt(
  id: PartnerQuickCommandId,
  overrides?: Partial<Record<PartnerQuickCommandId, string>>,
): string | null {
  const custom = overrides?.[id]?.trim();
  if (custom) return custom;
  if (id === 'timeline-to-notes') return DEFAULT_QUICK_COMMAND_PROMPTS['timeline-to-notes'];
  return null;
}

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

export type QuickCommandResult =
  | { kind: 'card'; text: string; cardTitle?: string; cardFoot?: string }
  | { kind: 'chat'; text: string };

export async function runPartnerQuickCommand(
  id: PartnerQuickCommandId,
  ctx: {
    scene: Scene | null;
    story: Story | null;
    promptOverrides?: Partial<Record<PartnerQuickCommandId, string>>;
  },
): Promise<QuickCommandResult> {
  const api = window.api;
  switch (id) {
    case 'beta-read': {
      await refuseUnlessProviderReady('betaReader');
      if (!ctx.story) {
        return { kind: 'card', text: 'Open a story first, then run Beta read.', cardTitle: 'Beta read' };
      }
      if (typeof api?.betaReportRun !== 'function') {
        return { kind: 'card', text: 'Beta read is unavailable in this build.', cardTitle: 'Beta read' };
      }
      const scope: BetaScopeOption = ctx.scene
        ? { kind: 'scene', id: ctx.scene.id, label: `Scene: ${ctx.scene.title}` }
        : { kind: 'story', id: ctx.story.id, label: 'Full story' };
      let sourceText = buildBetaReadSourceText(scope, ctx.story);
      if (!sourceText.trim() && ctx.scene) {
        const body = (ctx.scene.blocks ?? [])
          .map((b) => b.content ?? '')
          .filter(Boolean)
          .join('\n\n');
        if (body.trim()) {
          const title = ctx.scene.title.replace(/"/g, "'");
          sourceText = `<<SCENE id="${ctx.scene.id}" title="${title}">>\n${body}\n<</SCENE>>`;
        }
      }
      if (!sourceText.trim()) {
        return {
          kind: 'card',
          text: 'Nothing to read — the selected scope has no scene prose yet.',
          cardTitle: 'Beta read',
          cardFoot: ctx.story.title,
        };
      }
      const focus = { pacing: true, clarity: true, character: true, plot: true };
      const reportScope = { kind: scope.kind, id: scope.id, label: scope.label };
      const res = await api.betaReportRun({
        storyId: ctx.story.id,
        scope: reportScope,
        focus,
        text: sourceText,
      });
      if ('error' in res && res.error) {
        return { kind: 'card', text: res.error, cardTitle: 'Beta read' };
      }
      const report = 'report' in res ? res.report : null;
      const summary = report
        ? (report.feedback?.trim()
          || `Overall ${report.overall.verdict} (${report.overall.score}). ${report.categories.map((c) => `${c.label}: ${c.verdict}`).join(' · ')}`)
        : 'Beta read finished — open Reports for the full write-up.';
      return { kind: 'card', text: summary, cardTitle: 'Beta read', cardFoot: ctx.story.title };
    }
    case 'continuity': {
      if (!ctx.scene) {
        return { kind: 'card', text: 'Open a scene first, then run Continuity.', cardTitle: 'Continuity' };
      }
      const prose = ctx.scene.blocks.map((b) => b.content).join('\n\n');
      if (!prose.trim()) {
        return {
          kind: 'card',
          text: 'This scene has no prose yet — add text, then run Continuity.',
          cardTitle: 'Continuity',
          cardFoot: ctx.scene.title,
        };
      }
      if (typeof api?.archiveScanContinuity !== 'function') {
        return { kind: 'card', text: 'Continuity scan is unavailable in this build.', cardTitle: 'Continuity' };
      }
      const settings = await api.settingsGet?.().catch(() => null);
      if (!archiveContinuityEnabledFromSettings(settings)) {
        const text = settings?.agents?.archive?.enabled === false
          ? 'Archive Agent is disabled. Enable it in Settings.'
          : 'Continuity checking is turned off. Enable it in Settings.';
        return { kind: 'card', text, cardTitle: 'Continuity', cardFoot: ctx.scene.title };
      }
      await api.archiveScanContinuity(ctx.scene.id, prose, 'active_scene', 'story_vault');
      const jobRes = await api.jobs
        ?.enqueue('manuscript-scan', { scope: { level: 'scene', sceneId: ctx.scene.id } })
        .catch(() => ({ error: 'Could not start background scan.' }));
      if (jobRes && typeof jobRes === 'object' && 'error' in jobRes && jobRes.error) {
        return {
          kind: 'card',
          text: `Background scan didn't start — ${String(jobRes.error)}`,
          cardTitle: 'Continuity',
          cardFoot: ctx.scene.title,
        };
      }
      return {
        kind: 'card',
        text: 'Continuity scan started — new flags will appear in the Continuity panel and Suggestions.',
        cardTitle: 'Continuity',
        cardFoot: ctx.scene.title,
      };
    }
    case 'notes-to-timeline': {
      if (typeof api?.timelineRebuild !== 'function') {
        return { kind: 'card', text: 'Timeline rebuild is unavailable in this build.', cardTitle: 'Notes→timeline' };
      }
      const res = await api.timelineRebuild();
      if (!res.ok) {
        return { kind: 'card', text: res.reason ?? 'Could not update the timeline.', cardTitle: 'Notes→timeline' };
      }
      const r = res.report;
      if (!r) {
        return { kind: 'card', text: 'Timeline updated from your notes and manuscript.', cardTitle: 'Notes→timeline' };
      }
      const changed = r.eventsAdded + r.eventsUpdated + r.eventsRemoved;
      const text = changed === 0
        ? `Timeline already up to date — read ${r.scenesRead} scene${r.scenesRead === 1 ? '' : 's'}.`
        : `Added ${r.eventsAdded}, updated ${r.eventsUpdated}, removed ${r.eventsRemoved} from ${r.scenesRead} scene${r.scenesRead === 1 ? '' : 's'}.`;
      return { kind: 'card', text, cardTitle: 'Notes→timeline', cardFoot: `${r.eventsAdded}+ · ${r.eventsUpdated}~ · ${r.eventsRemoved}−` };
    }
    case 'timeline-to-notes': {
      const base = resolveQuickCommandPrompt('timeline-to-notes', ctx.promptOverrides);
      if (!base) {
        return { kind: 'card', text: 'No prompt configured for Timeline→notes.', cardTitle: 'Timeline→notes' };
      }
      if (typeof api?.timelinesGetStore !== 'function') {
        return { kind: 'card', text: 'Timeline is unavailable in this build.', cardTitle: 'Timeline→notes' };
      }
      let store: TimelinesStore;
      try {
        const res = await api.timelinesGetStore();
        store = res.store;
      } catch {
        return { kind: 'card', text: 'Could not load the timeline store.', cardTitle: 'Timeline→notes' };
      }
      const tlId = storyTimelineId(store);
      if (!tlId) {
        return { kind: 'card', text: 'No story timeline yet — open Timeline and create one first.', cardTitle: 'Timeline→notes' };
      }
      const digest = timelineDigest(store, tlId);
      return { kind: 'chat', text: `${base}\n\n${digest}` };
    }
    default: {
      const _exhaustive: never = id;
      return _exhaustive;
    }
  }
}
