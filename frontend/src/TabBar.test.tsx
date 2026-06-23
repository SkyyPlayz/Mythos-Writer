/**
 * SKY-3623: TabBar unit tests — brainstorm tab registration + keyboard nav.
 */
import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import TabBar from './TabBar';

describe('TabBar — tab registration', () => {
  it('renders all three tabs: Story, Notes, Brainstorm', () => {
    render(<TabBar activeTab="story" onTabChange={vi.fn()} />);
    expect(screen.getByRole('tab', { name: /story/i })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: /notes/i })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: /brainstorm/i })).toBeInTheDocument();
  });

  it('marks the active tab with aria-selected=true', () => {
    render(<TabBar activeTab="brainstorm" onTabChange={vi.fn()} />);
    expect(screen.getByRole('tab', { name: /brainstorm/i })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('tab', { name: /story/i })).toHaveAttribute('aria-selected', 'false');
    expect(screen.getByRole('tab', { name: /notes/i })).toHaveAttribute('aria-selected', 'false');
  });

  it('calls onTabChange with brainstorm when clicked', () => {
    const onTabChange = vi.fn();
    render(<TabBar activeTab="story" onTabChange={onTabChange} />);
    fireEvent.click(screen.getByRole('tab', { name: /brainstorm/i }));
    expect(onTabChange).toHaveBeenCalledWith('brainstorm');
  });

  it('live region announces brainstorm as active', () => {
    render(<TabBar activeTab="brainstorm" onTabChange={vi.fn()} />);
    const region = screen.getByRole('status');
    expect(region).toHaveTextContent(/brainstorm/i);
  });

  it('brainstorm tab shows Ctrl+3 shortcut hint in title', () => {
    render(<TabBar activeTab="story" onTabChange={vi.fn()} />);
    const btn = screen.getByRole('tab', { name: /brainstorm/i });
    expect(btn).toHaveAttribute('title', expect.stringContaining('3'));
  });
});

describe('TabBar — keyboard navigation', () => {
  it('ArrowRight wraps from Brainstorm back to Story', () => {
    const onTabChange = vi.fn();
    render(<TabBar activeTab="brainstorm" onTabChange={onTabChange} />);
    const brainstormTab = screen.getByRole('tab', { name: /brainstorm/i });
    fireEvent.keyDown(brainstormTab, { key: 'ArrowRight' });
    expect(onTabChange).toHaveBeenCalledWith('story');
  });

  it('ArrowLeft from Story wraps to Brainstorm', () => {
    const onTabChange = vi.fn();
    render(<TabBar activeTab="story" onTabChange={onTabChange} />);
    const storyTab = screen.getByRole('tab', { name: /story/i });
    fireEvent.keyDown(storyTab, { key: 'ArrowLeft' });
    expect(onTabChange).toHaveBeenCalledWith('brainstorm');
  });

  it('ArrowRight moves Story → Notes', () => {
    const onTabChange = vi.fn();
    render(<TabBar activeTab="story" onTabChange={onTabChange} />);
    fireEvent.keyDown(screen.getByRole('tab', { name: /story/i }), { key: 'ArrowRight' });
    expect(onTabChange).toHaveBeenCalledWith('notes');
  });

  it('ArrowRight moves Notes → Brainstorm', () => {
    const onTabChange = vi.fn();
    render(<TabBar activeTab="notes" onTabChange={onTabChange} />);
    fireEvent.keyDown(screen.getByRole('tab', { name: /notes/i }), { key: 'ArrowRight' });
    expect(onTabChange).toHaveBeenCalledWith('brainstorm');
  });

  it('Home key moves to Story from any tab', () => {
    const onTabChange = vi.fn();
    render(<TabBar activeTab="brainstorm" onTabChange={onTabChange} />);
    fireEvent.keyDown(screen.getByRole('tab', { name: /brainstorm/i }), { key: 'Home' });
    expect(onTabChange).toHaveBeenCalledWith('story');
  });

  it('End key moves to Brainstorm from any tab', () => {
    const onTabChange = vi.fn();
    render(<TabBar activeTab="story" onTabChange={onTabChange} />);
    fireEvent.keyDown(screen.getByRole('tab', { name: /story/i }), { key: 'End' });
    expect(onTabChange).toHaveBeenCalledWith('brainstorm');
  });
});
