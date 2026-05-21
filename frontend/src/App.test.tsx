import { render, screen } from '@testing-library/react';
import App from './App';

describe('App', () => {
  it('renders the heading', () => {
    render(<App />);
    expect(screen.getByText('Mythos Writer')).toBeInTheDocument();
  });

  it('renders the generate button', () => {
    render(<App />);
    expect(screen.getByRole('button', { name: /generate story/i })).toBeInTheDocument();
  });
});
