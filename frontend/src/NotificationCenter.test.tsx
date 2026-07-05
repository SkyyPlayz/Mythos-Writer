// M5 — bell + notification store: push/subscribe, deep-link on click, ages.
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import NotificationCenter from './NotificationCenter';
import { clearNotifications, listNotifications, notificationAge, pushNotification } from './notificationStore';

afterEach(() => {
  cleanup(); // unmount before clearing so the store doesn't setState outside act
  clearNotifications();
});

describe('notificationStore', () => {
  it('pushes to the front and caps the list', () => {
    for (let i = 0; i < 25; i++) pushNotification({ kind: 'sync', title: `t${i}`, detail: 'd' });
    const items = listNotifications();
    expect(items.length).toBe(20);
    expect(items[0].title).toBe('t24');
  });

  it('formats compact ages like the prototype', () => {
    const now = 1_000_000_000;
    expect(notificationAge(now - 30_000, now)).toBe('now');
    expect(notificationAge(now - 2 * 60_000, now)).toBe('2m');
    expect(notificationAge(now - 3 * 3_600_000, now)).toBe('3h');
  });
});

describe('<NotificationCenter>', () => {
  it('shows the unread dot when items exist and deep-links on row click', () => {
    const onOpen = vi.fn();
    pushNotification({ kind: 'archive', title: 'Archive Agent flagged 2 continuity issues', detail: 'Click to review', onOpen });
    render(<NotificationCenter />);
    expect(screen.getByTestId('ln-bell-dot')).toBeInTheDocument();
    fireEvent.click(screen.getByTestId('ln-bell'));
    expect(screen.getByTestId('ln-bell-popover')).toBeInTheDocument();
    fireEvent.click(screen.getByTestId('ln-notif-archive'));
    expect(onOpen).toHaveBeenCalledTimes(1);
    expect(screen.queryByTestId('ln-bell-popover')).not.toBeInTheDocument();
  });

  it('renders the quiet state without items', () => {
    render(<NotificationCenter />);
    expect(screen.queryByTestId('ln-bell-dot')).not.toBeInTheDocument();
    fireEvent.click(screen.getByTestId('ln-bell'));
    expect(screen.getByText(/All quiet/)).toBeInTheDocument();
  });
});
