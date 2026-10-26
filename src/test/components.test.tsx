import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { RecordButton } from '../components/RecordButton';
import { ModelToggle } from '../components/ModelToggle';
import { SourceToggle } from '../components/SourceToggle';
import { LanguageSelect } from '../components/LanguageSelect';
import { Visualizer, rmsToLevel } from '../components/Visualizer';
import { ModelProgress } from '../components/ModelProgress';
import { LocalBadge } from '../components/LocalBadge';
import { ErrorBanner } from '../components/ErrorBanner';

describe('RecordButton', () => {
  it('toggles its label and announces state', async () => {
    const onClick = vi.fn();
    const { rerender } = render(<RecordButton listening={false} onClick={onClick} />);
    expect(screen.getByRole('button', { name: 'Start transcription' })).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button'));
    expect(onClick).toHaveBeenCalledOnce();

    rerender(<RecordButton listening onClick={onClick} />);
    expect(screen.getByRole('button', { name: 'Stop transcription' })).toBeInTheDocument();
  });
});

describe('ModelToggle', () => {
  it('switches models and reflects the active one', async () => {
    const onModelChange = vi.fn();
    const { rerender } = render(
      <ModelToggle modelKey="base" disabled={false} onModelChange={onModelChange} />,
    );
    const small = screen.getByRole('button', { name: 'Small' });
    await userEvent.click(small);
    expect(onModelChange).toHaveBeenCalledWith('small');

    rerender(<ModelToggle modelKey="small" disabled={false} onModelChange={onModelChange} />);
    expect(small).toHaveAttribute('aria-pressed', 'true');
  });
});

describe('SourceToggle', () => {
  it('disables the tab option when the browser cannot do it', async () => {
    const onSourceChange = vi.fn();
    render(
      <SourceToggle source="mic" tabCaptureSupported={false} onSourceChange={onSourceChange} />,
    );
    expect(screen.getByRole('button', { name: /Tab \/ call/i })).toBeDisabled();
  });
});

describe('LanguageSelect', () => {
  it('lists options and reports the chosen code', async () => {
    const onLanguageChange = vi.fn();
    render(
      <LanguageSelect language="auto" disabled={false} onLanguageChange={onLanguageChange} />,
    );
    const select = screen.getByRole('combobox');
    await userEvent.selectOptions(select, ['de']);
    expect(onLanguageChange).toHaveBeenCalledWith('de');
    // Auto-detect is offered first.
    expect(select).toContainHTML('Auto-detect');
  });
});

describe('Visualizer', () => {
  it('renders five bars scaled by the current metering', () => {
    render(<Visualizer rms={0.05} listening />);
    expect(document.querySelectorAll('.visualizer__bar')).toHaveLength(5);
    expect(document.querySelector('.visualizer--active')).toBeInTheDocument();
  });

  it('maps rms onto 0–1 with silence floor and ceiling', () => {
    expect(rmsToLevel(0)).toBe(0.08); // tiny idle motion, not dead flat
    expect(rmsToLevel(0.0001)).toBeLessThan(0.2);
    expect(rmsToLevel(0.5)).toBe(1);
  });
});

describe('ModelProgress', () => {
  it('renders per-file progress with percentage and MB of MB', () => {
    render(
      <ModelProgress
        files={[{ file: 'a/../encoder_model.onnx', progress: 50, loaded: 5_000_000, total: 10_000_000 }]}
      />,
    );
    expect(screen.getByText(/50% · 5 MB \/ 10 MB/)).toBeInTheDocument();
    expect(document.querySelector('.model-progress__fill')).toHaveStyle({ width: '50%' });
  });

  it('renders nothing when there is no progress data', () => {
    render(<ModelProgress files={[]} />);
    expect(document.querySelector('.model-progress')).not.toBeInTheDocument();
  });
});

describe('LocalBadge + ErrorBanner', () => {
  it('states the privacy guarantee prominently', () => {
    render(<LocalBadge statusText="listening" />);
    expect(screen.getByText(/100% local/)).toBeInTheDocument();
    expect(screen.getByText(/nothing recorded, nothing sent/)).toBeInTheDocument();
  });

  it('dismisses the error banner', async () => {
    const onClose = vi.fn();
    render(<ErrorBanner message="Something went wrong" onClose={onClose} />);
    await userEvent.click(screen.getByRole('button', { name: 'Dismiss' }));
    expect(onClose).toHaveBeenCalledOnce();
  });
});