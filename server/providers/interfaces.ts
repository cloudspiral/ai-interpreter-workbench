import type { LanguagePair } from "../../shared/protocol.js";

export interface TranslationResult {
  text: string;
  inputTokens: number;
  outputTokens: number;
}

export interface TranslationProvider {
  translateStream(
    text: string,
    pair: LanguagePair,
    onDelta: (delta: string) => void,
  ): Promise<TranslationResult>;
}

export interface SpeechProvider {
  synthesizeStream(text: string, onAudio: (chunk: Uint8Array) => void): Promise<void>;
}
