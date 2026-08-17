import OpenAI from "openai";
import type { LanguagePair } from "../../shared/protocol.js";
import { PublicError } from "../errors.js";
import { incrementalTranslationInstructions } from "../languages.js";
import type { TranslationProvider, TranslationResult } from "./interfaces.js";

export class OpenAITranslationProvider implements TranslationProvider {
  private readonly client: OpenAI;

  constructor(
    apiKey: string,
    private readonly model: string,
  ) {
    this.client = new OpenAI({ apiKey, maxRetries: 1, timeout: 20_000 });
  }

  async translateStream(
    text: string,
    pair: LanguagePair,
    onDelta: (delta: string) => void,
  ): Promise<TranslationResult> {
    const stream = await this.client.responses.create({
      model: this.model,
      instructions: incrementalTranslationInstructions(pair),
      input: text,
      reasoning: { effort: "none" },
      stream: true,
    });

    let translation = "";
    let inputTokens = 0;
    let outputTokens = 0;

    for await (const event of stream) {
      if (event.type === "response.output_text.delta") {
        translation += event.delta;
        onDelta(event.delta);
      }

      if (event.type === "response.completed") {
        inputTokens = event.response.usage?.input_tokens ?? 0;
        outputTokens = event.response.usage?.output_tokens ?? 0;
      }
    }

    const normalized = translation.trim();
    if (!normalized) {
      throw new PublicError(
        "empty_translation",
        "OpenAI returned an empty translation for this speech fragment.",
        true,
        502,
      );
    }

    return { text: normalized, inputTokens, outputTokens };
  }
}
