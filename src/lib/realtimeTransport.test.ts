import { describe, expect, it } from "vitest";
import { hasAudibleSignal } from "./realtimeTransport";

describe("hasAudibleSignal", () => {
  it("ignores silence and low-level WebRTC noise", () => {
    expect(hasAudibleSignal(new Float32Array(512))).toBe(false);
    expect(hasAudibleSignal(Float32Array.from({ length: 512 }, () => 0.005))).toBe(false);
  });

  it("detects a remote speech waveform above the output threshold", () => {
    const speech = Float32Array.from({ length: 512 }, (_, index) =>
      Math.sin(index / 4) * 0.08,
    );

    expect(hasAudibleSignal(speech)).toBe(true);
  });
});
