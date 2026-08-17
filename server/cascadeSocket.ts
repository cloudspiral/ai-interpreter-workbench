import type { IncomingMessage, Server } from "node:http";
import type { Duplex } from "node:stream";
import WebSocket, { WebSocketServer, type RawData } from "ws";
import type {
  CascadeClientEvent,
  CascadeServerEvent,
} from "../shared/protocol.js";
import type { AppConfig } from "./config.js";
import { publicRuntimeConfig } from "./config.js";
import { PublicError, toPublicError } from "./errors.js";
import { resolveLanguagePair } from "./languages.js";
import { CascadePipeline } from "./pipeline/cascadePipeline.js";
import { OpenAISpeechProvider } from "./providers/openaiSpeech.js";
import { OpenAITranslationProvider } from "./providers/openaiTranslation.js";

interface OpenAIRealtimeEvent {
  type: string;
  delta?: string;
  transcript?: string;
  error?: { code?: string; message?: string };
}

const MAX_QUEUED_AUDIO_BYTES = 2_400_000;
export const OPENAI_TRANSCRIPTION_SOCKET_URL =
  "wss://api.openai.com/v1/realtime?intent=transcription";

export function transcriptionSessionUpdate(model: string, sourceLanguage: string) {
  return {
    type: "session.update",
    session: {
      type: "transcription",
      audio: {
        input: {
          format: { type: "audio/pcm", rate: 24000 },
          noise_reduction: { type: "near_field" },
          transcription: {
            model,
            language: sourceLanguage,
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
  } as const;
}

export function registerCascadeSocket(server: Server, config: AppConfig): void {
  const socketServer = new WebSocketServer({ noServer: true });

  server.on("upgrade", (request, socket: Duplex, head) => {
    const url = new URL(request.url ?? "/", `http://${request.headers.host ?? "localhost"}`);
    if (url.pathname !== "/api/cascade") return;

    socketServer.handleUpgrade(request, socket, head, (client) => {
      socketServer.emit("connection", client, request);
    });
  });

  socketServer.on("connection", (client: WebSocket, request: IncomingMessage) => {
    const connectionUrl = new URL(
      request.url ?? "/api/cascade",
      `http://${request.headers.host ?? "localhost"}`,
    );
    const pair = resolveLanguagePair(
      connectionUrl.searchParams.get("source"),
      connectionUrl.searchParams.get("target"),
    );

    const sendJson = (event: CascadeServerEvent) => {
      if (client.readyState === WebSocket.OPEN) client.send(JSON.stringify(event));
    };

    if (!pair) {
      sendJson({
        type: "error",
        code: "invalid_language_pair",
        message: "Choose a supported language pair.",
        retryable: false,
      });
      client.close(1008, "Invalid language pair");
      return;
    }

    if (!config.openAIKey) {
      sendJson({
        type: "error",
        code: "missing_api_key",
        message: "The server does not have an OpenAI API key configured.",
        retryable: false,
      });
      client.close(1011, "Missing API key");
      return;
    }

    const translation = new OpenAITranslationProvider(config.openAIKey, config.translationModel);
    const speech = new OpenAISpeechProvider(config.openAIKey, config.ttsModel, config.ttsVoice);
    const pipeline = new CascadePipeline({
      pair,
      models: publicRuntimeConfig(config),
      translation,
      speech,
      sendJson,
      sendAudio: (chunk) => {
        if (client.readyState === WebSocket.OPEN) client.send(chunk, { binary: true });
      },
    });

    const upstream = new WebSocket(
      OPENAI_TRANSCRIPTION_SOCKET_URL,
      {
        headers: {
          Authorization: `Bearer ${config.openAIKey}`,
          "OpenAI-Safety-Identifier": "interpreter-workbench-demo",
        },
        handshakeTimeout: 20_000,
      },
    );

    let upstreamReady = false;
    let upstreamFailed = false;
    let closed = false;
    let queuedBytes = 0;
    let bytesSinceCommit = 0;
    const queuedAudio: Buffer[] = [];

    const fail = (error: unknown) => {
      if (closed) return;
      upstreamFailed = true;
      const publicError = toPublicError(error);
      sendJson({
        type: "error",
        code: publicError.code,
        message: publicError.message,
        retryable: publicError.retryable,
      });
    };

    const sendAudioToOpenAI = (audio: Buffer) => {
      if (upstream.readyState !== WebSocket.OPEN) return;
      upstream.send(
        JSON.stringify({
          type: "input_audio_buffer.append",
          audio: audio.toString("base64"),
        }),
      );
      bytesSinceCommit += audio.byteLength;
    };

    const commitAudio = () => {
      if (upstream.readyState === WebSocket.OPEN && bytesSinceCommit >= 4_800) {
        upstream.send(JSON.stringify({ type: "input_audio_buffer.commit" }));
        bytesSinceCommit = 0;
      }
    };

    const markUpstreamReady = () => {
      if (upstreamReady || closed) return;
      upstreamReady = true;
      for (const audio of queuedAudio.splice(0)) sendAudioToOpenAI(audio);
      queuedBytes = 0;
      sendJson({ type: "ready", models: publicRuntimeConfig(config) });
      sendJson({ type: "status", status: "listening", message: "Cascade pipeline ready" });
    };

    upstream.on("open", () => {
      upstream.send(JSON.stringify(transcriptionSessionUpdate(config.transcriptionModel, pair.source)));
    });

    upstream.on("message", (raw) => {
      try {
        const event = JSON.parse(raw.toString()) as OpenAIRealtimeEvent;
        switch (event.type) {
          case "session.updated":
            markUpstreamReady();
            break;
          case "input_audio_buffer.speech_started":
            pipeline.markSpeechStarted();
            break;
          case "input_audio_buffer.speech_stopped":
            pipeline.markSpeechStopped();
            break;
          case "input_audio_buffer.committed":
            bytesSinceCommit = 0;
            break;
          case "conversation.item.input_audio_transcription.delta":
            pipeline.addSourceDelta(event.delta ?? "");
            break;
          case "conversation.item.input_audio_transcription.completed":
            pipeline.completeSource(event.transcript ?? "");
            break;
          case "conversation.item.input_audio_transcription.failed":
            fail(new PublicError(
              "transcription_failed",
              "OpenAI could not transcribe this speech turn.",
              true,
              502,
            ));
            break;
          case "error":
            fail(new PublicError(
              event.error?.code ?? "transcription_provider_error",
              "The live transcription provider reported an error.",
              true,
              502,
            ));
            break;
          default:
            break;
        }
      } catch {
        fail(new PublicError(
          "invalid_provider_event",
          "The transcription provider returned an unreadable event.",
          true,
          502,
        ));
      }
    });

    upstream.on("error", () => {
      fail(new PublicError(
        "transcription_connection_failed",
        "Could not connect to OpenAI live transcription.",
        true,
        502,
      ));
    });

    upstream.on("close", () => {
      if (!closed && !upstreamFailed) {
        sendJson({
          type: "status",
          status: "idle",
          message: "Transcription connection closed",
        });
      }
    });

    client.on("message", (raw: RawData, binary: boolean) => {
      if (binary) {
        const audio = Buffer.isBuffer(raw) ? raw : Buffer.from(raw as ArrayBuffer);
        if (upstreamReady) {
          sendAudioToOpenAI(audio);
          return;
        }

        queuedBytes += audio.byteLength;
        if (queuedBytes > MAX_QUEUED_AUDIO_BYTES) {
          fail(new PublicError(
            "audio_queue_overflow",
            "The transcription connection took too long to initialize.",
            true,
            503,
          ));
          client.close(1013, "Upstream initialization timeout");
          return;
        }
        queuedAudio.push(audio);
        return;
      }

      try {
        const event = JSON.parse(raw.toString()) as CascadeClientEvent;
        if (event.type === "commit") commitAudio();
        if (event.type === "ping") {
          sendJson({ type: "status", status: "listening", message: "Connection healthy" });
        }
        if (event.type === "stop") {
          commitAudio();
          void pipeline.drain();
        }
      } catch {
        fail(new PublicError("invalid_client_event", "The browser sent an invalid control event.", false, 400));
      }
    });

    client.on("close", () => {
      closed = true;
      pipeline.close();
      if (upstream.readyState === WebSocket.OPEN || upstream.readyState === WebSocket.CONNECTING) {
        upstream.close(1000, "Browser disconnected");
      }
    });
  });
}
