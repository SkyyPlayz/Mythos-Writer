// M15: note-template picker — template set + frontmatter contract tests.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import TemplatePicker, { NOTE_TEMPLATES, buildTemplateNote } from './TemplatePicker';

const mockWriteNotesVault = vi.fn();

beforeEach(() => {
  vi.resetAllMocks();
  mockWriteNotesVault.mockResolvedValue({ path: 'x.md', bytes: 0 });
  (window as unknown as { api: unknown }).api = {
    writeNotesVault: mockWriteNotesVault,
  };
});

// ─── Template set (prototype ntplItems) ───────────────────────────────────────

describe('NOTE_TEMPLATES', () => {
  it('is exactly the six prototype templates, in prototype order', () => {
    expect(NOTE_TEMPLATES.map((t) => [t.name, t.description])).toEqual([
      ['Character', 'Bio, arc, relationships, voice'],
      ['Location', 'Region, environment, danger'],
      ['Faction', 'Goals, members, secrets'],
      ['Item / System', 'Rules, costs, limits'],
      ['Event / History', 'Date, impact, witnesses'],
      ['Blank note', 'Empty page'],
    ]);
  });

  it('maps each typed template to an entity-system type', () => {
    const types = Object.fromEntries(NOTE_TEMPLATES.map((t) => [t.id, t.type]));
    expect(types).toEqual({
      character: 'character',
      location: 'location',
      faction: 'faction',
      'item-system': 'item',
      'event-history': 'event',
      blank: undefined,
    });
  });
});

// ─── buildTemplateNote frontmatter contract ───────────────────────────────────

describe('buildTemplateNote', () => {
  const character = NOTE_TEMPLATES.find((t) => t.id === 'character')!;
  const blank = NOTE_TEMPLATES.find((t) => t.id === 'blank')!;

  it('writes quoted title, entity type, and createdAt frontmatter', () => {
    const md = buildTemplateNote(character, 'Mira Veynn', '2026-07-05T00:00:00.000Z');
    expect(md.startsWith('---\n')).toBe(true);
    expect(md).toContain('title: "Mira Veynn"');
    expect(md).toContain('type: character');
    expect(md).toContain('createdAt: 2026-07-05T00:00:00.000Z');
  });

  it('scaffolds the template sections as ## headings under an H1', () => {
    const md = buildTemplateNote(character, 'Mira Veynn');
    expect(md).toContain('# Mira Veynn');
    for (const section of ['## Bio', '## Arc', '## Relationships', '## Voice']) {
      expect(md).toContain(section);
    }
  });

  it('blank note has frontmatter without a type and an empty body', () => {
    const md = buildTemplateNote(blank, 'Scratch', '2026-07-05T00:00:00.000Z');
    expect(md).toBe('---\ntitle: "Scratch"\ncreatedAt: 2026-07-05T00:00:00.000Z\n---\n\n');
    expect(md).not.toContain('type:');
  });

  it('escapes double quotes in the title', () => {
    const md = buildTemplateNote(blank, 'The "Gate"');
    expect(md).toContain(`title: "The 'Gate'"`);
  });
});

// ─── Component ────────────────────────────────────────────────────────────────

describe('TemplatePicker', () => {
  const baseProps = { onApplied: vi.fn(), onClose: vi.fn() };

  it('renders all six template cards with names and descriptions', () => {
    render(<TemplatePicker {...baseProps} />);
    for (const t of NOTE_TEMPLATES) {
      const card = screen.getByTestId(`template-${t.id}`);
      expect(card).toHaveTextContent(t.name);
      expect(card).toHaveTextContent(t.description);
    }
  });

  it('disables Create until a template is selected', () => {
    render(<TemplatePicker {...baseProps} />);
    expect(screen.getByTestId('tp-apply')).toBeDisabled();
    fireEvent.click(screen.getByTestId('template-character'));
    expect(screen.getByTestId('tp-apply')).toBeEnabled();
  });

  it('creates a correctly-frontmattered note from the selected template', async () => {
    const onApplied = vi.fn();
    render(<TemplatePicker {...baseProps} onApplied={onApplied} />);
    fireEvent.click(screen.getByTestId('template-faction'));
    fireEvent.change(screen.getByTestId('tp-note-name'), { target: { value: 'Ash Court' } });
    fireEvent.click(screen.getByTestId('tp-apply'));

    await waitFor(() => expect(mockWriteNotesVault).toHaveBeenCalled());
    const [path, content] = mockWriteNotesVault.mock.calls[0] as [string, string];
    expect(path).toBe('ash-court.md');
    expect(content).toContain('title: "Ash Court"');
    expect(content).toContain('type: faction');
    expect(content).toContain('## Goals');
    expect(content).toContain('## Members');
    expect(content).toContain('## Secrets');
    expect(onApplied).toHaveBeenCalledOnce();
  });

  it('defaults the note name to "New <Template>" when left blank', async () => {
    render(<TemplatePicker {...baseProps} />);
    fireEvent.click(screen.getByTestId('template-item-system'));
    fireEvent.click(screen.getByTestId('tp-apply'));

    await waitFor(() => expect(mockWriteNotesVault).toHaveBeenCalled());
    const [path, content] = mockWriteNotesVault.mock.calls[0] as [string, string];
    expect(path).toBe('new-item--system.md');
    expect(content).toContain('title: "New Item / System"');
    expect(content).toContain('type: item');
  });

  it('reports the created path via onCreated', async () => {
    const onCreated = vi.fn();
    render(<TemplatePicker {...baseProps} onCreated={onCreated} />);
    fireEvent.click(screen.getByTestId('template-blank'));
    fireEvent.change(screen.getByTestId('tp-note-name'), { target: { value: 'Loose Thread' } });
    fireEvent.click(screen.getByTestId('tp-apply'));
    await waitFor(() => expect(onCreated).toHaveBeenCalledWith('loose-thread.md'));
  });

  it('surfaces write failures as an alert and does not call onApplied', async () => {
    mockWriteNotesVault.mockRejectedValue(new Error('vault is read-only'));
    const onApplied = vi.fn();
    render(<TemplatePicker {...baseProps} onApplied={onApplied} />);
    fireEvent.click(screen.getByTestId('template-location'));
    fireEvent.click(screen.getByTestId('tp-apply'));
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('vault is read-only'));
    expect(onApplied).not.toHaveBeenCalled();
  });

  it('calls onClose from the Cancel button', () => {
    const onClose = vi.fn();
    render(<TemplatePicker {...baseProps} onClose={onClose} />);
    fireEvent.click(screen.getByText('Cancel'));
    expect(onClose).toHaveBeenCalledOnce();
  });
});
