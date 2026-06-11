// Save the Cat beat sheet — 15 beats across 3 acts

export type BeatActId = 'setup' | 'confrontation' | 'resolution';

export interface Beat {
  id: string;
  act: BeatActId;
  name: string;
}

export interface ActSection {
  id: BeatActId;
  title: string;
  beats: Beat[];
}

export const BEAT_ACTS: ActSection[] = [
  {
    id: 'setup',
    title: 'Setup',
    beats: [
      { id: 'opening-image', act: 'setup', name: 'Opening Image' },
      { id: 'theme-stated', act: 'setup', name: 'Theme Stated' },
      { id: 'setup', act: 'setup', name: 'Setup' },
      { id: 'catalyst', act: 'setup', name: 'Catalyst' },
      { id: 'debate', act: 'setup', name: 'Debate' },
    ],
  },
  {
    id: 'confrontation',
    title: 'Confrontation',
    beats: [
      { id: 'break-into-2', act: 'confrontation', name: 'Break Into 2' },
      { id: 'b-story', act: 'confrontation', name: 'B Story' },
      { id: 'fun-and-games', act: 'confrontation', name: 'Fun & Games' },
      { id: 'midpoint', act: 'confrontation', name: 'Midpoint' },
      { id: 'bad-guys-close-in', act: 'confrontation', name: 'Bad Guys Close In' },
      { id: 'all-is-lost', act: 'confrontation', name: 'All Is Lost' },
      { id: 'dark-night', act: 'confrontation', name: 'Dark Night of the Soul' },
    ],
  },
  {
    id: 'resolution',
    title: 'Resolution',
    beats: [
      { id: 'break-into-3', act: 'resolution', name: 'Break Into 3' },
      { id: 'finale', act: 'resolution', name: 'Finale' },
      { id: 'final-image', act: 'resolution', name: 'Final Image' },
    ],
  },
];

/** Flat list of all beats in order. */
export const ALL_BEATS: Beat[] = BEAT_ACTS.flatMap((act) => act.beats);
