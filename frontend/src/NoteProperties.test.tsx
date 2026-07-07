// M16: NoteProperties panel — frontmatter rows, add-property, tags round-trip
// through the notes-vault IPC.
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import NoteProperties from './NoteProperties';

const NOTE = `---
title: "The Sunken Gate"
type: location
danger: high
tags: [location, ruins]
---

# The Sunken Gate
`;

let vaultContent: string;
const readNotesVault = vi.fn(async () => ({ content: vaultContent, path: 'gate.md' }));
const writeNotesVault = vi.fn(async (_path: string, content: string) => {
  vaultContent = content;
  return { path: 'gate.md', bytes: content.length };
});
const onVaultFileChanged = vi.fn(() => () => {});

beforeEach(() => {
  vaultContent = NOTE;
  vi.clearAllMocks();
  (window as unknown as { api: unknown }).api = {
    readNotesVault,
    writeNotesVault,
    onVaultFileChanged,
  };
});

describe('NoteProperties (M16)', () => {
  it('renders the frontmatter scalars as key/value rows', async () => {
    render(<NoteProperties path="gate.md" />);
    await waitFor(() => expect(screen.getByTestId('note-prop-row-title')).toBeInTheDocument());
    expect(screen.getByLabelText('Property title')).toHaveValue('The Sunken Gate');
    expect(screen.getByLabelText('Property type')).toHaveValue('location');
    expect(screen.getByLabelText('Property danger')).toHaveValue('high');
    // tags are surfaced in the Tags card, not as a property row
    expect(screen.queryByTestId('note-prop-row-tags')).not.toBeInTheDocument();
  });

  it('commits an edited value back into the frontmatter on blur', async () => {
    render(<NoteProperties path="gate.md" />);
    await waitFor(() => expect(screen.getByLabelText('Property danger')).toBeInTheDocument());
    const input = screen.getByLabelText('Property danger');
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: 'extreme' } });
    fireEvent.blur(input, { target: { value: 'extreme' } });
    await waitFor(() => expect(writeNotesVault).toHaveBeenCalled());
    expect(vaultContent).toContain('danger: extreme');
    expect(vaultContent).toContain('type: location'); // untouched lines preserved
    expect(vaultContent).toContain('# The Sunken Gate');
  });

  it('adds a new property through the add form', async () => {
    render(<NoteProperties path="gate.md" />);
    await waitFor(() => expect(screen.getByTestId('note-prop-add')).toBeInTheDocument());
    fireEvent.click(screen.getByTestId('note-prop-add'));
    fireEvent.change(screen.getByLabelText('New property name'), { target: { value: 'region' } });
    fireEvent.change(screen.getByLabelText('New property value'), { target: { value: 'The Drowned Coast' } });
    fireEvent.click(screen.getByText('Add'));
    await waitFor(() => expect(writeNotesVault).toHaveBeenCalled());
    expect(vaultContent).toContain('region: The Drowned Coast');
    await waitFor(() => expect(screen.getByTestId('note-prop-row-region')).toBeInTheDocument());
  });

  it('renders tags from frontmatter and adds a tag on Enter', async () => {
    render(<NoteProperties path="gate.md" />);
    await waitFor(() => expect(screen.getByTestId('note-tag-location')).toBeInTheDocument());
    expect(screen.getByTestId('note-tag-ruins')).toBeInTheDocument();
    const input = screen.getByTestId('note-tag-input');
    fireEvent.change(input, { target: { value: '#underworld' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    await waitFor(() => expect(writeNotesVault).toHaveBeenCalled());
    expect(vaultContent).toContain('tags: [location, ruins, underworld]');
    await waitFor(() => expect(screen.getByTestId('note-tag-underworld')).toBeInTheDocument());
  });

  it('removes a tag via its remove button', async () => {
    render(<NoteProperties path="gate.md" />);
    await waitFor(() => expect(screen.getByTestId('note-tag-ruins')).toBeInTheDocument());
    fireEvent.click(screen.getByLabelText('Remove tag ruins'));
    await waitFor(() => expect(writeNotesVault).toHaveBeenCalled());
    expect(vaultContent).toContain('tags: [location]');
    await waitFor(() => expect(screen.queryByTestId('note-tag-ruins')).not.toBeInTheDocument());
  });

  it('shows the empty state for a note without frontmatter', async () => {
    vaultContent = '# Bare note\n';
    render(<NoteProperties path="bare.md" />);
    await waitFor(() => expect(screen.getByTestId('note-properties-empty')).toBeInTheDocument());
  });
});

describe('NoteProperties (M16) editor sync', () => {
  it('re-reads the file before mutating and broadcasts the frontmatter update', async () => {
    render(<NoteProperties path="gate.md" />);
    await waitFor(() => expect(screen.getByTestId('note-tag-input')).toBeInTheDocument());

    // Simulate the editor autosaving a newer body AFTER the panel loaded.
    vaultContent = vaultContent.replace('# The Sunken Gate', '# The Sunken Gate\n\nFreshly typed paragraph.');

    const events: Array<{ path: string; content: string }> = [];
    const onUpdate = (e: Event) => events.push((e as CustomEvent<{ path: string; content: string }>).detail);
    window.addEventListener('mythos:note-frontmatter-updated', onUpdate);

    const input = screen.getByTestId('note-tag-input');
    fireEvent.change(input, { target: { value: 'coastal' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    await waitFor(() => expect(writeNotesVault).toHaveBeenCalled());
    window.removeEventListener('mythos:note-frontmatter-updated', onUpdate);

    // The write is based on the FRESH content (typed paragraph preserved)...
    expect(vaultContent).toContain('Freshly typed paragraph.');
    expect(vaultContent).toContain('tags: [location, ruins, coastal]');
    // ...and the open editor is told to adopt it.
    expect(events).toHaveLength(1);
    expect(events[0].path).toBe('gate.md');
    expect(events[0].content).toContain('coastal');
  });
});
