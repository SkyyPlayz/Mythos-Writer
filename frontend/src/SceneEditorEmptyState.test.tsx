import { render, screen } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import { SceneEditorEmptyState } from './SceneEditorEmptyState';

describe('SceneEditorEmptyState', () => {
  describe('select-scene variant', () => {
    it('renders the spec copy', () => {
      render(<SceneEditorEmptyState variant="select-scene" />);
      expect(screen.getByText(/Select a scene from your story to start writing/i)).toBeInTheDocument();
    });

    it('renders the document SVG icon', () => {
      render(<SceneEditorEmptyState variant="select-scene" />);
      const svg = document.querySelector('svg.se-empty-icon');
      expect(svg).toBeInTheDocument();
    });

    it('has correct data-testid and data-variant', () => {
      render(<SceneEditorEmptyState variant="select-scene" />);
      const el = screen.getByTestId('scene-editor-empty');
      expect(el).toHaveAttribute('data-variant', 'select-scene');
    });

    it('does not have a live region role (it is a static state)', () => {
      render(<SceneEditorEmptyState variant="select-scene" />);
      const el = screen.getByTestId('scene-editor-empty');
      expect(el).not.toHaveAttribute('role', 'status');
    });
  });

  describe('loading variant', () => {
    it('renders the spec copy', () => {
      render(<SceneEditorEmptyState variant="loading" />);
      expect(screen.getByText(/Loading your scene…/i)).toBeInTheDocument();
    });

    it('has role=status for accessibility', () => {
      render(<SceneEditorEmptyState variant="loading" />);
      const el = screen.getByRole('status');
      expect(el).toBeInTheDocument();
    });

    it('has aria-live=polite', () => {
      render(<SceneEditorEmptyState variant="loading" />);
      const el = screen.getByRole('status');
      expect(el).toHaveAttribute('aria-live', 'polite');
    });

    it('has correct data-testid and data-variant', () => {
      render(<SceneEditorEmptyState variant="loading" />);
      const el = screen.getByTestId('scene-editor-empty');
      expect(el).toHaveAttribute('data-variant', 'loading');
    });

    it('renders the loading spinner', () => {
      render(<SceneEditorEmptyState variant="loading" />);
      expect(document.querySelector('.se-empty-spinner')).toBeInTheDocument();
    });

    it('does not render the document SVG icon', () => {
      render(<SceneEditorEmptyState variant="loading" />);
      expect(document.querySelector('svg.se-empty-icon')).not.toBeInTheDocument();
    });
  });

  describe('no-scenes-yet variant', () => {
    it('renders the spec copy with + button mention', () => {
      render(<SceneEditorEmptyState variant="no-scenes-yet" />);
      expect(screen.getByText(/Create your first scene to start writing/i)).toBeInTheDocument();
      expect(screen.getByText(/\+ button in your story outline/i)).toBeInTheDocument();
    });

    it('renders the document SVG icon', () => {
      render(<SceneEditorEmptyState variant="no-scenes-yet" />);
      const svg = document.querySelector('svg.se-empty-icon');
      expect(svg).toBeInTheDocument();
    });

    it('has correct data-testid and data-variant', () => {
      render(<SceneEditorEmptyState variant="no-scenes-yet" />);
      const el = screen.getByTestId('scene-editor-empty');
      expect(el).toHaveAttribute('data-variant', 'no-scenes-yet');
    });
  });

  describe('icon accessibility', () => {
    it('SVG icon is aria-hidden (decorative)', () => {
      render(<SceneEditorEmptyState variant="select-scene" />);
      const svg = document.querySelector('svg.se-empty-icon')!;
      expect(svg).toHaveAttribute('aria-hidden', 'true');
    });
  });
});
