/** Pure smoothing for the visualizer (unit-tested): RMS → 0–1 bar height. */
export function rmsToLevel(rms: number): number {
  return Math.max(0.08, Math.min(1, Math.sqrt(Math.max(0, rms)) * 2.2));
}

interface VisualizerProps {
  /** Raw RMS from the worklet metering messages. */
  rms: number;
  listening: boolean;
}

/** Five-bar level meter; the CSS transition gives it its motion. */
export function Visualizer({ rms, listening }: VisualizerProps) {
  return (
    <div className={`visualizer ${listening ? 'visualizer--active' : ''}`} aria-hidden="true">
      {[0.65, 1, 0.82, 1, 0.65].map((weight, index) => (
        <span
          key={index}
          className="visualizer__bar"
          style={{ height: `${Math.round(100 * weight * rmsToLevel(rms))}%` }}
        />
      ))}
    </div>
  );
}