import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import GlobalSearchPanel from './GlobalSearchPanel';

function mockApi(results: unknown[] = []) {
  return { searchVault: vi.fn().mockResolvedValue({ results }) };
}

describe('GlobalSearchPanel', () => {
  beforeEach(() => {
    (window as unknown as { api: unknown }).api = mockApi();
  });

  it('does not render when open is false', () => {
    const { container } = render(<GlobalSearchPanel open={false} onNavigate={() => {}} onClose={() => {}} />);
    expect(container.querySelector('.gsp-backdrop')).not.toBeInTheDocument();
  });

  it('renders input, scope selectors, and empty hint when open', () => {
    render(<GlobalSearchPanel open={true} onNavigate={() => {}} onClose={() => {}} />);
    expect(screen.getByRole('combobox')).toBeInTheDocument();
    expect(screen.getByText('All')).toBeInTheDocument();
    expect(screen.getByText('Story Vault')).toBeInTheDocument();
    expect(screen.getByText('Notes Vault')).toBeInTheDocument();
    expect(screen.getByText(/Type to search/)).toBeInTheDocument();
  });

  it('calls onClose when backdrop is clicked', () => {
    const onClose = vi.fn();
    render(<GlobalSearchPanel open={true} onNavigate={() => {}} onClose={onClose} />);
    fireEvent.click(document.querySelector('.gsp-backdrop')!);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('does NOT close when clicking inside the panel', () => {
    const onClose = vi.fn();
    render(<GlobalSearchPanel open={true} onNavigate={() => {}} onClose={onClose} />);
    fireEvent.click(document.querySelector('.gsp-panel')!);
    expect(onClose).not.toHaveBeenCalled();
  });

  it('calls onClose when Escape is pressed', () => {
    const onClose = vi.fn();
    render(<GlobalSearchPanel open={true} onNavigate={() => {}} onClose={onClose} />);
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('calls onClose when the ✕ button is clicked', () => {
    const onClose = vi.fn();
    render(<GlobalSearchPanel open={true} onNavigate={() => {}} onClose={onClose} />);
    fireEvent.click(screen.getByRole('button', { name: 'Close search panel' }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('shows "No results" message when query returns empty', async () => {
    render(<GlobalSearchPanel open={true} onNavigate={() => {}} onClose={() => {}} />);
    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'xyzzy' } });
    await waitFor(() => screen.getByText(/No results for/), { timeout: 600 });
  });

  it('renders search results after debounce fires', async () => {
    const result = {
      docId: 'scene-1',
      vault: 'story',
      kind: 'scene',
      title: 'The Glass Market',
      snippet: 'Eira stepped into [[the Glass]] Market.',
      rank: -1,
    };
    (window as unknown as { api: unknown }).api = {
      searchVault: vi.fn().mockResolvedValue({ results: [result] }),
    };

    render(<GlobalSearchPanel open={true} onNavigate={() => {}} onClose={() => {}} />);
    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'Glass' } });
    await waitFor(() => screen.getByText('The Glass Market'), { timeout: 600 });
    expect(screen.getByText('Story')).toBeInTheDocument();
    const mark = document.querySelector('.gsp-result-snippet mark');
    expect(mark?.textContent).toBe('the Glass');
  });

  it('calls onNavigate and onClose when a result is selected via mousedown', async () => {
    const result = {
      docId: 'd1',
      vault: 'story' as const,
      kind: 'scene',
      title: 'My Scene',
      snippet: '',
      rank: -1,
    };
    (window as unknown as { api: unknown }).api = {
      searchVault: vi.fn().mockResolvedValue({ results: [result] }),
    };
    const onNavigate = vi.fn();
    const onClose = vi.fn();

    render(<GlobalSearchPanel open={true} onNavigate={onNavigate} onClose={onClose} />);
    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'scene' } });
    await waitFor(() => screen.getByText('My Scene'), { timeout: 600 });
    fireEvent.mouseDown(screen.getByRole('option'));
    expect(onNavigate).toHaveBeenCalledWith(result);
    expect(onClose).toHaveBeenCalled();
  });

  it('navigates to first result on Enter when no item is active', async () => {
    const result = {
      docId: 'd2',
      vault: 'story' as const,
      kind: 'scene',
      title: 'Quick Open Scene',
      snippet: '',
      rank: -1,
    };
    (window as unknown as { api: unknown }).api = {
      searchVault: vi.fn().mockResolvedValue({ results: [result] }),
    };
    const onNavigate = vi.fn();
    const onClose = vi.fn();

    render(<GlobalSearchPanel open={true} onNavigate={onNavigate} onClose={onClose} />);
    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'quick' } });
    await waitFor(() => screen.getByText('Quick Open Scene'), { timeout: 600 });
    fireEvent.keyDown(screen.getByRole('combobox'), { key: 'Enter' });
    expect(onNavigate).toHaveBeenCalledWith(result);
  });

  it('uses scope filter when toggled before search', async () => {
    const searchVault = vi.fn().mockResolvedValue({ results: [] });
    (window as unknown as { api: unknown }).api = { searchVault };

    render(<GlobalSearchPanel open={true} onNavigate={() => {}} onClose={() => {}} />);
    fireEvent.click(screen.getByText('Story Vault'));
    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'hero' } });
    await waitFor(() => expect(searchVault).toHaveBeenCalledWith('hero', 'story', 20, undefined), { timeout: 600 });
  });
});

describe('GlobalSearchPanel — context-aware defaultScope', () => {
  beforeEach(() => {
    (window as unknown as { api: unknown }).api = mockApi();
  });

  it('defaults to "both" scope when no defaultScope is passed', () => {
    render(<GlobalSearchPanel open={true} onNavigate={() => {}} onClose={() => {}} />);
    expect(screen.getByText('All').closest('button')).toHaveAttribute('aria-pressed', 'true');
  });

  it('defaults to story scope when defaultScope="story"', () => {
    render(<GlobalSearchPanel open={true} onNavigate={() => {}} onClose={() => {}} defaultScope="story" />);
    expect(screen.getByText('Story Vault').closest('button')).toHaveAttribute('aria-pressed', 'true');
  });

  it('defaults to notes scope when defaultScope="notes"', () => {
    render(<GlobalSearchPanel open={true} onNavigate={() => {}} onClose={() => {}} defaultScope="notes" />);
    expect(screen.getByText('Notes Vault').closest('button')).toHaveAttribute('aria-pressed', 'true');
  });
});
