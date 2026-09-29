// Slice E — editable Full Book title block (`bookTitles` per vault+story).
// Soft-FAIL: Google Fonts catalogue picker is OWNER ASK — not invented here.

const STORAGE_KEY = 'mythos:bookTitles';

export type BookTitlesMap = Record<string, string>;

function storageKey(vaultRoot: string, storyId: string): string {
  return `${vaultRoot || 'default'}::${storyId}`;
}

export function loadBookTitles(): BookTitlesMap {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as BookTitlesMap;
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

export function getBookTitle(vaultRoot: string, storyId: string, fallback: string): string {
  const map = loadBookTitles();
  const custom = map[storageKey(vaultRoot, storyId)]?.trim();
  return custom || fallback;
}

export function setBookTitle(vaultRoot: string, storyId: string, title: string): BookTitlesMap {
  const map = loadBookTitles();
  const key = storageKey(vaultRoot, storyId);
  const trimmed = title.trim();
  if (trimmed) map[key] = trimmed;
  else delete map[key];
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(map));
  } catch { /* ignore quota */ }
  return map;
}
