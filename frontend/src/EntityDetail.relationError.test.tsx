import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import EntityDetail from './EntityDetail';
import type { EntityEntry } from './types';

const suggestionsAccept = vi.fn();

const entity: EntityEntry = {
  id: 'ent-1',
  name: 'Elowen',
  type: 'character',
  path: 'entities/characters/elowen.md',
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
};

beforeEach(() => {
  suggestionsAccept.mockReset();
  Object.defineProperty(window, 'api', {
    value: {
      tagsList: () => Promise.resolve({ tags: [] }),
      readVault: () => Promise.resolve({ content: 'Elowen keeps the old road.\n' }),
      entityBacklinks: () => Promise.resolve({ scenes: [] }),
      entityRelationshipsList: () => Promise.resolve({ relationships: [], allLabels: [] }),
      entityList: () => Promise.resolve({ entities: [entity] }),
      entityLinkedScenes: () => Promise.resolve({ scenes: [] }),
      onVaultFileChanged: () => () => {},
      suggestionsList: () => Promise.resolve({
        suggestions: [{
          id: 'rel-1',
          rationale: 'They travelled together',
          payload_json: JSON.stringify({
            kind: 'typed-relation',
            relationType: 'ally',
            sourceEntityId: 'ent-1',
            targetEntityId: 'ent-2',
            sourceEntityName: 'Elowen',
            targetEntityName: 'Maren',
          }),
        }],
      }),
      suggestionsAccept,
    },
    writable: true,
    configurable: true,
  });
});

describe('EntityDetail refused relation accept', () => {
  it('shows the refusal and keeps the proposal', async () => {
    suggestionsAccept.mockRejectedValue(new Error("1 note suggestion couldn't be saved. It's waiting for you to review."));
    render(
      <EntityDetail
        entity={entity}
        onClose={() => {}}
        onUpdated={() => {}}
        onDeleted={() => {}}
      />,
    );

    const accept = await screen.findByRole('button', { name: 'Accept relation: ally Maren' });
    fireEvent.click(accept);

    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toContain("1 note suggestion couldn't be saved");
    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Accept relation: ally Maren' })).toBeTruthy();
    });
  });
});
