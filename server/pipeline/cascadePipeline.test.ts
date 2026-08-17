// @vitest-environment node

import { describe, expect, it, vi } from "vitest";
import { LANGUAGE_PAIRS, type CascadeServerEvent } from "../../shared/protocol.js";
import type { SpeechProvider, TranslationProvider } from "../providers/interfaces.js";
import { CascadePipeline } from "./cascadePipeline.js";

const models = {
  realtimeModel: "gpt-realtime",
  transcriptionModel: "gpt-4o-mini-transcribe",
  translationModel: "translation-test",
  ttsModel: "tts-test",
  apiKeyConfigured: true,
};

describe("CascadePipeline", () => {
  it("streams source text through translation and PCM speech with latency events", async () => {
    const events: CascadeServerEvent[] = [];
    const audio: Uint8Array[] = [];
    const translation: TranslationProvider = {
      translateStream: vi.fn(async (_text, _pair, onDelta) => {
        onDelta("こんにちは");
        onDelta("世界");
        return { text: "こんにちは世界", inputTokens: 8, outputTokens: 4 };
      }),
    };
    const speech: SpeechProvider = {
      synthesizeStream: vi.fn(async (_text, onAudio) => {
        onAudio(Uint8Array.from([1, 2, 3, 4]));
      }),
    };
    let time = 1_000;
    const pipeline = new CascadePipeline({
      pair: LANGUAGE_PAIRS[0],
      models,
      translation,
      speech,
      sendJson: (event) => events.push(event),
      sendAudio: (chunk) => audio.push(chunk),
      now: () => {
        time += 25;
        return time;
      },
    });

    pipeline.markSpeechStarted();
    pipeline.addSourceDelta("Hello, this is a complete sentence.");
    pipeline.markSpeechStopped();
    pipeline.completeSource("Hello, this is a complete sentence.");
    await pipeline.drain();

    expect(translation.translateStream).toHaveBeenCalledOnce();
    expect(speech.synthesizeStream).toHaveBeenCalledWith("こんにちは世界", expect.any(Function));
    expect(audio).toHaveLength(1);
    expect(events).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ type: "source_delta" }),
        expect.objectContaining({ type: "source_done" }),
        expect.objectContaining({ type: "target_delta", delta: "こんにちは" }),
        expect.objectContaining({ type: "target_done", translation: "こんにちは世界" }),
        expect.objectContaining({ type: "audio_start" }),
        expect.objectContaining({ type: "audio_end" }),
        expect.objectContaining({ type: "latency", stage: "stt" }),
        expect.objectContaining({ type: "latency", stage: "translation" }),
        expect.objectContaining({ type: "latency", stage: "tts" }),
        expect.objectContaining({ type: "latency", stage: "total" }),
        expect.objectContaining({ type: "usage", inputTokens: 8, outputTokens: 4 }),
      ]),
    );
  });

  it("surfaces provider failures as safe client errors", async () => {
    const events: CascadeServerEvent[] = [];
    const translation: TranslationProvider = {
      translateStream: vi.fn(async () => {
        throw new Error("secret upstream details");
      }),
    };
    const speech: SpeechProvider = {
      synthesizeStream: vi.fn(async () => undefined),
    };
    const pipeline = new CascadePipeline({
      pair: LANGUAGE_PAIRS[0],
      models,
      translation,
      speech,
      sendJson: (event) => events.push(event),
      sendAudio: () => undefined,
    });

    pipeline.markSpeechStarted();
    pipeline.addSourceDelta("This sentence is long enough to dispatch.");
    pipeline.completeSource("This sentence is long enough to dispatch.");
    await pipeline.drain();

    const error = events.find((event) => event.type === "error");
    expect(error).toEqual({
      type: "error",
      code: "internal_error",
      message: "The interpretation session ended unexpectedly.",
      retryable: true,
    });
    expect(JSON.stringify(events)).not.toContain("secret upstream details");
  });
});
