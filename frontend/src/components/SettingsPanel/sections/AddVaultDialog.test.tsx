// SKY-11154 — AddVaultDialog must create through the notes/story REGISTRY
// (notesVaultRegistryCreate / storyVaultRegistryCreate), never through
// createVaultFromOptions — that primitive scaffolds a whole new
// self-contained Mythos vault bundle and never writes to
// notes-vaults.json/story-vaults.json, so the Settings-page columns built by
// this ticket would never see the result.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import AddVaultDialog from './AddVaultDialog';

const MYTHOS_ROOT = '/vaults/Alpha';

const mockVaultGetPaths = vi.fn();
const mockNotesVaultRegistryCreate = vi.fn();
const mockStoryVaultRegistryCreate = vi.fn();
const mockCreateVaultFromOptions = vi.fn();
const mockChooseVaultFolder = vi.fn();

beforeEach(() => {
  vi.clearAllMocks();
  mockVaultGetPaths.mockResolvedValue({
    storyVaultPath: `${MYTHOS_ROOT}/Story Vault`,
    notesVaultPath: `${MYTHOS_ROOT}/Notes Vault`,
    pathSeparator: '/',
    mythosRoot: MYTHOS_ROOT,
  });
  mockNotesVaultRegistryCreate.mockResolvedValue({
    entry: { id: 'n1', displayName: 'Notes', dirName: 'Notes', createdAt: '', origin: 'created' },
  });
  mockStoryVaultRegistryCreate.mockResolvedValue({
    entry: { id: 's1', displayName: 'Story', dirName: 'Story', createdAt: '', pairedNotesVaultId: null },
  });
  mockChooseVaultFolder.mockResolvedValue({ path: null, cancelled: true });
  Object.defineProperty(window, 'api', {
    value: {
      vaultGetPaths: mockVaultGetPaths,
      notesVaultRegistryCreate: mockNotesVaultRegistryCreate,
      storyVaultRegistryCreate: mockStoryVaultRegistryCreate,
      createVaultFromOptions: mockCreateVaultFromOptions,
      chooseVaultFolder: mockChooseVaultFolder,
    },
    writable: true,
    configurable: true,
  });
});

async function openDialog(kind: 'notes' | 'story') {
  const onClose = vi.fn();
  await act(async () => {
    render(<AddVaultDialog kind={kind} open onClose={onClose} />);
  });
  await waitFor(() => expect(mockVaultGetPaths).toHaveBeenCalled());
  return { onClose };
}

describe('AddVaultDialog (SKY-11154 submit-target fix)', () => {
  it('kind="notes": submits via notesVaultRegistryCreate, never createVaultFromOptions', async () => {
    const { onClose } = await openDialog('notes');
    fireEvent.change(screen.getByTestId('avd-name-notes'), { target: { value: 'My Notes' } });
    fireEvent.click(screen.getByTestId('avd-submit-notes'));

    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(mockNotesVaultRegistryCreate).toHaveBeenCalledWith({
      mode: 'template',
      displayName: 'My Notes',
      importSourcePath: undefined,
    });
    expect(mockCreateVaultFromOptions).not.toHaveBeenCalled();
  });

  it('kind="story": maps the UI "template" mode to backend mode "blank" (no story-vault skeleton exists)', async () => {
    const { onClose } = await openDialog('story');
    fireEvent.change(screen.getByTestId('avd-name-story'), { target: { value: 'My Story' } });
    fireEvent.click(screen.getByTestId('avd-submit-story'));

    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(mockStoryVaultRegistryCreate).toHaveBeenCalledWith({
      mode: 'blank',
      displayName: 'My Story',
      importSourcePath: undefined,
    });
    expect(mockCreateVaultFromOptions).not.toHaveBeenCalled();
  });

  it('kind="story": "blank" and "import" modes pass through unmapped', async () => {
    await openDialog('story');
    fireEvent.click(screen.getByTestId('avd-mode-story-blank'));
    fireEvent.click(screen.getByTestId('avd-submit-story'));
    await waitFor(() => expect(mockStoryVaultRegistryCreate).toHaveBeenCalledWith(
      expect.objectContaining({ mode: 'blank' }),
    ));
  });

  it('import mode forwards the chosen importSourcePath', async () => {
    mockChooseVaultFolder.mockResolvedValue({ path: '/import/src', cancelled: false });
    await openDialog('notes');
    fireEvent.click(screen.getByTestId('avd-mode-notes-import'));
    fireEvent.click(screen.getByTestId('avd-import-src-notes-browse'));
    await waitFor(() => expect(mockChooseVaultFolder).toHaveBeenCalled());
    fireEvent.click(screen.getByTestId('avd-submit-notes'));
    await waitFor(() => expect(mockNotesVaultRegistryCreate).toHaveBeenCalledWith(
      expect.objectContaining({ mode: 'import', importSourcePath: '/import/src' }),
    ));
  });

  it('a rejected create keeps the dialog open and shows the error', async () => {
    mockNotesVaultRegistryCreate.mockRejectedValue(new Error('disk full'));
    const { onClose } = await openDialog('notes');
    fireEvent.click(screen.getByTestId('avd-submit-notes'));
    await waitFor(() => expect(screen.getByTestId('avd-error-notes')).toHaveTextContent('disk full'));
    expect(onClose).not.toHaveBeenCalled();
  });
});
