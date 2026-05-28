import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import SearchBar from './SearchBar';

const mockSearchVault = vi.fn();
const mockOnNavigate = vi.fn();

beforeEach(() => {
  vi.resetAllMocks();
  (window as unknown as { api: unknown }).api = {
    searchVault: mockSearchVault,
  };
});

function makeResult(overrides: Partial<{
  docId: string; vault: 'story' | 'notes'; kind: string; title: string; snippet: string; rank: number;
}> = {}) {
  return {
    docId: 'doc-1',
    vault: 'story' as const,
    kind: 'scene',
    title: 'The Glass Market',
    snippet: '…Eira stepped into the [[Glass]] Market…',
    rank: -1,
    ...overrides,
  };
}

describe('SearchBar', () => {
  it('renders search input', () => {
    render(<SearchBar onNavigate={mockOnNavigate} />);
    expect(screen.getByRole('combobox', { name: /search vault/i })).toBeInTheDocument();
  });

  it('renders scope toggle buttons', () => {
    render(<SearchBar onNavigate={mockOnNavigate} />);
    expect(screen.getByRole('button', { name: /^All$/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^Story$/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^Notes$/i })).toBeInTheDocument();
  });

  it('shows results dropdown after typing', async () => {
    mockSearchVault.mockResolvedValue({ results: [makeResult()] });
    render(<SearchBar onNavigate={mockOnNavigate} />);

    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'glass' } });

    await waitFor(() => {
      expect(screen.getByRole('listbox')).toBeInTheDocument();
      expect(screen.getByText('The Glass Market')).toBeInTheDocument();
    });
  });

  it('highlights [[...]] snippet markers with <mark> elements', async () => {
    mockSearchVault.mockResolvedValue({
      results: [makeResult({ snippet: '…Eira stepped into the [[Glass]] Market…' })],
    });
    render(<SearchBar onNavigate={mockOnNavigate} />);
    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'glass' } });

    await waitFor(() => screen.getByRole('listbox'));
    const mark = document.querySelector('mark');
    expect(mark).not.toBeNull();
    expect(mark!.textContent).toBe('Glass');
  });

  // Security: HTML in document body must not be injected as raw markup.
  it('does not execute HTML from snippet content (XSS guard)', async () => {
    const xssSnippet = '…before [[match]] <script>window.__xss=1</script> after…';
    mockSearchVault.mockResolvedValue({
      results: [makeResult({ snippet: xssSnippet })],
    });
    render(<SearchBar onNavigate={mockOnNavigate} />);
    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'match' } });

    await waitFor(() => screen.getByRole('listbox'));

    // The script tag should appear as literal text, not be executed.
    const snippetEl = document.querySelector('.search-result-snippet');
    expect(snippetEl).not.toBeNull();
    // innerHTML should have the script tag escaped or as a text node — no live <script>
    const scriptTags = snippetEl!.querySelectorAll('script');
    expect(scriptTags).toHaveLength(0);
    // The literal text should be present (visible to user, harmlessly)
    expect(snippetEl!.textContent).toContain('<script>');
    // And the global XSS sentinel must not have been set
    expect((window as unknown as { __xss?: number }).__xss).toBeUndefined();
  });

  it('does not inject img onerror payloads from snippet (XSS guard)', async () => {
    const xssSnippet = '…before [[match]] <img src=x onerror="window.__xss2=1"> after…';
    mockSearchVault.mockResolvedValue({
      results: [makeResult({ snippet: xssSnippet })],
    });
    render(<SearchBar onNavigate={mockOnNavigate} />);
    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'match' } });

    await waitFor(() => screen.getByRole('listbox'));

    const snippetEl = document.querySelector('.search-result-snippet');
    expect(snippetEl!.querySelectorAll('img')).toHaveLength(0);
    expect((window as unknown as { __xss2?: number }).__xss2).toBeUndefined();
  });

  it('calls onNavigate when a result is selected', async () => {
    const result = makeResult();
    mockSearchVault.mockResolvedValue({ results: [result] });
    render(<SearchBar onNavigate={mockOnNavigate} />);
    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'glass' } });

    await waitFor(() => screen.getByRole('listbox'));
    const item = screen.getByRole('option');
    fireEvent.mouseDown(item);

    expect(mockOnNavigate).toHaveBeenCalledWith(result);
  });

  it('hides dropdown after selecting a result', async () => {
    mockSearchVault.mockResolvedValue({ results: [makeResult()] });
    render(<SearchBar onNavigate={mockOnNavigate} />);
    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'glass' } });

    await waitFor(() => screen.getByRole('listbox'));
    fireEvent.mouseDown(screen.getByRole('option'));

    expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
  });

  it('handles keyboard navigation (ArrowDown/Enter)', async () => {
    const result = makeResult();
    mockSearchVault.mockResolvedValue({ results: [result] });
    render(<SearchBar onNavigate={mockOnNavigate} />);
    const input = screen.getByRole('combobox');
    fireEvent.change(input, { target: { value: 'glass' } });

    await waitFor(() => screen.getByRole('listbox'));
    fireEvent.keyDown(input, { key: 'ArrowDown' });
    fireEvent.keyDown(input, { key: 'Enter' });

    expect(mockOnNavigate).toHaveBeenCalledWith(result);
  });

  it('closes dropdown on Escape', async () => {
    mockSearchVault.mockResolvedValue({ results: [makeResult()] });
    render(<SearchBar onNavigate={mockOnNavigate} />);
    const input = screen.getByRole('combobox');
    fireEvent.change(input, { target: { value: 'glass' } });

    await waitFor(() => screen.getByRole('listbox'));
    fireEvent.keyDown(input, { key: 'Escape' });

    expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
  });

  it('renders vault badge for each result', async () => {
    mockSearchVault.mockResolvedValue({
      results: [
        makeResult({ docId: 'a', vault: 'story' }),
        makeResult({ docId: 'b', vault: 'notes', kind: 'character', title: 'Eira' }),
      ],
    });
    render(<SearchBar onNavigate={mockOnNavigate} />);
    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'eira' } });

    await waitFor(() => screen.getByRole('listbox'));
    // Use CSS class selector to disambiguate from the scope toggle buttons
    expect(document.querySelector('.search-result-vault-story')).toBeInTheDocument();
    expect(document.querySelector('.search-result-vault-notes')).toBeInTheDocument();
  });
});
