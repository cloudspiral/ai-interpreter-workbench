import OpenAI from "openai";
import { PublicError } from "../errors.js";
import type { SpeechProvider } from "./interfaces.js";

export class OpenAISpeechProvider implements SpeechProvider {
  private readonly client: OpenAI;

  constructor(
    apiKey: string,
    private readonly model: string,
    private readonly voice: string,
  ) {
    this.client = new OpenAI({ apiKey, maxRetries: 1, timeout: 20_000 });
  }

  async synthesizeStream(text: string, onAudio: (chunk: Uint8Array) => void): Promise<void> {
    const response = await this.client.audio.speech.create({
      model: this.model,
      voice: this.voice,
      input: text,
      response_format: "pcm",
      stream_format: "audio",
    });

    if (!response.body) {
      throw new PublicError(
        "empty_speech",
        "OpenAI returned no audio for the translated speech fragment.",
        true,
        502,
      );
    }

    const reader = response.body.getReader();
    let bytesReceived = 0;

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (value.byteLength === 0) continue;
      bytesReceived += value.byteLength;
      onAudio(value);
    }

    if (bytesReceived === 0) {
      throw new PublicError(
        "empty_speech",
        "OpenAI returned an empty audio stream for the translation.",
        true,
        502,
      );
    }
  }
}
