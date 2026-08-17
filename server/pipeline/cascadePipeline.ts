import type {
  CascadeServerEvent,
  LanguagePair,
  RuntimeConfig,
} from "../../shared/protocol.js";
import { toPublicError } from "../errors.js";
import type { SpeechProvider, TranslationProvider } from "../providers/interfaces.js";
import { StableTextChunker } from "./chunker.js";

interface TurnState {
  id: number;
  source: string;
  target: string;
  speechStartedAt: number;
  speechStoppedAt?: number;
  firstSourceAt?: number;
  firstAudioAt?: number;
  inputTokens: number;
  outputTokens: number;
}

export interface CascadePipelineOptions {
  pair: LanguagePair;
  models: RuntimeConfig;
  translation: TranslationProvider;
  speech: SpeechProvider;
  sendJson: (event: CascadeServerEvent) => void;
  sendAudio: (chunk: Uint8Array) => void;
  now?: () => number;
}

export class CascadePipeline {
  private readonly sourceChunker: StableTextChunker;
  private readonly now: () => number;
  private workQueue: Promise<void> = Promise.resolve();
  private turnSequence = 0;
  private audioSequence = 0;
  private currentTurn?: TurnState;
  private closed = false;

  constructor(private readonly options: CascadePipelineOptions) {
    const japaneseSource = options.pair.source === "ja";
    this.sourceChunker = new StableTextChunker({
      softLimit: japaneseSource ? 10 : 22,
      hardLimit: japaneseSource ? 22 : 52,
    });
    this.now = options.now ?? Date.now;
  }

  markSpeechStarted(): void {
    if (this.closed) return;
    this.currentTurn = {
      id: ++this.turnSequence,
      source: "",
      target: "",
      speechStartedAt: this.now(),
      inputTokens: 0,
      outputTokens: 0,
    };
    this.options.sendJson({ type: "status", status: "listening", message: "Speech detected" });
  }

  markSpeechStopped(): void {
    if (!this.currentTurn || this.closed) return;
    this.currentTurn.speechStoppedAt = this.now();
    this.options.sendJson({ type: "status", status: "speaking", message: "Finishing this turn" });
  }

  addSourceDelta(delta: string): void {
    if (this.closed || !delta) return;
    const turn = this.ensureTurn();
    turn.source += delta;

    if (!turn.firstSourceAt) {
      turn.firstSourceAt = this.now();
      this.emitLatency(turn, "stt", turn.firstSourceAt - turn.speechStartedAt, "speech-start → first transcript");
    }

    this.options.sendJson({ type: "source_delta", delta, turnId: turn.id });
    for (const chunk of this.sourceChunker.push(delta)) {
      this.enqueueTranslation(turn, chunk);
    }
  }

  completeSource(transcript: string): void {
    if (this.closed) return;
    const turn = this.ensureTurn();

    if (!turn.source && transcript) {
      turn.source = transcript;
      this.options.sendJson({ type: "source_delta", delta: transcript, turnId: turn.id });
    }

    const pending = this.sourceChunker.flush();
    if (pending) this.enqueueTranslation(turn, pending);

    this.options.sendJson({
      type: "source_done",
      transcript: transcript || turn.source,
      turnId: turn.id,
    });

    const finishingQueue = this.workQueue;
    void finishingQueue.then(() => {
      if (this.closed) return;
      this.options.sendJson({ type: "target_done", translation: turn.target.trim(), turnId: turn.id });
      this.options.sendJson({
        type: "usage",
        inputTokens: turn.inputTokens,
        outputTokens: turn.outputTokens,
        turnId: turn.id,
      });
      this.options.sendJson({ type: "status", status: "listening", message: "Ready for the next turn" });
    });
  }

  async drain(): Promise<void> {
    const pending = this.sourceChunker.flush();
    if (pending && this.currentTurn) this.enqueueTranslation(this.currentTurn, pending);
    await this.workQueue;
  }

  close(): void {
    this.closed = true;
  }

  private ensureTurn(): TurnState {
    if (!this.currentTurn) this.markSpeechStarted();
    return this.currentTurn!;
  }

  private enqueueTranslation(turn: TurnState, sourceChunk: string): void {
    if (!sourceChunk) return;
    this.workQueue = this.workQueue
      .then(() => this.translateAndSpeak(turn, sourceChunk))
      .catch((error: unknown) => {
        const publicError = toPublicError(error);
        this.options.sendJson({
          type: "error",
          code: publicError.code,
          message: publicError.message,
          retryable: publicError.retryable,
        });
      });
  }

  private async translateAndSpeak(turn: TurnState, sourceChunk: string): Promise<void> {
    if (this.closed) return;
    const translationStartedAt = this.now();
    let firstTranslationDelta = true;

    const result = await this.options.translation.translateStream(
      sourceChunk,
      this.options.pair,
      (delta) => {
        if (this.closed) return;
        turn.target += delta;
        this.options.sendJson({ type: "target_delta", delta, turnId: turn.id });
        if (firstTranslationDelta) {
          firstTranslationDelta = false;
          this.emitLatency(
            turn,
            "translation",
            this.now() - translationStartedAt,
            "translation request → first text",
          );
        }
      },
    );

    turn.inputTokens += result.inputTokens;
    turn.outputTokens += result.outputTokens;
    await this.speak(turn, result.text);
  }

  private async speak(turn: TurnState, text: string): Promise<void> {
    if (this.closed) return;
    const segmentId = ++this.audioSequence;
    const speechStartedAt = this.now();
    let firstAudioChunk = true;

    this.options.sendJson({ type: "audio_start", segmentId, turnId: turn.id, sampleRate: 24000 });
    await this.options.speech.synthesizeStream(text, (chunk) => {
      if (this.closed) return;
      if (firstAudioChunk) {
        firstAudioChunk = false;
        const firstAudioAt = this.now();
        this.emitLatency(turn, "tts", firstAudioAt - speechStartedAt, "speech request → first audio");
        if (!turn.firstAudioAt) {
          turn.firstAudioAt = firstAudioAt;
          const totalOrigin = turn.speechStoppedAt ?? turn.speechStartedAt;
          const basis = turn.speechStoppedAt
            ? "speech-end → first audio"
            : "speech-start → first audio (streaming overlap)";
          this.emitLatency(turn, "total", Math.max(0, firstAudioAt - totalOrigin), basis);
        }
      }
      this.options.sendAudio(chunk);
    });
    this.options.sendJson({ type: "audio_end", segmentId, turnId: turn.id });
  }

  private emitLatency(
    turn: TurnState,
    stage: "stt" | "translation" | "tts" | "total",
    milliseconds: number,
    basis: string,
  ): void {
    this.options.sendJson({
      type: "latency",
      stage,
      milliseconds: Math.round(milliseconds),
      turnId: turn.id,
      basis,
    });
  }
}
