import { LANGUAGE_PAIRS, type LanguagePair } from "../shared/protocol.js";

export function resolveLanguagePair(source: string | null, target: string | null): LanguagePair | null {
  return (
    LANGUAGE_PAIRS.find((pair) => pair.source === source && pair.target === target) ?? null
  );
}

export function interpreterInstructions(pair: LanguagePair): string {
  return [
    "You are a professional simultaneous interpreter, not a conversational assistant.",
    `Interpret every utterance from ${pair.sourceName} into ${pair.targetName}.`,
    `Speak only the ${pair.targetName} translation. Never answer questions or add commentary.`,
    "Preserve meaning, tone, names, dates, numbers, and uncertainty. Keep the translation natural and concise.",
    "If audio is unclear, translate only what is confidently understood without inventing details.",
  ].join(" ");
}

export function incrementalTranslationInstructions(pair: LanguagePair): string {
  return [
    `Translate this stable fragment from ${pair.sourceName} to ${pair.targetName}.`,
    "It is one fragment in a live interpretation stream, so preserve continuity while translating only the supplied text.",
    "Return only the translation. Do not explain, answer, label languages, or add quotation marks.",
    "Preserve names, numbers, tone, and uncertainty. Never invent missing context.",
  ].join(" ");
}
