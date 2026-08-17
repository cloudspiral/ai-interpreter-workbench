const SENTENCE_BOUNDARY = /[.!?。！？]\s*$/u;

export interface ChunkerOptions {
  softLimit: number;
  hardLimit: number;
}

export class StableTextChunker {
  private buffer = "";

  constructor(private readonly options: ChunkerOptions) {}

  push(delta: string): string[] {
    this.buffer += delta;
    const chunks: string[] = [];

    while (this.buffer.length > 0) {
      const sentenceEnd = this.findSentenceBoundary();
      if (sentenceEnd >= 0) {
        chunks.push(this.take(sentenceEnd));
        continue;
      }

      if (this.buffer.length < this.options.hardLimit) break;
      chunks.push(this.take(this.findSafeSplit()));
    }

    return chunks;
  }

  flush(): string | null {
    const chunk = this.buffer.trim();
    this.buffer = "";
    return chunk || null;
  }

  pendingText(): string {
    return this.buffer;
  }

  private findSentenceBoundary(): number {
    for (let index = this.options.softLimit; index < this.buffer.length; index += 1) {
      const candidate = this.buffer.slice(0, index + 1);
      if (SENTENCE_BOUNDARY.test(candidate)) return index + 1;
    }
    return -1;
  }

  private findSafeSplit(): number {
    const candidate = this.buffer.slice(0, this.options.hardLimit);
    const whitespace = Math.max(candidate.lastIndexOf(" "), candidate.lastIndexOf("\n"));
    return whitespace >= this.options.softLimit ? whitespace + 1 : this.options.hardLimit;
  }

  private take(end: number): string {
    const chunk = this.buffer.slice(0, end).trim();
    this.buffer = this.buffer.slice(end).trimStart();
    return chunk;
  }
}
