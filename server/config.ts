import { z } from "zod";

const environmentSchema = z.object({
  OPENAI_API_KEY: z.string().trim().min(1).optional(),
  OPENAI_REALTIME_MODEL: z.string().trim().min(1).default("gpt-realtime"),
  OPENAI_TRANSCRIPTION_MODEL: z.string().trim().min(1).default("gpt-4o-mini-transcribe"),
  OPENAI_TRANSLATION_MODEL: z.string().trim().min(1).default("gpt-5.4-mini"),
  OPENAI_TTS_MODEL: z.string().trim().min(1).default("tts-1"),
  OPENAI_REALTIME_VOICE: z.string().trim().min(1).default("marin"),
  OPENAI_TTS_VOICE: z.string().trim().min(1).default("coral"),
  PORT: z.coerce.number().int().positive().default(3001),
});

export interface AppConfig {
  openAIKey?: string;
  realtimeModel: string;
  transcriptionModel: string;
  translationModel: string;
  ttsModel: string;
  realtimeVoice: string;
  ttsVoice: string;
  port: number;
}

export function loadConfig(environment: NodeJS.ProcessEnv = process.env): AppConfig {
  const parsed = environmentSchema.parse(environment);
  return {
    openAIKey: parsed.OPENAI_API_KEY,
    realtimeModel: parsed.OPENAI_REALTIME_MODEL,
    transcriptionModel: parsed.OPENAI_TRANSCRIPTION_MODEL,
    translationModel: parsed.OPENAI_TRANSLATION_MODEL,
    ttsModel: parsed.OPENAI_TTS_MODEL,
    realtimeVoice: parsed.OPENAI_REALTIME_VOICE,
    ttsVoice: parsed.OPENAI_TTS_VOICE,
    port: parsed.PORT,
  };
}

export function publicRuntimeConfig(config: AppConfig) {
  return {
    realtimeModel: config.realtimeModel,
    transcriptionModel: config.transcriptionModel,
    translationModel: config.translationModel,
    ttsModel: config.ttsModel,
    apiKeyConfigured: Boolean(config.openAIKey),
  };
}
