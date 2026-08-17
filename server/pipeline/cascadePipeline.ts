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
  providerId?: string;
  source: string;
  target: string;
  sourceChunker: StableTextChunker;
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
  private readonly now: () => number;
  private workQueue: Promise<void> = Promise.resolve();
  private turnSequence = 0;
  private audioSequence = 0;
  private currentTurn?: TurnState;
  private readonly turnsByProviderId = new Map<string, TurnState>();
  private closed = false;

  constructor(private readonly options: CascadePipelineOptions) {
    this.now = options.now ?? Date.now;
  }

  markSpeechStarted(providerTurnId?: string): void {
    if (this.closed) return;
    const existingTurn = providerTurnId
      ? this.turnsByProviderId.get(providerTurnId)
      : undefined;
    this.currentTurn = existingTurn ?? this.createTurn(providerTurnId);
    this.options.sendJson({ type: "status", status: "listening", message: "Speech detected" });
  }

  markSpeechStopped(providerTurnId?: string): void {
    if (this.closed) return;
    const turn = this.resolveTurn(providerTurnId);
    if (!turn) return;
    turn.speechStoppedAt = this.now();
    this.options.sendJson({ type: "status", status: "speaking", message: "Finishing this turn" });
  }

  addSourceDelta(delta: string, providerTurnId?: string): void {
    if (this.closed || !delta) return;
    const turn = this.ensureTurn(providerTurnId);
    turn.source += delta;

    if (!turn.firstSourceAt) {
      turn.firstSourceAt = this.now();
      this.emitLatency(turn, "stt", turn.firstSourceAt - turn.speechStartedAt, "speech-start → first transcript");
    }

    this.options.sendJson({ type: "source_delta", delta, turnId: turn.id });
    for (const chunk of turn.sourceChunker.push(delta)) {
      this.enqueueTranslation(turn, chunk);
    }
  }

  completeSource(transcript: string, providerTurnId?: string): void {
    if (this.closed) return;
    const turn = this.ensureTurn(providerTurnId);
    const finalTranscript = transcript.trim();

    if (!turn.source && finalTranscript) {
      turn.source = finalTranscript;
      this.options.sendJson({ type: "source_delta", delta: finalTranscript, turnId: turn.id });
    }

    const pending = turn.sourceChunker.flush();
    if (!turn.source.trim() && !finalTranscript && !pending) {
      this.releaseTurn(turn);
      if (!this.currentTurn) {
        this.options.sendJson({ type: "status", status: "listening", message: "Ready for the next turn" });
      }
      return;
    }

    if (pending) this.enqueueTranslation(turn, pending);

    this.options.sendJson({
      type: "source_done",
      transcript: finalTranscript || turn.source,
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
      this.releaseTurn(turn);
      if (!this.currentTurn) {
        this.options.sendJson({ type: "status", status: "listening", message: "Ready for the next turn" });
      }
    });
  }

  async drain(): Promise<void> {
    const unfinishedTurns = new Set(this.turnsByProviderId.values());
    if (this.currentTurn) unfinishedTurns.add(this.currentTurn);
    for (const turn of unfinishedTurns) {
      const pending = turn.sourceChunker.flush();
      if (pending) this.enqueueTranslation(turn, pending);
    }
    await this.workQueue;
  }

  close(): void {
    this.closed = true;
    this.turnsByProviderId.clear();
    this.currentTurn = undefined;
  }

  private createTurn(providerId?: string): TurnState {
    const japaneseSource = this.options.pair.source === "ja";
    const turn: TurnState = {
      id: ++this.turnSequence,
      providerId,
      source: "",
      target: "",
      sourceChunker: new StableTextChunker({
        softLimit: japaneseSource ? 10 : 22,
        hardLimit: japaneseSource ? 22 : 52,
      }),
      speechStartedAt: this.now(),
      inputTokens: 0,
      outputTokens: 0,
    };
    if (providerId) this.turnsByProviderId.set(providerId, turn);
    return turn;
  }

  private resolveTurn(providerId?: string): TurnState | undefined {
    if (!providerId) return this.currentTurn;
    const mappedTurn = this.turnsByProviderId.get(providerId);
    if (mappedTurn) return mappedTurn;
    if (this.currentTurn && !this.currentTurn.providerId) {
      this.currentTurn.providerId = providerId;
      this.turnsByProviderId.set(providerId, this.currentTurn);
      return this.currentTurn;
    }
    return undefined;
  }

  private ensureTurn(providerId?: string): TurnState {
    const existingTurn = this.resolveTurn(providerId);
    if (existingTurn) return existingTurn;
    const turn = this.createTurn(providerId);
    this.currentTurn = turn;
    return turn;
  }

  private releaseTurn(turn: TurnState): void {
    if (turn.providerId) this.turnsByProviderId.delete(turn.providerId);
    if (this.currentTurn === turn) this.currentTurn = undefined;
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
