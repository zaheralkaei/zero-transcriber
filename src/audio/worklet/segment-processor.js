/**
 * AudioWorklet: analyses the live stream on the audio thread and forwards two
 * message kinds to the main thread:
 *   { type: 'meter', rms }              — visualizer feed, posted every 2 hops (64 ms)
 *   { type: 'block', pcm: Float32Array } — 4096-sample chunk for the segmenter
 * Kept as plain JS because worklets are attached with `addModule`, not bundled.
 * All sizes come in over `processorOptions` so the constants live in TypeScript.
 */

class SegmentProcessor extends AudioWorkletProcessor {
  hop;
  blockSize;
  meterEvery;
  /** Samples seen within the current analysis hop. */
  hopIndex = 0;
  /** Squared-sum accumulator for the current hop. */
  hopSum = 0;
  /** Hop counter — used to pace metering messages. */
  hopsSeen = 0;
  /** Accumulator for one PCM block (+ transfer copy). */
  block;
  blockIndex = 0;

  constructor(options) {
    super(options);
    const o = options?.processorOptions ?? {};
    this.hop = o.hopSize ?? 512;
    this.blockSize = o.blockSize ?? 4096;
    this.meterEvery = o.meterEvery ?? 2;
    this.block = new Float32Array(this.blockSize);
  }

  process(inputs) {
    const channel = inputs?.[0]?.[0];
    if (!channel) return true;

    for (let i = 0; i < channel.length; i++) {
      const sample = channel[i];

      // Hop accumulation: RMS energy once per 512 samples (32 ms).
      this.hopSum += sample * sample;
      if (++this.hopIndex >= this.hop) {
        this.hopsSeen++;
        if (this.hopsSeen % this.meterEvery === 0) {
          this.port.postMessage({ type: 'meter', rms: Math.sqrt(this.hopSum / this.hop) });
        }
        this.hopIndex = 0;
        this.hopSum = 0;
      }

      // Block accumulation: hand PCM to the segmenter in fixed chunks.
      this.block[this.blockIndex++] = sample;
      if (this.blockIndex >= this.blockSize) {
        const block = this.block;
        this.block = new Float32Array(this.blockSize);
        this.blockIndex = 0;
        this.port.postMessage({ type: 'block', pcm: block }, [block.buffer]);
      }
    }
    // Keep processing even on silent input; we output nothing ourselves.
    return true;
  }
}

registerProcessor('segment-processor', SegmentProcessor);