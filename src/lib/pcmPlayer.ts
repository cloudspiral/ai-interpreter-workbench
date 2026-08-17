export class PcmPlayer {
  private nextStartTime = 0;
  private trailingByte: number | null = null;

  constructor(
    private readonly context: AudioContext,
    private readonly sampleRate = 24_000,
  ) {}

  enqueue(chunk: ArrayBuffer): void {
    const incoming = new Uint8Array(chunk);
    let bytes = incoming;

    if (this.trailingByte !== null) {
      const merged = new Uint8Array(incoming.byteLength + 1);
      merged[0] = this.trailingByte;
      merged.set(incoming, 1);
      bytes = merged;
      this.trailingByte = null;
    }

    if (bytes.byteLength % 2 === 1) {
      this.trailingByte = bytes.at(-1) ?? null;
      bytes = bytes.slice(0, -1);
    }

    if (bytes.byteLength === 0) return;

    const samples = bytes.byteLength / 2;
    const audioBuffer = this.context.createBuffer(1, samples, this.sampleRate);
    const channel = audioBuffer.getChannelData(0);
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);

    for (let index = 0; index < samples; index += 1) {
      channel[index] = view.getInt16(index * 2, true) / 32_768;
    }

    const source = this.context.createBufferSource();
    source.buffer = audioBuffer;
    source.connect(this.context.destination);

    const startAt = Math.max(this.context.currentTime + 0.025, this.nextStartTime);
    source.start(startAt);
    this.nextStartTime = startAt + audioBuffer.duration;
  }

  async drain(maxWaitMs = 5_000): Promise<void> {
    const remainingMs = Math.max(0, (this.nextStartTime - this.context.currentTime) * 1_000);
    if (remainingMs === 0) return;
    await new Promise((resolve) => window.setTimeout(resolve, Math.min(remainingMs, maxWaitMs)));
  }
}

