// @vitest-environment node

import { describe, expect, it } from "vitest";
import { StableTextChunker } from "./chunker.js";

describe("StableTextChunker", () => {
  it("emits a complete sentence once the stability threshold is met", () => {
    const chunker = new StableTextChunker({ softLimit: 10, hardLimit: 30 });

    expect(chunker.push("This is a complete sentence. Next")).toEqual([
      "This is a complete sentence.",
    ]);
    expect(chunker.pendingText()).toBe("Next");
  });

  it("uses a safe word boundary when a stream exceeds the hard limit", () => {
    const chunker = new StableTextChunker({ softLimit: 8, hardLimit: 18 });

    expect(chunker.push("one two three four five six")).toEqual(["one two three"]);
    expect(chunker.pendingText()).toBe("four five six");
  });

  it("flushes a short final fragment without returning empty text", () => {
    const chunker = new StableTextChunker({ softLimit: 10, hardLimit: 20 });

    expect(chunker.push("short")).toEqual([]);
    expect(chunker.flush()).toBe("short");
    expect(chunker.flush()).toBeNull();
  });
});
