import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import WindowChrome from './WindowChrome';

const mockWindowMinimize = vi.fn();
const mockWindowMaximize = vi.fn();
const mockWindowClose = vi.fn();
const mockGetAppInfo = vi.fn();

function stubApi(platform: string) {
  mockGetAppInfo.mockResolvedValue({ platform, electronVersion: '30.0.0', appVersion: '1.0.0' });
  Object.defineProperty(window, 'api', {
    value: {
      getAppInfo: mockGetAppInfo,
      windowMinimize: mockWindowMinimize,
      windowMaximize: mockWindowMaximize,
      windowClose: mockWindowClose,
    },
    writable: true,
    configurable: true,
  });
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('WindowChrome', () => {
  describe('rendering', () => {
    it('renders the window chrome banner', async () => {
      stubApi('linux');
      await act(async () => { render(<WindowChrome />); });
      expect(screen.getByRole('banner', { name: /window chrome/i })).toBeInTheDocument();
    });

    it('renders the app title', async () => {
      stubApi('win32');
      await act(async () => { render(<WindowChrome />); });
      expect(screen.getByText('Mythos Writer')).toBeInTheDocument();
    });

    it('renders close, minimize, and maximize buttons', async () => {
      stubApi('linux');
      await act(async () => { render(<WindowChrome />); });
      expect(screen.getByRole('button', { name: /close window/i })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: /minimize window/i })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: /maximize window/i })).toBeInTheDocument();
    });
  });

  describe('platform-conditional layout', () => {
    it('places controls left on macOS (darwin)', async () => {
      stubApi('darwin');
      await act(async () => { render(<WindowChrome />); });
      const controls = screen.getByTestId('wc-controls');
      expect(controls.classList.contains('wc-controls-left')).toBe(true);
    });

    it('places controls right on Windows (win32)', async () => {
      stubApi('win32');
      await act(async () => { render(<WindowChrome />); });
      const controls = screen.getByTestId('wc-controls');
      expect(controls.classList.contains('wc-controls-right')).toBe(true);
    });

    it('places controls right on Linux', async () => {
      stubApi('linux');
      await act(async () => { render(<WindowChrome />); });
      const controls = screen.getByTestId('wc-controls');
      expect(controls.classList.contains('wc-controls-right')).toBe(true);
    });
  });

  describe('IPC calls on button click', () => {
    it('calls windowClose when close button is clicked', async () => {
      stubApi('win32');
      await act(async () => { render(<WindowChrome />); });
      fireEvent.click(screen.getByRole('button', { name: /close window/i }));
      expect(mockWindowClose).toHaveBeenCalledTimes(1);
    });

    it('calls windowMinimize when minimize button is clicked', async () => {
      stubApi('win32');
      await act(async () => { render(<WindowChrome />); });
      fireEvent.click(screen.getByRole('button', { name: /minimize window/i }));
      expect(mockWindowMinimize).toHaveBeenCalledTimes(1);
    });

    it('calls windowMaximize when maximize button is clicked', async () => {
      stubApi('win32');
      await act(async () => { render(<WindowChrome />); });
      fireEvent.click(screen.getByRole('button', { name: /maximize window/i }));
      expect(mockWindowMaximize).toHaveBeenCalledTimes(1);
    });

    it('calls windowClose on macOS when close button is clicked', async () => {
      stubApi('darwin');
      await act(async () => { render(<WindowChrome />); });
      fireEvent.click(screen.getByRole('button', { name: /close window/i }));
      expect(mockWindowClose).toHaveBeenCalledTimes(1);
    });
  });

  describe('graceful degradation', () => {
    it('renders without crashing when window.api is unavailable', async () => {
      Object.defineProperty(window, 'api', {
        value: undefined,
        writable: true,
        configurable: true,
      });
      await act(async () => { render(<WindowChrome />); });
      expect(screen.getByRole('banner')).toBeInTheDocument();
    });
  });
});
