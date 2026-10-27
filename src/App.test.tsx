import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import App from './App';

// Mount smoke test: app renders and shows the product name + default model.
describe('App', () => {
  it('renders the heading with small as the default model', () => {
    render(<App />);
    expect(screen.getByRole('heading', { name: 'Zero Transcriber' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Small' })).toHaveAttribute('aria-pressed', 'true');
  });
});