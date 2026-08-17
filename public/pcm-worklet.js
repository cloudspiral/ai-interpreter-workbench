class PcmCaptureProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.outputSamples = [];
    this.readPosition = 0;
    this.ratio = sampleRate / 24000;
    this.chunkSize = 2400;
  }

  process(inputs) {
    const channel = inputs[0]?.[0];
    if (!channel) return true;

    let position = this.readPosition;
    while (position < channel.length) {
      this.outputSamples.push(channel[Math.floor(position)] ?? 0);
      position += this.ratio;
    }
    this.readPosition = position - channel.length;

    while (this.outputSamples.length >= this.chunkSize) {
      const pcm = new Int16Array(this.chunkSize);
      for (let index = 0; index < this.chunkSize; index += 1) {
        const sample = Math.max(-1, Math.min(1, this.outputSamples[index] ?? 0));
        pcm[index] = sample < 0 ? sample * 32768 : sample * 32767;
      }
      this.outputSamples.splice(0, this.chunkSize);
      this.port.postMessage(pcm.buffer, [pcm.buffer]);
    }

    return true;
  }
}

registerProcessor("pcm-capture", PcmCaptureProcessor);
