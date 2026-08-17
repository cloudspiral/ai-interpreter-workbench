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

  it("keeps out-of-order transcription completions attached to their provider item IDs", async () => {
    const events: CascadeServerEvent[] = [];
    const translation: TranslationProvider = {
      translateStream: vi.fn(async (text, _pair, onDelta) => {
        const translated = `JA:${text}`;
        onDelta(translated);
        return { text: translated, inputTokens: 2, outputTokens: 2 };
      }),
    };
    const speech: SpeechProvider = {
      synthesizeStream: vi.fn(async (_text, onAudio) => {
        onAudio(Uint8Array.from([1, 2]));
      }),
    };
    const pipeline = new CascadePipeline({
      pair: LANGUAGE_PAIRS[0],
      models,
      translation,
      speech,
      sendJson: (event) => events.push(event),
      sendAudio: () => undefined,
    });

    pipeline.markSpeechStarted("item-a");
    pipeline.addSourceDelta("First message.", "item-a");
    pipeline.markSpeechStopped("item-a");
    pipeline.markSpeechStarted("item-b");
    pipeline.addSourceDelta("Second message.", "item-b");
    pipeline.markSpeechStopped("item-b");

    pipeline.completeSource("First message.", "item-a");
    pipeline.completeSource("Second message.", "item-b");
    await pipeline.drain();

    expect(translation.translateStream).toHaveBeenNthCalledWith(
      1,
      "First message.",
      LANGUAGE_PAIRS[0],
      expect.any(Function),
    );
    expect(translation.translateStream).toHaveBeenNthCalledWith(
      2,
      "Second message.",
      LANGUAGE_PAIRS[0],
      expect.any(Function),
    );
    expect(events).toEqual(expect.arrayContaining([
      expect.objectContaining({ type: "source_done", transcript: "First message.", turnId: 1 }),
      expect.objectContaining({ type: "source_done", transcript: "Second message.", turnId: 2 }),
      expect.objectContaining({ type: "target_done", translation: "JA:First message.", turnId: 1 }),
      expect.objectContaining({ type: "target_done", translation: "JA:Second message.", turnId: 2 }),
    ]));
  });

  it("drops VAD-only empty turns without creating transcript cards or provider work", async () => {
    const events: CascadeServerEvent[] = [];
    const translation: TranslationProvider = {
      translateStream: vi.fn(async () => ({ text: "", inputTokens: 0, outputTokens: 0 })),
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

    pipeline.markSpeechStarted("empty-item");
    pipeline.markSpeechStopped("empty-item");
    pipeline.completeSource("", "empty-item");
    await pipeline.drain();

    expect(translation.translateStream).not.toHaveBeenCalled();
    expect(events.some((event) => event.type === "source_done")).toBe(false);
    expect(events.some((event) => event.type === "target_done")).toBe(false);
  });
});
