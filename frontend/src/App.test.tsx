import { render, screen } from '@testing-library/react';
import App from './App';

const mockManifest = {
  version: '1',
  vaultRoot: '/tmp',
  stories: [],
  entities: [],
  suggestions: [],
  scenes: [],
  chapters: [],
};

beforeEach(() => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (window as any).api = {
    readManifest: () => Promise.resolve(mockManifest),
    writeManifest: () => Promise.resolve({}),
    onVaultFileChanged: () => () => {},
  };
});

describe('App', () => {
  it('renders the app shell loading state', () => {
    render(<App />);
    expect(screen.getByText(/loading your vault/i)).toBeInTheDocument();
  });
});
