import "dotenv/config";
import { readFile } from "node:fs/promises";
import WebSocket, { type RawData } from "ws";
import { loadConfig } from "../server/config.js";
import { OpenAISpeechProvider } from "../server/providers/openaiSpeech.js";
import type { CascadeServerEvent } from "../shared/protocol.js";

const FRAME_BYTES = 4_800;
const FRAME_MILLISECONDS = 100;
const TURN_GAP_MILLISECONDS = 800;
const COMPLETION_TIMEOUT_MILLISECONDS = 30_000;
const CASCADE_TARGET_MILLISECONDS = 3_000;

const [socketUrl, ...pcmPaths] = process.argv.slice(2);

if (!socketUrl) {
  console.error(
    "Usage: pnpm smoke:live:cascade <wss-url> [first-24khz-mono-s16le.pcm second-24khz-mono-s16le.pcm]",
  );
  process.exitCode = 2;
} else {
  await runSmoke(socketUrl, pcmPaths.slice(0, 2));
}

async function runSmoke(url: string, paths: string[]): Promise<void> {
  const audioInputs = paths.length === 2
    ? await Promise.all(paths.map((path) => readFile(path)))
    : await synthesizeFixtures();
  const socket = new WebSocket(url, { handshakeTimeout: 20_000 });
  const events: CascadeServerEvent[] = [];
  const errors: string[] = [];
  let outputAudioBytes = 0;
  let readyResolve: (() => void) | undefined;
  let readyReject: ((error: Error) => void) | undefined;
  let completionResolve: (() => void) | undefined;
  let completionReject: ((error: Error) => void) | undefined;

  const ready = new Promise<void>((resolve, reject) => {
    readyResolve = resolve;
    readyReject = reject;
  });
  const completed = new Promise<void>((resolve, reject) => {
    completionResolve = resolve;
    completionReject = reject;
  });

  const timeout = setTimeout(() => {
    completionReject?.(new Error("Timed out waiting for two translated audio turns."));
  }, COMPLETION_TIMEOUT_MILLISECONDS);

  socket.on("message", (raw: RawData, isBinary: boolean) => {
    if (isBinary) {
      outputAudioBytes += raw instanceof Buffer ? raw.byteLength : Buffer.from(raw as ArrayBuffer).byteLength;
      return;
    }

    try {
      const event = JSON.parse(raw.toString()) as CascadeServerEvent;
      events.push(event);
      if (event.type === "ready") readyResolve?.();
      if (event.type === "error") {
        errors.push(`${event.code}: ${event.message}`);
        const error = new Error(errors.at(-1));
        readyReject?.(error);
        completionReject?.(error);
      }
      if (
        events.filter((candidate) => candidate.type === "target_done").length >= 2
        && events.filter((candidate) => candidate.type === "audio_end").length >= 2
      ) {
        completionResolve?.();
      }
    } catch {
      errors.push("invalid_server_event");
      completionReject?.(new Error("The deployed server returned invalid JSON."));
    }
  });

  socket.on("error", (error) => {
    readyReject?.(error);
    completionReject?.(error);
  });
  socket.on("close", (code) => {
    if (code !== 1000) completionReject?.(new Error(`Socket closed with code ${code}.`));
  });

  try {
    await ready;
    await streamPcm(socket, audioInputs[0]);
    await streamSilence(socket, TURN_GAP_MILLISECONDS);
    await streamPcm(socket, audioInputs[1]);
    await streamSilence(socket, TURN_GAP_MILLISECONDS);
    await completed;

    const sourceTurns = events.filter(
      (event): event is Extract<CascadeServerEvent, { type: "source_done" }> =>
        event.type === "source_done" && event.transcript.trim().length > 0,
    );
    const targetTurns = events.filter(
      (event): event is Extract<CascadeServerEvent, { type: "target_done" }> =>
        event.type === "target_done" && event.translation.trim().length > 0,
    );
    const audioTurns = events.filter(
      (event): event is Extract<CascadeServerEvent, { type: "audio_end" }> =>
        event.type === "audio_end",
    );
    const totalLatency = events.filter(
      (event): event is Extract<CascadeServerEvent, { type: "latency" }> =>
        event.type === "latency" && event.stage === "total",
    );

    const failures: string[] = [];
    const firstTwoSources = sourceTurns.slice(0, 2);
    const sourceText = firstTwoSources.map((turn) => turn.transcript.toLowerCase());
    const uniqueTurnIds = new Set(firstTwoSources.map((turn) => turn.turnId));
    const expectedWords = ["sky", "blue", "grass", "green"];

    if (errors.length > 0) failures.push(...errors);
    if (firstTwoSources.length !== 2) failures.push(`expected 2 non-empty source turns, received ${firstTwoSources.length}`);
    if (uniqueTurnIds.size !== 2) failures.push("source turns did not receive distinct IDs");
    if (expectedWords.some((word) => !sourceText.join(" ").includes(word))) {
      failures.push(`source transcripts missed expected words: ${sourceText.join(" | ")}`);
    }
    if (sourceText.some((text) => text.includes("sky") && text.includes("grass"))) {
      failures.push("two spoken turns were merged into one source transcript");
    }
    for (const turn of firstTwoSources) {
      if (!targetTurns.some((target) => target.turnId === turn.turnId)) {
        failures.push(`turn ${turn.turnId} has no completed Japanese translation`);
      }
      if (!audioTurns.some((audio) => audio.turnId === turn.turnId)) {
        failures.push(`turn ${turn.turnId} has no completed audio segment`);
      }
      if (!totalLatency.some((latency) => latency.turnId === turn.turnId)) {
        failures.push(`turn ${turn.turnId} has no total latency measurement`);
      }
    }
    for (const latency of totalLatency.filter((turn) => uniqueTurnIds.has(turn.turnId))) {
      if (latency.milliseconds > CASCADE_TARGET_MILLISECONDS) {
        failures.push(
          `turn ${latency.turnId} total latency ${latency.milliseconds}ms exceeded the ${CASCADE_TARGET_MILLISECONDS}ms target`,
        );
      }
    }
    if (outputAudioBytes === 0) failures.push("server returned no synthesized audio bytes");

    const report = {
      status: failures.length === 0 ? "PASS" : "FAIL",
      sourceTurns: firstTwoSources.map(({ turnId, transcript }) => ({ turnId, transcript })),
      targetTurns: targetTurns
        .filter((turn) => uniqueTurnIds.has(turn.turnId))
        .map(({ turnId, translation }) => ({ turnId, translation })),
      totalLatencyMs: totalLatency
        .filter((turn) => uniqueTurnIds.has(turn.turnId))
        .map(({ turnId, milliseconds }) => ({ turnId, milliseconds })),
      stageLatencyMs: events
        .filter((event): event is Extract<CascadeServerEvent, { type: "latency" }> =>
          event.type === "latency" && uniqueTurnIds.has(event.turnId))
        .map(({ turnId, stage, milliseconds }) => ({ turnId, stage, milliseconds })),
      outputAudioBytes,
      failures,
    };
    console.log(JSON.stringify(report, null, 2));
    if (failures.length > 0) process.exitCode = 1;
  } catch (error) {
    process.exitCode = 1;
    console.error(JSON.stringify({
      status: "FAIL",
      error: error instanceof Error ? error.message : "Unknown smoke-test failure",
      eventTypes: events.map((event) => event.type),
      sourceTurns: events
        .filter((event): event is Extract<CascadeServerEvent, { type: "source_done" }> => event.type === "source_done")
        .map(({ turnId, transcript }) => ({ turnId, transcript })),
      targetTurns: events
        .filter((event): event is Extract<CascadeServerEvent, { type: "target_done" }> => event.type === "target_done")
        .map(({ turnId, translation }) => ({ turnId, translation })),
      outputAudioBytes,
      errors,
    }, null, 2));
  } finally {
    clearTimeout(timeout);
    if (socket.readyState === WebSocket.OPEN) {
      socket.send(JSON.stringify({ type: "stop" }));
      await delay(250);
      socket.close(1000, "Automated smoke complete");
    }
  }
}

async function synthesizeFixtures(): Promise<Buffer[]> {
  const config = loadConfig();
  if (!config.openAIKey) {
    throw new Error("OPENAI_API_KEY is required when PCM fixture paths are omitted.");
  }

  const provider = new OpenAISpeechProvider(config.openAIKey, config.ttsModel, config.ttsVoice);
  return Promise.all([
    synthesizePcm(provider, "The sky is blue."),
    synthesizePcm(provider, "The grass is green."),
  ]);
}

async function synthesizePcm(provider: OpenAISpeechProvider, text: string): Promise<Buffer> {
  const chunks: Buffer[] = [];
  await provider.synthesizeStream(text, (chunk) => chunks.push(Buffer.from(chunk)));
  return Buffer.concat(chunks);
}

async function streamPcm(socket: WebSocket, audio: Buffer): Promise<void> {
  for (let offset = 0; offset < audio.byteLength; offset += FRAME_BYTES) {
    socket.send(audio.subarray(offset, Math.min(offset + FRAME_BYTES, audio.byteLength)), { binary: true });
    await delay(FRAME_MILLISECONDS);
  }
}

async function streamSilence(socket: WebSocket, milliseconds: number): Promise<void> {
  const frames = Math.ceil(milliseconds / FRAME_MILLISECONDS);
  for (let index = 0; index < frames; index += 1) {
    socket.send(Buffer.alloc(FRAME_BYTES), { binary: true });
    await delay(FRAME_MILLISECONDS);
  }
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}
