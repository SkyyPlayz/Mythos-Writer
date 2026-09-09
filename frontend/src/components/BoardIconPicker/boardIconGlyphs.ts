// SKY-11190 (Notes Board 7/9, Iconize colour parity): the closed 24-glyph +
// 8-colour set for the Boards icon picker — a deliberately smaller, curated
// alternative to the free-form emoji/lucide/user-svg IconPicker (SKY-194).
// Every name here must resolve in lucideRegistry.ts's LUCIDE_ICONS; a name
// that later falls out of sync (or a corrupted store entry) degrades via
// NodeIcon's existing unknown-name fallback, never a render error.

export const BOARD_ICON_GLYPHS = [
  'book', 'scroll', 'feather', 'crown', 'sword', 'shield',
  'map', 'compass', 'castle', 'mountain', 'wave', 'flame',
  'moon', 'star', 'eye', 'key', 'mask', 'potion',
  'tree', 'ship', 'skull', 'gem', 'bell', 'hourglass',
] as const;

export type BoardIconGlyph = (typeof BOARD_ICON_GLYPHS)[number];

export interface BoardIconColor {
  id: string;
  label: string;
  hex: string;
}

export const BOARD_ICON_COLORS: BoardIconColor[] = [
  { id: 'red', label: 'Red', hex: '#e06c75' },
  { id: 'orange', label: 'Orange', hex: '#e5945a' },
  { id: 'yellow', label: 'Yellow', hex: '#e5c07b' },
  { id: 'green', label: 'Green', hex: '#98c379' },
  { id: 'teal', label: 'Teal', hex: '#56b6a6' },
  { id: 'blue', label: 'Blue', hex: '#61afef' },
  { id: 'purple', label: 'Purple', hex: '#c678dd' },
  { id: 'pink', label: 'Pink', hex: '#d47fb0' },
];

export function iconRefFor(glyph: BoardIconGlyph): string {
  return `pack:lucide/${glyph}`;
}
