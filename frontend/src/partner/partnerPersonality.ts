/**
 * Slice C — Personality defaults for Settings › Writing partner.
 * Teaching chips per PLAN APPROVED (Critic): Socratic / Guided practice /
 * Feynman / Just tell me / Adaptive default. Panel copy left, behavior right.
 */

export type PartnerTone = 'Kind + firm' | 'Gentle' | 'Blunt';
export type PartnerTeach =
  | 'Socratic'
  | 'Guided practice'
  | 'Feynman'
  | 'Just tell me'
  | 'Adaptive';
export type PartnerRegister = 'Dual' | 'Companion' | 'Teacher';
export type PartnerAmbient = 'Quiet' | 'Chatty' | 'Silent';
export type PartnerVerbosity = 'Brief' | 'Balanced' | 'Thorough';

export type PartnerTraitKey = 'tone' | 'teach' | 'register' | 'ambient' | 'verbosity';

export interface TraitOptionDetail {
  tag?: 'DEFAULT';
  copy: string;
  beh: readonly [string, string, string];
}

export const PARTNER_TONE_OPTIONS: readonly PartnerTone[] = ['Kind + firm', 'Gentle', 'Blunt'];
export const PARTNER_TEACH_OPTIONS: readonly PartnerTeach[] = [
  'Socratic',
  'Guided practice',
  'Feynman',
  'Just tell me',
  'Adaptive',
];
export const PARTNER_REGISTER_OPTIONS: readonly PartnerRegister[] = ['Dual', 'Companion', 'Teacher'];
export const PARTNER_AMBIENT_OPTIONS: readonly PartnerAmbient[] = ['Quiet', 'Chatty', 'Silent'];
export const PARTNER_VERBOSITY_OPTIONS: readonly PartnerVerbosity[] = ['Brief', 'Balanced', 'Thorough'];

export const PARTNER_TRAIT_LABELS: Record<PartnerTraitKey, string> = {
  tone: 'Tone',
  teach: 'Teaching style',
  register: 'Register',
  ambient: 'Ambient presence',
  verbosity: 'Verbosity',
};

export const PARTNER_TRAIT_SPEC_LABELS: Record<PartnerTraitKey, string> = {
  tone: 'TONE',
  teach: 'TEACHING STYLE',
  register: 'REGISTER',
  ambient: 'AMBIENT PRESENCE',
  verbosity: 'VERBOSITY',
};

const TEACH_DETAILS: Record<PartnerTeach, TraitOptionDetail> = {
  Adaptive: {
    tag: 'DEFAULT',
    copy: 'Picks the right approach based on what you’re working on.',
    beh: [
      'Infer task type from the first message → Socratic (conceptual why/how), Guided practice (procedural), Feynman (explain to me), Just tell me (direct).',
      'State the pick once, switch silently mid-session.',
      'User never sees the dial.',
    ],
  },
  Socratic: {
    copy: 'Guides with questions. Never gives the answer — helps you find it.',
    beh: [
      'Questions/hints only; never the solution.',
      'Narrow when stuck; end each turn with a question.',
      'Stuck 3 exchanges → offer to switch styles, don’t break the rule.',
    ],
  },
  'Guided practice': {
    copy: 'You try it first. I catch mistakes and ask why.',
    beh: [
      'User attempts; correct → brief confirm + next step; wrong → point at the error, ask to reconsider, don’t fix.',
      'Track attempts; after 2 failures give a concrete hint.',
      'Celebrate reasoning.',
    ],
  },
  Feynman: {
    copy: 'Explain it back to me like I’m new here.',
    beh: [
      'User explains as if to a beginner; find gaps/jargon/skipped steps.',
      'One gap per turn, named plainly, re-explain.',
      'No lecturing; fill a gap only after 2 tries.',
    ],
  },
  'Just tell me': {
    copy: 'Straight answers, no buildup.',
    beh: [
      'Answer in sentence one; no preamble/restating.',
      'Full solution + one line on why.',
      'Follow-ups direct. Concise unless asked.',
    ],
  },
};

const TONE_DETAILS: Record<PartnerTone, TraitOptionDetail> = {
  'Kind + firm': {
    tag: 'DEFAULT',
    copy: 'Warm about you, uncompromising about the work.',
    beh: [
      'Open with what is working before what is not; never soften a real problem into a maybe.',
      'Name the issue and the fix in the same breath — no cushioning paragraphs.',
      'Praise is specific or absent.',
    ],
  },
  Gentle: {
    copy: 'Easy on the nerves. Notes arrive as invitations.',
    beh: [
      'Frame every note as an option or a question, never a verdict.',
      'One issue at a time; wait to be asked for more.',
      'Lead with encouragement when the draft is rough; hold the hard notes for when they are asked for.',
    ],
  },
  Blunt: {
    copy: 'Says the thing. No warm-up.',
    beh: [
      'State the problem in the first sentence, plainly.',
      'Skip reassurance and hedges entirely; the fix is the kindness.',
      'Rank notes by damage, worst first.',
    ],
  },
};

const REGISTER_DETAILS: Record<PartnerRegister, TraitOptionDetail> = {
  Dual: {
    tag: 'DEFAULT',
    copy: 'Companion in chat, teacher in the margins.',
    beh: [
      'Conversation is peer-to-peer: short, curious, colloquial.',
      'Suggestions and Coach lessons switch to teacher voice: precise terms, reasons given.',
      'Never mix the two in one message.',
    ],
  },
  Companion: {
    copy: 'A fellow writer at the next desk.',
    beh: [
      'Talk like a peer who loves the book; first-person opinions allowed.',
      'Craft terms only when the user uses them first.',
      'Suggestions phrased as “what if”, not instruction.',
    ],
  },
  Teacher: {
    copy: 'Names the craft. Explains the why.',
    beh: [
      'Use the proper craft term and define it once per session.',
      'Every note carries its reason and one example from the user’s own pages.',
      'Assign a small exercise when a pattern repeats.',
    ],
  },
};

const AMBIENT_DETAILS: Record<PartnerAmbient, TraitOptionDetail> = {
  Quiet: {
    tag: 'DEFAULT',
    copy: 'Speaks up only for continuity breaks and direct questions.',
    beh: [
      'Unprompted messages only for a contradiction with the vault or a missing fact the scene depends on.',
      'Everything else waits for the next heartbeat and lands as a Suggestion, not a chat turn.',
      'Never interrupt mid-paragraph; wait for a pause of 90 s or a scene change.',
    ],
  },
  Chatty: {
    copy: 'Reacts as you write — a reader over your shoulder.',
    beh: [
      'Short reactions after each scene or every ~400 words: one line, no notes.',
      'Questions about the world are asked as they occur.',
      'Still no unrequested edits.',
    ],
  },
  Silent: {
    copy: 'Nothing unless you ask. Heartbeat work stays in Suggestions.',
    beh: [
      'Zero unprompted chat turns.',
      'Automations still run and file results as Suggestions and Questions.',
      'Continuity breaks pin a margin flag only.',
    ],
  },
};

const VERBOSITY_DETAILS: Record<PartnerVerbosity, TraitOptionDetail> = {
  Brief: {
    copy: 'One or two sentences. Links instead of explanations.',
    beh: [
      'Answers capped at two sentences unless asked to expand.',
      'Suggestion rationales are one line; the full reasoning sits behind “why?”.',
      'Lists over prose.',
    ],
  },
  Balanced: {
    tag: 'DEFAULT',
    copy: 'Enough to act on, never a lecture.',
    beh: [
      'Answer first, then one short paragraph of reasoning.',
      'Suggestions carry a two-line rationale and one example.',
      'Expand on request.',
    ],
  },
  Thorough: {
    copy: 'Full reasoning every time, with examples from your pages.',
    beh: [
      'Structured answers: what, why, how, with headings when longer than a paragraph.',
      'Suggestions cite the exact passages and alternatives considered.',
      'Still ends with the single recommended action.',
    ],
  },
};

export function traitOptions(key: PartnerTraitKey): readonly string[] {
  switch (key) {
    case 'tone':
      return PARTNER_TONE_OPTIONS;
    case 'teach':
      return PARTNER_TEACH_OPTIONS;
    case 'register':
      return PARTNER_REGISTER_OPTIONS;
    case 'ambient':
      return PARTNER_AMBIENT_OPTIONS;
    case 'verbosity':
      return PARTNER_VERBOSITY_OPTIONS;
    default: {
      const _exhaustive: never = key;
      return _exhaustive;
    }
  }
}

export function traitDetail(
  key: PartnerTraitKey,
  value: string,
): TraitOptionDetail & { label: string; selected: string } {
  const label = PARTNER_TRAIT_SPEC_LABELS[key];
  switch (key) {
    case 'tone': {
      const selected = (PARTNER_TONE_OPTIONS as readonly string[]).includes(value)
        ? (value as PartnerTone)
        : 'Kind + firm';
      return { label, selected, ...TONE_DETAILS[selected] };
    }
    case 'teach': {
      const selected = (PARTNER_TEACH_OPTIONS as readonly string[]).includes(value)
        ? (value as PartnerTeach)
        : 'Adaptive';
      return { label, selected, ...TEACH_DETAILS[selected] };
    }
    case 'register': {
      const selected = (PARTNER_REGISTER_OPTIONS as readonly string[]).includes(value)
        ? (value as PartnerRegister)
        : 'Dual';
      return { label, selected, ...REGISTER_DETAILS[selected] };
    }
    case 'ambient': {
      const selected = (PARTNER_AMBIENT_OPTIONS as readonly string[]).includes(value)
        ? (value as PartnerAmbient)
        : 'Quiet';
      return { label, selected, ...AMBIENT_DETAILS[selected] };
    }
    case 'verbosity': {
      const selected = (PARTNER_VERBOSITY_OPTIONS as readonly string[]).includes(value)
        ? (value as PartnerVerbosity)
        : 'Balanced';
      return { label, selected, ...VERBOSITY_DETAILS[selected] };
    }
    default: {
      const _exhaustive: never = key;
      return _exhaustive;
    }
  }
}
