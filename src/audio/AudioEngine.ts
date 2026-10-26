/**
 * Owns the AudioContext and the segment-processor worklet: converts a
 * MediaStream into the two messages the app cares about (metering for the
 * visualizer, PCM blocks for the segmenter). One engine per capture session;
 * `stop()` tears everything down so the mic indicator light goes off.
 */

/** PCM block size posted by the worklet (256 ms at 16 kHz). */
export const PCM_BLOCK_SAMPLES = 4096;
/** Metering message cadence: every 2 hops = 64 ms. */
export const METER_EVERY_N_HOPS = 2;

export type WorkletMessage =
  | { type: 'meter'; rms: number }
  | { type: 'block'; pcm: Float32Array };

export interface AudioHandlers {
  onMeter(rms: number): void;
  onBlock(pcm: Float32Array): void;
}

export class AudioEngine {
  private ctx: AudioContext | null = null;
  private source: MediaStreamAudioSourceNode | null = null;
  private worklet: AudioWorkletNode | null = null;
  private sink: GainNode | null = null;

  /** True while a stream is actively being processed. */
  get running(): boolean {
    return this.ctx !== null;
  }

  /**
   * Wires stream → worklet → (muted) destination. The muted gain node exists
   * only to keep the processing graph alive without echoing the mic.
   */
  async start(stream: MediaStream, handlers: AudioHandlers): Promise<void> {
    // 16 kHz matches Whisper's expected input; unsupported browsers resample internally.
    this.ctx = new AudioContext({ sampleRate: 16_000 });
    // Resolves as a static asset — Vite copies the file alongside the bundle.
    const workletUrl = new URL('./worklet/segment-processor.js', import.meta.url);
    await this.ctx.audioWorklet.addModule(workletUrl);

    this.worklet = new AudioWorkletNode(this.ctx, 'segment-processor', {
      numberOfOutputs: 1,
      processorOptions: {
        hopSize: 512,
        blockSize: PCM_BLOCK_SAMPLES,
        meterEvery: METER_EVERY_N_HOPS,
      },
    });
    this.worklet.port.onmessage = (event: MessageEvent<WorkletMessage>) => {
      const message = event.data;
      if (message.type === 'meter') handlers.onMeter(message.rms);
      else if (message.type === 'block') handlers.onBlock(message.pcm);
    };

    this.sink = this.ctx.createGain();
    this.sink.gain.value = 0; // keep the graph alive without playing anything back
    this.worklet.connect(this.sink).connect(this.ctx.destination);

    this.source = this.ctx.createMediaStreamSource(stream);
    this.source.connect(this.worklet);
    await this.ctx.resume();
  }

  /** Stops processing and closes the context; safe to call from any state. */
  async stop(): Promise<void> {
    this.source?.disconnect();
    this.worklet?.disconnect();
    this.sink?.disconnect();
    this.worklet?.port.close();
    this.source = this.worklet = this.sink = null;
    if (this.ctx) {
      await this.ctx.close();
      this.ctx = null;
    }
  }
}