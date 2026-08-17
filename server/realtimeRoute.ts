import { createHash } from "node:crypto";
import type { Express, Request } from "express";
import type { RealtimeSessionCreateRequest } from "openai/resources/realtime/realtime";
import type { AppConfig } from "./config.js";
import { PublicError, toPublicError } from "./errors.js";
import { interpreterInstructions, resolveLanguagePair } from "./languages.js";

function safetyIdentifier(request: Request, apiKey: string): string {
  return createHash("sha256")
    .update(`interpreter-workbench:${apiKey.slice(-8)}:${request.ip ?? "anonymous"}`)
    .digest("hex");
}

export function registerRealtimeRoute(app: Express, config: AppConfig): void {
  app.post("/api/realtime/session", async (request, response) => {
    try {
      if (!config.openAIKey) {
        throw new PublicError(
          "missing_api_key",
          "The server does not have an OpenAI API key configured.",
          false,
          503,
        );
      }

      const source = typeof request.query.source === "string" ? request.query.source : null;
      const target = typeof request.query.target === "string" ? request.query.target : null;
      const pair = resolveLanguagePair(source, target);
      if (!pair) {
        throw new PublicError("invalid_language_pair", "Choose a supported language pair.", false, 400);
      }

      if (typeof request.body !== "string" || !request.body.startsWith("v=")) {
        throw new PublicError("invalid_sdp", "The browser did not provide a valid WebRTC offer.", false, 400);
      }

      const session: RealtimeSessionCreateRequest = {
        type: "realtime",
        model: config.realtimeModel,
        instructions: interpreterInstructions(pair),
        output_modalities: ["audio"],
        max_output_tokens: 4096,
        audio: {
          input: {
            transcription: {
              model: config.transcriptionModel,
              language: pair.source,
              prompt: "Live professional interpretation. Preserve names, numbers, and punctuation.",
            },
            noise_reduction: { type: "near_field" },
            turn_detection: {
              type: "server_vad",
              threshold: 0.45,
              prefix_padding_ms: 300,
              silence_duration_ms: 450,
              create_response: true,
              interrupt_response: true,
            },
          },
          output: {
            voice: config.realtimeVoice,
            speed: 1,
          },
        },
      };

      const form = new FormData();
      form.set("sdp", request.body);
      form.set("session", JSON.stringify(session));

      const openAIResponse = await fetch("https://api.openai.com/v1/realtime/calls", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${config.openAIKey}`,
          "OpenAI-Safety-Identifier": safetyIdentifier(request, config.openAIKey),
        },
        body: form,
        signal: AbortSignal.timeout(20_000),
      });

      if (!openAIResponse.ok) {
        const status = openAIResponse.status;
        if (status === 401 || status === 403) {
          throw new PublicError(
            "provider_auth",
            "OpenAI rejected the configured API key or model access.",
            false,
            502,
          );
        }
        if (status === 404) {
          throw new PublicError(
            "model_unavailable",
            `The required Realtime model (${config.realtimeModel}) is unavailable for this account.`,
            false,
            502,
          );
        }
        if (status === 429) {
          throw new PublicError(
            "provider_rate_limit",
            "OpenAI is rate-limiting Realtime sessions. Wait briefly and retry.",
            true,
            429,
          );
        }
        throw new PublicError(
          "provider_failure",
          "OpenAI could not create the Realtime session.",
          status >= 500,
          502,
        );
      }

      response
        .status(201)
        .type("application/sdp")
        .send(await openAIResponse.text());
    } catch (error) {
      const publicError = toPublicError(error);
      response.status(publicError.status).json({
        error: {
          code: publicError.code,
          message: publicError.message,
          retryable: publicError.retryable,
        },
      });
    }
  });
}
