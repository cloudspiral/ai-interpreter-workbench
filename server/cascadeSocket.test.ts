// @vitest-environment node

import { describe, expect, it } from "vitest";
import {
  OPENAI_TRANSCRIPTION_SOCKET_URL,
  transcriptionSessionUpdate,
} from "./cascadeSocket.js";

describe("OpenAI cascade transcription handshake", () => {
  it("opens the dedicated transcription intent rather than treating STT as a Realtime voice model", () => {
    expect(OPENAI_TRANSCRIPTION_SOCKET_URL).toBe(
      "wss://api.openai.com/v1/realtime?intent=transcription",
    );
  });

  it("uses a VAD-capable streaming transcription session without conversation-only flags", () => {
    expect(transcriptionSessionUpdate("gpt-4o-mini-transcribe", "en")).toEqual({
      type: "session.update",
      session: {
        type: "transcription",
        audio: {
          input: {
            format: { type: "audio/pcm", rate: 24000 },
            noise_reduction: { type: "near_field" },
            transcription: {
              model: "gpt-4o-mini-transcribe",
              language: "en",
            },
            turn_detection: {
              type: "server_vad",
              threshold: 0.45,
              prefix_padding_ms: 300,
              silence_duration_ms: 450,
            },
          },
        },
      },
    });
  });
});
