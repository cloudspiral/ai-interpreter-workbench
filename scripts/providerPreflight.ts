import "dotenv/config";
import OpenAI from "openai";
import { loadConfig } from "../server/config.js";

const config = loadConfig();

if (!config.openAIKey) {
  console.error("FAIL OpenAI API key is not configured.");
  process.exitCode = 1;
} else {
  const client = new OpenAI({ apiKey: config.openAIKey, maxRetries: 0, timeout: 15_000 });
  const models = [
    ["Realtime", config.realtimeModel],
    ["Transcription", config.transcriptionModel],
    ["Translation", config.translationModel],
    ["Text to speech", config.ttsModel],
  ] as const;

  let failed = false;
  for (const [stage, model] of models) {
    try {
      await client.models.retrieve(model);
      console.log(`PASS ${stage}: ${model}`);
    } catch (error) {
      failed = true;
      const status = error instanceof OpenAI.APIError ? error.status : "unknown";
      console.error(`FAIL ${stage}: ${model} (provider status ${status})`);
    }
  }

  if (failed) process.exitCode = 1;
}
