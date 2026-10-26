import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import App from './App';

// Phase 1 smoke test: app mounts and shows the product name.
describe('App', () => {
  it('renders the heading', () => {
    render(<App />);
    expect(screen.getByRole('heading', { name: 'Transcriper' })).toBeInTheDocument();
  });
});