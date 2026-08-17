// @vitest-environment node

import { describe, expect, it } from "vitest";
import { LANGUAGE_PAIRS } from "../shared/protocol.js";
import { interpreterInstructions } from "./languages.js";

describe("interpreterInstructions", () => {
  it("requires target-language-only output and silence for noise-only turns", () => {
    const instructions = interpreterInstructions(LANGUAGE_PAIRS[0]);

    expect(instructions).toContain("Speak only the Japanese translation");
    expect(instructions).toContain("Every spoken response must be in Japanese");
    expect(instructions).toContain("produce no response and wait silently");
    expect(instructions).toContain("without inventing details or asking the speaker to repeat");
  });
});
