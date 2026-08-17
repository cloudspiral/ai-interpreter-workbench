export const LANGUAGE_PAIRS = [
  { id: "en-ja", source: "en", sourceName: "English", target: "ja", targetName: "Japanese" },
  { id: "ja-en", source: "ja", sourceName: "Japanese", target: "en", targetName: "English" },
  { id: "en-es", source: "en", sourceName: "English", target: "es", targetName: "Spanish" },
  { id: "es-en", source: "es", sourceName: "Spanish", target: "en", targetName: "English" },
] as const;

export type LanguagePair = (typeof LANGUAGE_PAIRS)[number];
export type LanguageCode = LanguagePair["source"] | LanguagePair["target"];
export type InterpreterMode = "realtime" | "cascade";
export type ConnectionStatus = "idle" | "connecting" | "listening" | "speaking" | "error";
export type LatencyStage = "stt" | "translation" | "tts" | "total";

export interface RuntimeConfig {
  realtimeModel: string;
  transcriptionModel: string;
  translationModel: string;
  ttsModel: string;
  apiKeyConfigured: boolean;
}

export type CascadeServerEvent =
  | { type: "ready"; models: RuntimeConfig }
  | { type: "status"; status: ConnectionStatus; message: string }
  | { type: "source_delta"; delta: string; turnId: number }
  | { type: "source_done"; transcript: string; turnId: number }
  | { type: "target_delta"; delta: string; turnId: number }
  | { type: "target_done"; translation: string; turnId: number }
  | { type: "audio_start"; segmentId: number; turnId: number; sampleRate: 24000 }
  | { type: "audio_end"; segmentId: number; turnId: number }
  | { type: "latency"; stage: LatencyStage; milliseconds: number; turnId: number; basis?: string }
  | { type: "usage"; inputTokens: number; outputTokens: number; turnId: number }
  | { type: "error"; code: string; message: string; retryable: boolean };

export type CascadeClientEvent = { type: "commit" } | { type: "stop" } | { type: "ping" };
