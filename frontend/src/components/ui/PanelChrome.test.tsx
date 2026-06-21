import { render, screen } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import { PanelChrome, PanelHeader, PanelBody, PanelFooter } from './PanelChrome';

describe('PanelHeader', () => {
  it('renders title text', () => {
    render(<PanelHeader title="My Panel" />);
    expect(screen.getByText('My Panel')).toBeTruthy();
  });

  it('renders icon slot when provided', () => {
    render(<PanelHeader title="T" icon={<span data-testid="icon">★</span>} />);
    expect(screen.getByTestId('icon')).toBeTruthy();
  });

  it('omits icon container when icon is not provided', () => {
    render(<PanelHeader title="T" />);
    const icons = document.querySelectorAll('.pc-header-icon');
    expect(icons.length).toBe(0);
  });

  it('renders actions slot when provided', () => {
    render(<PanelHeader title="T" actions={<button>Save</button>} />);
    expect(screen.getByRole('button', { name: 'Save' })).toBeTruthy();
  });

  it('omits actions container when actions is not provided', () => {
    render(<PanelHeader title="T" />);
    const acts = document.querySelectorAll('.pc-header-actions');
    expect(acts.length).toBe(0);
  });

  it('renders subtitle when provided', () => {
    render(<PanelHeader title="T" subtitle="Sub text" />);
    expect(screen.getByText('Sub text')).toBeTruthy();
  });

  it('omits subtitle element when not provided', () => {
    render(<PanelHeader title="T" />);
    const subs = document.querySelectorAll('.pc-header-subtitle');
    expect(subs.length).toBe(0);
  });

  it('accepts a ReactNode title', () => {
    render(<PanelHeader title={<strong data-testid="rich-title">Bold</strong>} />);
    expect(screen.getByTestId('rich-title')).toBeTruthy();
  });

  it('merges className onto pc-header', () => {
    render(<PanelHeader title="T" className="custom" />);
    const el = document.querySelector('.pc-header.custom');
    expect(el).toBeTruthy();
  });
});

describe('PanelBody', () => {
  it('renders children', () => {
    render(<PanelBody><p>Content</p></PanelBody>);
    expect(screen.getByText('Content')).toBeTruthy();
  });

  it('has pc-body class', () => {
    render(<PanelBody>x</PanelBody>);
    expect(document.querySelector('.pc-body')).toBeTruthy();
  });

  it('is scrollable (overflow-y: auto via CSS class)', () => {
    render(<PanelBody className="extra">x</PanelBody>);
    expect(document.querySelector('.pc-body.extra')).toBeTruthy();
  });
});

describe('PanelFooter', () => {
  it('renders children', () => {
    render(<PanelFooter><button>Cancel</button></PanelFooter>);
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeTruthy();
  });

  it('has pc-footer class', () => {
    render(<PanelFooter>x</PanelFooter>);
    expect(document.querySelector('.pc-footer')).toBeTruthy();
  });
});

describe('PanelChrome', () => {
  it('composes header, body, footer', () => {
    render(
      <PanelChrome>
        <PanelHeader title="Title" />
        <PanelBody>Body</PanelBody>
        <PanelFooter>Footer</PanelFooter>
      </PanelChrome>
    );
    expect(screen.getByText('Title')).toBeTruthy();
    expect(screen.getByText('Body')).toBeTruthy();
    expect(screen.getByText('Footer')).toBeTruthy();
  });

  it('has pc-chrome class', () => {
    render(<PanelChrome>x</PanelChrome>);
    expect(document.querySelector('.pc-chrome')).toBeTruthy();
  });

  it('passes className to pc-chrome', () => {
    render(<PanelChrome className="extra">x</PanelChrome>);
    expect(document.querySelector('.pc-chrome.extra')).toBeTruthy();
  });
});
