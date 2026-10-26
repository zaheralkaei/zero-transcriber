import { describe, it, expect, vi } from 'vitest';
import { useState } from 'react';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { TranscriptPanel } from '../components/TranscriptPanel';

const baseProps = {
  segments: [],
  liveText: '',
  newestSegmentId: -1,
  onEdit: () => undefined,
  onUndo: () => undefined,
  onRedo: () => undefined,
  canUndo: false,
  canRedo: false,
  onClear: () => undefined,
};

describe('TranscriptPanel', () => {
  it('shows an empty-state hint when there is no text', () => {
    render(<TranscriptPanel {...baseProps} />);
    expect(screen.getByText(/Press Listen and start speaking/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Copy' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Clear' })).toBeDisabled();
  });

  it('renders segments as editable lines and feeds edits back', async () => {
    const onEdit = vi.fn();
    // A driver that applies edits — like the real container — so the controlled
    // textareas track what the user types.
    function Driver() {
      const [segments, setSegments] = useState([
        { id: 1, text: 'First line' },
        { id: 2, text: 'Second line' },
      ]);
      const edit = (id: number, text: string) => {
        onEdit(id, text);
        setSegments((prev) => prev.map((s) => (s.id === id ? { ...s, text } : s)));
      };
      return <TranscriptPanel {...baseProps} segments={segments} onEdit={edit} />;
    }
    render(<Driver />);
    const line = screen.getByLabelText('Transcript part 1');
    expect(line).toHaveValue('First line');

    await userEvent.clear(line);
    expect(onEdit).toHaveBeenCalledWith(1, '');
    await userEvent.type(line, 'Edited!');
    expect(onEdit).toHaveBeenCalledWith(1, 'Edited!');
  });

  it('shows the live partial as it streams', () => {
    render(<TranscriptPanel {...baseProps} liveText="still transcribing…" />);
    expect(screen.getByText(/still transcribing/)).toBeInTheDocument();
  });

  it('shows transient copy confirmation after a successful copy', async () => {
    Object.defineProperty(navigator, 'clipboard', {
      value: { writeText: async () => undefined },
      configurable: true,
    });
    render(
      <TranscriptPanel {...baseProps} segments={[{ id: 1, text: 'Some text' }]} />,
    );
    await userEvent.click(screen.getByRole('button', { name: 'Copy' }));
    expect(await screen.findByRole('button', { name: /Copied ✓/ })).toBeInTheDocument();
    // Returns to its resting label after the transient window.
    await expect
      .poll(() => screen.getByRole('button', { name: 'Copy' }), { interval: 200, timeout: 3000 })
      .toBeInTheDocument();
  });

  it('wires undo/redo/clear buttons to callbacks', async () => {
    const onUndo = vi.fn();
    const onRedo = vi.fn();
    const onClear = vi.fn();
    render(
      <TranscriptPanel
        {...baseProps}
        segments={[{ id: 1, text: 'Text' }]}
        canUndo
        canRedo
        onUndo={onUndo}
        onRedo={onRedo}
        onClear={onClear}
      />,
    );
    await userEvent.click(screen.getByRole('button', { name: 'Undo' }));
    await userEvent.click(screen.getByRole('button', { name: 'Redo' }));
    await userEvent.click(screen.getByRole('button', { name: 'Clear' }));
    expect(onUndo).toHaveBeenCalledOnce();
    expect(onRedo).toHaveBeenCalledOnce();
    expect(onClear).toHaveBeenCalledOnce();
  });

  it('select-all shows a merged read-only view, ready to go back', async () => {
    render(
      <TranscriptPanel
        {...baseProps}
        segments={[
          { id: 1, text: 'Alpha' },
          { id: 2, text: 'Beta' },
        ]}
      />,
    );
    await userEvent.click(screen.getByRole('button', { name: 'Select all' }));
    const merged = screen.getByLabelText('Full transcript');
    expect(merged).toHaveValue('Alpha\n\nBeta');
    expect(merged).toHaveAttribute('readonly');
    expect(merged).toHaveFocus();

    await userEvent.click(screen.getByRole('button', { name: 'Edit lines' }));
    expect(screen.getByLabelText('Transcript part 1')).toBeInTheDocument();
  });

  it('routes Ctrl+Z / Ctrl+Shift+Z to the panel history, not the browser', async () => {
    const onUndo = vi.fn();
    const onRedo = vi.fn();
    render(
      <TranscriptPanel
        {...baseProps}
        segments={[{ id: 1, text: 'Text' }]}
        canUndo
        canRedo
        onUndo={onUndo}
        onRedo={onRedo}
      />,
    );
    const line = screen.getByLabelText('Transcript part 1');
    line.focus();
    await userEvent.keyboard('{Control>}z{/Control}');
    expect(onUndo).toHaveBeenCalledOnce();

    await userEvent.keyboard('{Control>}{Shift>}z{/Shift}{/Control}');
    expect(onRedo).toHaveBeenCalledOnce();
  });
});