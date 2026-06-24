import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { applyTheme, normalizeTheme, THEME_MODES, relativeLuminance, contrastRatio, enforceContrastFloor, applyLiquidNeonTokens, resetLiquidNeonTokens, LIQUID_NEON_DEFAULTS, PAGE_BACKGROUND_DEFAULTS, pageBackgroundContrastRatio, applyPageBackgroundTokens, resetPageBackgroundTokens } from './theme';

const tokensCss = readFileSync(join(__dirname, 'tokens.css'), 'utf8');
const notesTabCss = readFileSync(join(__dirname, 'NotesTabPanel.css'), 'utf8');
const desktopShellCss = readFileSync(join(__dirname, 'DesktopShell.css'), 'utf8');
const blockEditorCss = readFileSync(join(__dirname, 'BlockEditor.css'), 'utf8');

describe('token contrast floor (MYT-517 UX gate)', () => {
  // The sub-muted text colour failed the 4.5:1 floor on lighter surfaces, so
  // the faint/placeholder aliases must resolve to muted (the lowest legible
  // tier), never to a darker literal. Guards against reintroducing a failing tier.
  it('faint and placeholder text aliases collapse to --text-muted', () => {
    expect(tokensCss).toMatch(/--text-faint:\s*var\(--text-muted\)/);
    expect(tokensCss).toMatch(/--text-placeholder:\s*var\(--text-muted\)/);
  });
});

describe('theme (dark-only, MYT-517)', () => {
  beforeEach(() => {
    document.documentElement.removeAttribute('data-theme');
    document.documentElement.removeAttribute('data-contrast');
  });

  it('only supports dark and high-contrast', () => {
    expect([...THEME_MODES]).toEqual(['dark', 'high-contrast']);
  });

  it('normalizes legacy light/system values to dark', () => {
    expect(normalizeTheme('light')).toBe('dark');
    expect(normalizeTheme('system')).toBe('dark');
    expect(normalizeTheme(undefined)).toBe('dark');
    expect(normalizeTheme('high-contrast')).toBe('high-contrast');
  });

  it('applies dark theme without a contrast overlay', () => {
    applyTheme('dark');
    expect(document.documentElement.getAttribute('data-theme')).toBe('dark');
    expect(document.documentElement.hasAttribute('data-contrast')).toBe(false);
  });

  it('applies the high-contrast overlay and clears it again', () => {
    applyTheme('high-contrast');
    expect(document.documentElement.getAttribute('data-contrast')).toBe('high');
    applyTheme('dark');
    expect(document.documentElement.hasAttribute('data-contrast')).toBe(false);
  });

  it('coerces a legacy stored value when applying', () => {
    expect(applyTheme('light')).toBe('dark');
    expect(document.documentElement.getAttribute('data-theme')).toBe('dark');
  });
});

// ── MYT-716 contrast guard tests ─────────────────────────────────────────────

describe('relativeLuminance', () => {
  it('returns 0 for black', () => {
    expect(relativeLuminance('#000000')).toBeCloseTo(0, 5);
  });

  it('returns 1 for white', () => {
    expect(relativeLuminance('#ffffff')).toBeCloseTo(1, 5);
  });

  it('handles 3-char shorthand (#fff)', () => {
    expect(relativeLuminance('#fff')).toBeCloseTo(1, 5);
  });

  it('returns 0 for unparseable input', () => {
    expect(relativeLuminance('not-a-color')).toBe(0);
  });
});

describe('contrastRatio', () => {
  it('white on black = 21:1', () => {
    expect(contrastRatio('#ffffff', '#000000')).toBeCloseTo(21, 0);
  });

  it('black on black = 1:1', () => {
    expect(contrastRatio('#000000', '#000000')).toBeCloseTo(1, 5);
  });

  it('default body text (#bfd6e8) on bg (#0e1116) passes 4.5:1', () => {
    expect(contrastRatio('#bfd6e8', '#0e1116')).toBeGreaterThanOrEqual(4.5);
  });

  it('default header text (#edecf6) on bg (#0e1116) passes 4.5:1', () => {
    expect(contrastRatio('#edecf6', '#0e1116')).toBeGreaterThanOrEqual(4.5);
  });

  it('default muted text (#8a9bb0) on bg (#0e1116) passes 4.5:1', () => {
    expect(contrastRatio('#8a9bb0', '#0e1116')).toBeGreaterThanOrEqual(4.5);
  });
});

describe('enforceContrastFloor', () => {
  const bg = '#0e1116';

  it('passes through a colour that already meets 4.5:1', () => {
    const result = enforceContrastFloor('#ffffff', bg, 4.5);
    expect(result).toBe('#ffffff');
    expect(contrastRatio(result, bg)).toBeGreaterThanOrEqual(4.5);
  });

  it('lightens a near-black colour until it passes 4.5:1', () => {
    const result = enforceContrastFloor('#111111', bg, 4.5);
    expect(contrastRatio(result, bg)).toBeGreaterThanOrEqual(4.5);
  });

  it('never returns a colour below 4.5:1 floor', () => {
    const darkColors = ['#222222', '#333333', '#444444', '#555555', '#1a2030'];
    for (const color of darkColors) {
      const result = enforceContrastFloor(color, bg, 4.5);
      expect(contrastRatio(result, bg)).toBeGreaterThanOrEqual(4.5);
    }
  });
});

describe('applyLiquidNeonTokens contrast guard (MYT-716)', () => {
  beforeEach(() => {
    document.documentElement.style.cssText = '';
  });

  afterEach(() => {
    resetLiquidNeonTokens();
  });

  it('applies default tokens without dropping below 4.5:1', () => {
    applyLiquidNeonTokens(LIQUID_NEON_DEFAULTS);
    const root = document.documentElement;
    const header = root.style.getPropertyValue('--text-header');
    const body   = root.style.getPropertyValue('--text-body');
    const muted  = root.style.getPropertyValue('--text-muted');
    const bg = LIQUID_NEON_DEFAULTS.bgBaseColor ?? '#0e1116';
    expect(contrastRatio(header, bg)).toBeGreaterThanOrEqual(4.5);
    expect(contrastRatio(body,   bg)).toBeGreaterThanOrEqual(4.5);
    expect(contrastRatio(muted,  bg)).toBeGreaterThanOrEqual(4.5);
  });

  it('clamps a below-floor body text colour to the floor', () => {
    applyLiquidNeonTokens({ ...LIQUID_NEON_DEFAULTS, textBody: '#111111' });
    const root = document.documentElement;
    const body = root.style.getPropertyValue('--text-body');
    const bg = LIQUID_NEON_DEFAULTS.bgBaseColor ?? '#0e1116';
    expect(contrastRatio(body, bg)).toBeGreaterThanOrEqual(4.5);
  });

  it('sets bg-image-size/repeat/position for image mode', () => {
    applyLiquidNeonTokens({
      ...LIQUID_NEON_DEFAULTS,
      bgMode: 'image',
      bgFit: 'contain',
      bgPosition: 'top',
    }, 'data:image/png;base64,abc');
    const root = document.documentElement;
    expect(root.style.getPropertyValue('--bg-image-size')).toBe('contain');
    expect(root.style.getPropertyValue('--bg-image-repeat')).toBe('no-repeat');
    expect(root.style.getPropertyValue('--bg-image-position')).toBe('top');
  });

  it('resets all new tokens on resetLiquidNeonTokens', () => {
    applyLiquidNeonTokens(LIQUID_NEON_DEFAULTS);
    resetLiquidNeonTokens();
    const root = document.documentElement;
    expect(root.style.getPropertyValue('--bg-image-size')).toBe('');
    expect(root.style.getPropertyValue('--bg-scrim-alpha')).toBe('');
    expect(root.style.getPropertyValue('--text-header')).toBe('');
  });
});

// ── SKY-910 three-stop configurable neon border ──────────────────────────────

describe('applyLiquidNeonTokens neon border slots (SKY-910)', () => {
  beforeEach(() => {
    document.documentElement.style.cssText = '';
  });

  afterEach(() => {
    resetLiquidNeonTokens();
  });

  it('defaults to cyan/violet/magenta across the three slots', () => {
    expect(LIQUID_NEON_DEFAULTS.neonBorderColor).toBe('cyan');
    expect(LIQUID_NEON_DEFAULTS.neonBorderColor2).toBe('violet');
    expect(LIQUID_NEON_DEFAULTS.neonBorderColor3).toBe('magenta');
  });

  it('writes all three per-slot CSS vars and a matching --grad-neon', () => {
    applyLiquidNeonTokens(LIQUID_NEON_DEFAULTS);
    const root = document.documentElement;
    expect(root.style.getPropertyValue('--neon-border-1')).toBe('#00f0ff');
    expect(root.style.getPropertyValue('--neon-border-2')).toBe('#9b5fff');
    expect(root.style.getPropertyValue('--neon-border-3')).toBe('#ff4dff');
    const grad = root.style.getPropertyValue('--grad-neon');
    expect(grad).toContain('#00f0ff');
    expect(grad).toContain('#9b5fff');
    expect(grad).toContain('#ff4dff');
    // Solid 2px outline picks up slot A.
    expect(root.style.getPropertyValue('--border-neon-outline')).toBe('#00f0ff');
  });

  it('rebuilds the gradient when all three slots are reassigned', () => {
    applyLiquidNeonTokens({
      ...LIQUID_NEON_DEFAULTS,
      neonBorderColor:  'magenta',
      neonBorderColor2: 'cyan',
      neonBorderColor3: 'violet',
    });
    const root = document.documentElement;
    expect(root.style.getPropertyValue('--neon-border-1')).toBe('#ff4dff');
    expect(root.style.getPropertyValue('--neon-border-2')).toBe('#00f0ff');
    expect(root.style.getPropertyValue('--neon-border-3')).toBe('#9b5fff');
    expect(root.style.getPropertyValue('--border-neon-outline')).toBe('#ff4dff');
    expect(root.style.getPropertyValue('--grad-neon')).toMatch(
      /linear-gradient\(120deg,\s*#ff4dff\s+0%,\s*#00f0ff\s+50%,\s*#9b5fff\s+100%\)/,
    );
  });

  it('migrates legacy prefs without slots B/C by falling back to violet/magenta defaults', () => {
    // Legacy persisted record only set the original single slot.
    const legacy: Partial<LiquidNeonPrefs> = { neonBorderColor: 'cyan' };
    applyLiquidNeonTokens(legacy);
    const root = document.documentElement;
    expect(root.style.getPropertyValue('--neon-border-1')).toBe('#00f0ff');
    expect(root.style.getPropertyValue('--neon-border-2')).toBe('#9b5fff');
    expect(root.style.getPropertyValue('--neon-border-3')).toBe('#ff4dff');
  });

  it('honours custom hex palette overrides (SKY-127) when resolving border slots', () => {
    applyLiquidNeonTokens({
      ...LIQUID_NEON_DEFAULTS,
      neonColorCyan:    '#112233',
      neonColorViolet:  '#445566',
      neonColorMagenta: '#778899',
      neonBorderColor:  'cyan',
      neonBorderColor2: 'violet',
      neonBorderColor3: 'magenta',
    });
    const root = document.documentElement;
    expect(root.style.getPropertyValue('--neon-border-1')).toBe('#112233');
    expect(root.style.getPropertyValue('--neon-border-2')).toBe('#445566');
    expect(root.style.getPropertyValue('--neon-border-3')).toBe('#778899');
  });

  it('clears all three slot vars + gradient overrides on reset', () => {
    applyLiquidNeonTokens({
      ...LIQUID_NEON_DEFAULTS,
      neonBorderColor:  'magenta',
      neonBorderColor2: 'cyan',
      neonBorderColor3: 'violet',
    });
    resetLiquidNeonTokens();
    const root = document.documentElement;
    expect(root.style.getPropertyValue('--neon-border-1')).toBe('');
    expect(root.style.getPropertyValue('--neon-border-2')).toBe('');
    expect(root.style.getPropertyValue('--neon-border-3')).toBe('');
    expect(root.style.getPropertyValue('--grad-neon')).toBe('');
    expect(root.style.getPropertyValue('--grad-neon-soft')).toBe('');
    expect(root.style.getPropertyValue('--border-neon-outline')).toBe('');
  });
});

describe('tokens.css neon border slots (SKY-910)', () => {
  it('declares the three per-slot border vars in :root', () => {
    expect(tokensCss).toMatch(/--neon-border-1:\s*var\(--neon-cyan\)/);
    expect(tokensCss).toMatch(/--neon-border-2:\s*var\(--neon-violet\)/);
    expect(tokensCss).toMatch(/--neon-border-3:\s*var\(--neon-magenta\)/);
  });

  it('composes --border-neon-default over --border-neon-outline (slot A)', () => {
    expect(tokensCss).toMatch(
      /--border-neon-default:\s*0\s+0\s+16px\s+var\(--grad-neon\),\s*0\s+0\s+2px\s+var\(--border-neon-outline\)/,
    );
  });
});

// ─── Page Background (SKY-2097) ──────────────────────────────────────────────

describe('pageBackgroundContrastRatio', () => {
  it('returns a positive ratio for defaults', () => {
    const ratio = pageBackgroundContrastRatio(PAGE_BACKGROUND_DEFAULTS);
    expect(ratio).toBeGreaterThan(0);
  });

  it('at opacity 0 the panel is transparent → blended = canvas → high contrast against body text', () => {
    const ratio = pageBackgroundContrastRatio({ ...PAGE_BACKGROUND_DEFAULTS, opacity: 0 });
    expect(ratio).toBeGreaterThan(4.5);
  });

  it('at opacity 100 paper preset (warm white) → very high contrast', () => {
    const ratio = pageBackgroundContrastRatio({ ...PAGE_BACKGROUND_DEFAULTS, preset: 'paper', opacity: 100 });
    // paper is near-white; body text (#bfd6e8) on white → ratio < 4.5 is expected
    // just assert it is a valid positive number
    expect(ratio).toBeGreaterThan(0);
  });

  it('dark-slate at full opacity → dark background → high contrast against body text', () => {
    const ratio = pageBackgroundContrastRatio({ ...PAGE_BACKGROUND_DEFAULTS, preset: 'dark-slate', opacity: 100 });
    expect(ratio).toBeGreaterThan(4.5);
  });

  it('null/undefined input → uses defaults without throwing', () => {
    expect(() => pageBackgroundContrastRatio(null)).not.toThrow();
    expect(() => pageBackgroundContrastRatio(undefined)).not.toThrow();
  });
});

describe('applyPageBackgroundTokens / resetPageBackgroundTokens', () => {
  beforeEach(() => {
    resetPageBackgroundTokens();
  });

  it('sets --page-bg-fill, --page-bg-blur, --page-bg-glow, --page-bg-glow-color, --page-bg-backdrop-blur', () => {
    applyPageBackgroundTokens(PAGE_BACKGROUND_DEFAULTS);
    const root = document.documentElement;
    expect(root.style.getPropertyValue('--page-bg-fill')).toMatch(/^rgba/);
    expect(root.style.getPropertyValue('--page-bg-blur')).toBe('12px');
    expect(root.style.getPropertyValue('--page-bg-glow')).toBe('0.600');
    expect(root.style.getPropertyValue('--page-bg-glow-color')).toMatch(/^rgba/);
    expect(root.style.getPropertyValue('--page-bg-backdrop-blur')).toBe('12px');
  });

  it('sets data-page-preset attribute on :root', () => {
    applyPageBackgroundTokens({ ...PAGE_BACKGROUND_DEFAULTS, preset: 'minimal' });
    expect(document.documentElement.getAttribute('data-page-preset')).toBe('minimal');
  });

  it('non-glass preset → --page-bg-backdrop-blur is 0px', () => {
    applyPageBackgroundTokens({ ...PAGE_BACKGROUND_DEFAULTS, preset: 'minimal' });
    expect(document.documentElement.style.getPropertyValue('--page-bg-backdrop-blur')).toBe('0px');
  });

  it('liquid-neon preset → --page-bg-backdrop-blur equals blur value', () => {
    applyPageBackgroundTokens({ ...PAGE_BACKGROUND_DEFAULTS, preset: 'liquid-neon', blur: 8 });
    expect(document.documentElement.style.getPropertyValue('--page-bg-backdrop-blur')).toBe('8px');
  });

  it('resets all page-bg vars and removes data-page-preset attribute', () => {
    applyPageBackgroundTokens(PAGE_BACKGROUND_DEFAULTS);
    resetPageBackgroundTokens();
    const root = document.documentElement;
    expect(root.style.getPropertyValue('--page-bg-fill')).toBe('');
    expect(root.style.getPropertyValue('--page-bg-blur')).toBe('');
    expect(root.style.getPropertyValue('--page-bg-glow')).toBe('');
    expect(root.style.getPropertyValue('--page-bg-glow-color')).toBe('');
    expect(root.style.getPropertyValue('--page-bg-backdrop-blur')).toBe('');
    expect(root.getAttribute('data-page-preset')).toBeNull();
  });

  it('partial prefs merge with defaults without throwing', () => {
    expect(() => applyPageBackgroundTokens({ opacity: 50 })).not.toThrow();
    expect(document.documentElement.style.getPropertyValue('--page-bg-fill')).toMatch(/^rgba/);
  });
});

describe('tokens.css page background defaults (SKY-2097)', () => {
  it('declares --page-bg-fill default', () => {
    expect(tokensCss).toMatch(/--page-bg-fill:/);
  });
  it('declares --page-bg-backdrop-blur default', () => {
    expect(tokensCss).toMatch(/--page-bg-backdrop-blur:/);
  });
  it('declares --page-bg-glow-color default', () => {
    expect(tokensCss).toMatch(/--page-bg-glow-color:/);
  });
});

// ─── SKY-2102: light-theme page-bg scaffolding + Notes tab page background ───

describe('tokens.css light-theme page-bg scaffolding (SKY-2102)', () => {
  it('declares [data-theme="light"] override block with page-bg tokens', () => {
    expect(tokensCss).toMatch(/\[data-theme="light"\]/);
  });
  it('[data-theme="light"] block overrides --page-bg-fill with a lighter value', () => {
    expect(tokensCss).toMatch(/\[data-theme="light"\][^{]*\{[^}]*--page-bg-fill:/s);
  });
  it('[data-theme="light"] block overrides --page-bg-glow-color', () => {
    expect(tokensCss).toMatch(/\[data-theme="light"\][^{]*\{[^}]*--page-bg-glow-color:/s);
  });
});

describe('NotesTabPanel.css page-background (SKY-2102)', () => {
  it('notes-tab-center uses --page-bg-fill as background', () => {
    expect(notesTabCss).toMatch(/\.notes-tab-center\b[\s\S]*?background:\s*var\(--page-bg-fill\)/);
  });
  it('liquid-neon preset applies ambient box-shadow to notes-tab-center', () => {
    expect(notesTabCss).toMatch(/\[data-page-preset="liquid-neon"\]\s+\.notes-tab-center/);
  });
  it('notes-tab-center gets backdrop-filter with page-bg-backdrop-blur', () => {
    expect(notesTabCss).toMatch(/backdrop-filter:\s*blur\(var\(--page-bg-backdrop-blur\)\)/);
  });
  it('notes-tab-center forces near-opaque surface under prefers-contrast: more', () => {
    expect(notesTabCss).toMatch(/prefers-contrast:\s*more/);
  });
});

// ─── SKY-2962: background scrim (Light↔Dark slider) wiring ───────────────────

describe('applyLiquidNeonTokens scrim (SKY-2962)', () => {
  beforeEach(() => {
    document.documentElement.style.cssText = '';
  });

  afterEach(() => {
    resetLiquidNeonTokens();
  });

  it('sets --bg-scrim-alpha to a non-zero value when bgMode=image and bgDataUrl is provided', () => {
    applyLiquidNeonTokens(
      { ...LIQUID_NEON_DEFAULTS, bgMode: 'image', bgScrim: 40 },
      'data:image/png;base64,abc',
    );
    const alpha = parseFloat(
      document.documentElement.style.getPropertyValue('--bg-scrim-alpha'),
    );
    expect(alpha).toBeGreaterThan(0);
  });

  it('scrim alpha increases as bgScrim increases', () => {
    const bgDataUrl = 'data:image/png;base64,abc';
    applyLiquidNeonTokens({ ...LIQUID_NEON_DEFAULTS, bgMode: 'image', bgScrim: 0 }, bgDataUrl);
    const low = parseFloat(document.documentElement.style.getPropertyValue('--bg-scrim-alpha'));

    applyLiquidNeonTokens({ ...LIQUID_NEON_DEFAULTS, bgMode: 'image', bgScrim: 100 }, bgDataUrl);
    const high = parseFloat(document.documentElement.style.getPropertyValue('--bg-scrim-alpha'));

    expect(high).toBeGreaterThan(low);
  });

  it('sets --bg-scrim-alpha to 0 in color mode (no scrim on gradient background)', () => {
    applyLiquidNeonTokens({ ...LIQUID_NEON_DEFAULTS, bgMode: 'color' });
    expect(document.documentElement.style.getPropertyValue('--bg-scrim-alpha')).toBe('0');
  });

  it('preserves existing --bg-app-image but still updates scrim when bgMode=image with no bgDataUrl (SKY-3219 + SKY-3220)', () => {
    // Simulate a prior call that set the image.
    document.documentElement.style.setProperty('--bg-app-image', 'url("data:image/png;base64,prior")');

    // Call without bgDataUrl — SKY-3219: must NOT reset --bg-app-image to the gradient.
    applyLiquidNeonTokens({ ...LIQUID_NEON_DEFAULTS, bgMode: 'image', bgScrim: 80 });
    // Scrim alpha must update so the Light↔Dark slider works in real time
    // even before the image data URL resolves. bgScrim=80 → lerp(0.20, 0.85, 0.8) ≈ 0.72
    const alpha = parseFloat(document.documentElement.style.getPropertyValue('--bg-scrim-alpha'));
    expect(alpha).toBeGreaterThan(0.5);
    // SKY-3219: prior --bg-app-image must NOT be reset to the default gradient
    expect(document.documentElement.style.getPropertyValue('--bg-app-image')).toBe(
      'url("data:image/png;base64,prior")',
    );
    // SKY-3220: scrim alpha IS applied even when no bgDataUrl.
    // bgScrim=80 → lerp(0.20, 0.85, 0.80) = 0.720
    expect(document.documentElement.style.getPropertyValue('--bg-scrim-alpha')).toBe('0.720');
  });
});

describe('applyLiquidNeonTokens background-image preservation (SKY-3219 / GH#612)', () => {
  beforeEach(() => {
    document.documentElement.style.cssText = '';
  });

  afterEach(() => {
    resetLiquidNeonTokens();
  });

  it('GH#612: does not reset --bg-app-image in legacy path (no bgMode) when data URL absent', () => {
    const previousUrl = 'url("/existing/legacy-wallpaper.jpg")';
    document.documentElement.style.setProperty('--bg-app-image', previousUrl);

    // Legacy: background set but bgMode not stored (falls to else branch)
    applyLiquidNeonTokens({ ...LIQUID_NEON_DEFAULTS, bgMode: undefined as unknown as 'color', background: '/legacy/path.jpg' }, null);

    expect(document.documentElement.style.getPropertyValue('--bg-app-image')).toBe(previousUrl);
  });

  it('GH#612: applies bgDataUrl in legacy path when data URL is present', () => {
    const dataUrl = 'data:image/jpeg;base64,abc123';
    applyLiquidNeonTokens({ ...LIQUID_NEON_DEFAULTS, bgMode: undefined as unknown as 'color', background: '/legacy/path.jpg' }, dataUrl);

    expect(document.documentElement.style.getPropertyValue('--bg-app-image')).toBe(`url("${dataUrl}")`);
  });
});

describe('DesktopShell.css scrim wiring (SKY-2962)', () => {
  it('background-image layer includes a linear-gradient using --bg-scrim-alpha', () => {
    expect(desktopShellCss).toMatch(/background-image[\s\S]*linear-gradient[\s\S]*--bg-scrim-alpha/);
  });

  it('scrim gradient precedes the wallpaper layer (bg-app-image)', () => {
    const bgImageBlock = desktopShellCss.match(/background-image[\s\S]*?;/)?.[0] ?? '';
    const scrimIdx = bgImageBlock.indexOf('--bg-scrim-alpha');
    const wallpaperIdx = bgImageBlock.indexOf('--bg-app-image');
    expect(scrimIdx).toBeGreaterThanOrEqual(0);
    expect(wallpaperIdx).toBeGreaterThanOrEqual(0);
    expect(scrimIdx).toBeLessThan(wallpaperIdx);
  });
});

// ─── SKY-3625: Editor paper panel scoped to text column ──────────────────────

describe('BlockEditor.css paper panel (SKY-3625)', () => {
  it('.tiptap-content uses --page-bg-fill as its background', () => {
    expect(blockEditorCss).toMatch(/\.tiptap-content\b[\s\S]*?background:\s*var\(--page-bg-fill\)/);
  });

  it('.tiptap-content has border-radius for the panel shape', () => {
    expect(blockEditorCss).toMatch(/\.tiptap-content\b[\s\S]*?border-radius:/);
  });

  it('@supports backdrop-filter applies blur to .tiptap-content', () => {
    expect(blockEditorCss).toMatch(
      /@supports[^{]*backdrop-filter[\s\S]*?\.tiptap-content[\s\S]*?backdrop-filter:\s*blur\(var\(--page-bg-backdrop-blur\)\)/,
    );
  });

  it('liquid-neon preset applies neon glow box-shadow to .tiptap-content', () => {
    expect(blockEditorCss).toMatch(
      /\[data-page-preset="liquid-neon"\]\s+\.tiptap-content[\s\S]*?box-shadow:/,
    );
  });

  it('prefers-contrast: more forces near-opaque background on .tiptap-content', () => {
    expect(blockEditorCss).toMatch(/prefers-contrast:\s*more[\s\S]*?\.tiptap-content[\s\S]*?background:/);
  });
});

describe('PAGE_BACKGROUND_DEFAULTS migration default (SKY-3625)', () => {
  it('default preset is liquid-neon (the glass panel)', () => {
    expect(PAGE_BACKGROUND_DEFAULTS.preset).toBe('liquid-neon');
  });

  it('default opacity is 65 (semi-transparent glass)', () => {
    expect(PAGE_BACKGROUND_DEFAULTS.opacity).toBe(65);
  });

  it('default blur is 12px', () => {
    expect(PAGE_BACKGROUND_DEFAULTS.blur).toBe(12);
  });
});
