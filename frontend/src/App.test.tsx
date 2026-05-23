import { render, screen, waitFor } from '@testing-library/react';
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
    settingsGet: () => Promise.resolve({ onboardingComplete: true }),
    readManifest: () => Promise.resolve(mockManifest),
    writeManifest: () => Promise.resolve({}),
    onVaultFileChanged: () => () => {},
  };
});

describe('App', () => {
  it('renders the app shell loading state', async () => {
    render(<App />);
    await waitFor(() => {
      expect(screen.getByText(/loading your vault/i)).toBeInTheDocument();
    });
  });
});
