import type { RuntimeConfig } from "../../shared/protocol";
import type { EventHandler, InterpreterTransport } from "./interpreter";
import { microphoneError, parseServerError } from "./interpreter";
import type { LanguagePair } from "../../shared/protocol";

interface RealtimeProviderEvent {
  type: string;
  delta?: string;
  transcript?: string;
  response?: {
    usage?: {
      input_tokens?: number;
      output_tokens?: number;
    };
  };
  error?: { message?: string; code?: string };
}

export function hasAudibleSignal(samples: Float32Array, threshold = 0.012): boolean {
  if (samples.length === 0) return false;
  let squaredAmplitude = 0;
  for (const sample of samples) squaredAmplitude += sample * sample;
  return Math.sqrt(squaredAmplitude / samples.length) >= threshold;
}

export class RealtimeTransport implements InterpreterTransport {
  private peer?: RTCPeerConnection;
  private stream?: MediaStream;
  private channel?: RTCDataChannel;
  private audio?: HTMLAudioElement;
  private outputContext?: AudioContext;
  private outputSource?: MediaStreamAudioSourceNode;
  private outputAnalyser?: AnalyserNode;
  private outputSilentGain?: GainNode;
  private outputFrame?: number;
  private onEvent?: EventHandler;
  private turnId = 0;
  private speechStartedAt?: number;
  private speechStoppedAt?: number;
  private firstSourceSeen = false;
  private firstAudioSeen = false;
  private closed = false;

  async connect(pair: LanguagePair, onEvent: EventHandler): Promise<void> {
    this.onEvent = onEvent;
    this.closed = false;
    onEvent({ type: "status", status: "connecting", message: "Creating Realtime session" });

    try {
      const healthResponse = await fetch("/api/health");
      const models = (await healthResponse.json()) as RuntimeConfig;
      if (!models.apiKeyConfigured) {
        throw new Error("The server does not have an OpenAI API key configured.");
      }

      const peer = new RTCPeerConnection();
      this.peer = peer;
      const audio = document.createElement("audio");
      audio.autoplay = true;
      audio.setAttribute("aria-hidden", "true");
      document.body.append(audio);
      this.audio = audio;

      peer.ontrack = (event) => {
        audio.srcObject = event.streams[0];
        void audio.play().catch(() => undefined);
        this.monitorOutputAudio(event.streams[0]);
      };

      peer.onconnectionstatechange = () => {
        if (peer.connectionState === "failed" || peer.connectionState === "disconnected") {
          this.emitError("realtime_disconnected", "The Realtime audio connection was interrupted.", true);
        }
      };

      const channel = peer.createDataChannel("oai-events");
      this.channel = channel;
      channel.addEventListener("message", (event) => this.handleProviderEvent(event.data));
      channel.addEventListener("open", () => {
        onEvent({ type: "ready", models });
        onEvent({ type: "status", status: "listening", message: "Realtime interpreter ready" });
      });

      try {
        this.stream = await navigator.mediaDevices.getUserMedia({
          audio: {
            channelCount: 1,
            echoCancellation: true,
            noiseSuppression: true,
            autoGainControl: true,
          },
        });
      } catch (error) {
        throw microphoneError(error);
      }

      for (const track of this.stream.getTracks()) peer.addTrack(track, this.stream);
      const offer = await peer.createOffer();
      await peer.setLocalDescription(offer);

      const sessionResponse = await fetch(
        `/api/realtime/session?source=${pair.source}&target=${pair.target}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/sdp" },
          body: offer.sdp,
        },
      );

      if (!sessionResponse.ok) {
        const payload = await sessionResponse.json().catch(() => null);
        throw parseServerError(payload, "OpenAI could not create the Realtime session.");
      }

      await peer.setRemoteDescription({
        type: "answer",
        sdp: await sessionResponse.text(),
      });
    } catch (error) {
      await this.disconnect();
      throw error instanceof Error ? error : new Error("The Realtime session could not start.");
    }
  }

  async disconnect(): Promise<void> {
    this.closed = true;
    this.channel?.close();
    this.peer?.close();
    for (const track of this.stream?.getTracks() ?? []) track.stop();
    this.audio?.pause();
    this.audio?.remove();
    if (this.outputFrame !== undefined) cancelAnimationFrame(this.outputFrame);
    this.outputSource?.disconnect();
    this.outputSilentGain?.disconnect();
    await this.outputContext?.close().catch(() => undefined);
    this.audio = undefined;
    this.outputFrame = undefined;
    this.outputAnalyser = undefined;
    this.outputSource = undefined;
    this.outputSilentGain = undefined;
    this.outputContext = undefined;
    this.channel = undefined;
    this.peer = undefined;
    this.stream = undefined;
  }

  private handleProviderEvent(raw: string): void {
    if (this.closed || !this.onEvent) return;

    let event: RealtimeProviderEvent;
    try {
      event = JSON.parse(raw) as RealtimeProviderEvent;
    } catch {
      this.emitError("invalid_realtime_event", "OpenAI returned an unreadable Realtime event.", true);
      return;
    }

    switch (event.type) {
      case "input_audio_buffer.speech_started":
        this.turnId += 1;
        this.speechStartedAt = performance.now();
        this.speechStoppedAt = undefined;
        this.firstSourceSeen = false;
        this.firstAudioSeen = false;
        this.onEvent({ type: "status", status: "listening", message: "Speech detected" });
        break;
      case "input_audio_buffer.speech_stopped":
        this.speechStoppedAt = performance.now();
        this.onEvent({ type: "status", status: "speaking", message: "Interpreting" });
        break;
      case "conversation.item.input_audio_transcription.delta":
        this.ensureTurn();
        if (!this.firstSourceSeen && this.speechStartedAt) {
          this.firstSourceSeen = true;
          this.onEvent({
            type: "latency",
            stage: "stt",
            milliseconds: Math.round(performance.now() - this.speechStartedAt),
            turnId: this.turnId,
            basis: "speech-start → first transcript",
          });
        }
        this.onEvent({ type: "source_delta", delta: event.delta ?? "", turnId: this.turnId });
        break;
      case "conversation.item.input_audio_transcription.completed":
        this.ensureTurn();
        this.onEvent({
          type: "source_done",
          transcript: event.transcript ?? "",
          turnId: this.turnId,
        });
        break;
      case "response.output_audio_transcript.delta":
      case "response.audio_transcript.delta":
        this.ensureTurn();
        this.onEvent({ type: "target_delta", delta: event.delta ?? "", turnId: this.turnId });
        break;
      case "response.output_audio_transcript.done":
      case "response.audio_transcript.done":
        this.ensureTurn();
        this.onEvent({
          type: "target_done",
          translation: event.transcript ?? "",
          turnId: this.turnId,
        });
        break;
      case "response.output_audio.delta":
      case "response.audio.delta":
        this.markFirstAudio();
        break;
      case "response.done":
        this.ensureTurn();
        this.onEvent({
          type: "usage",
          inputTokens: event.response?.usage?.input_tokens ?? 0,
          outputTokens: event.response?.usage?.output_tokens ?? 0,
          turnId: this.turnId,
        });
        this.onEvent({ type: "status", status: "listening", message: "Ready for the next turn" });
        break;
      case "error":
        this.emitError(
          event.error?.code ?? "realtime_provider_error",
          event.error?.message ?? "OpenAI reported a Realtime session error.",
          true,
        );
        break;
      default:
        break;
    }
  }

  private markFirstAudio(): void {
    if (this.firstAudioSeen || !this.onEvent) return;
    this.ensureTurn();
    this.firstAudioSeen = true;
    const now = performance.now();
    const origin = this.speechStoppedAt ?? this.speechStartedAt ?? now;
    this.onEvent({
      type: "latency",
      stage: "total",
      milliseconds: Math.max(0, Math.round(now - origin)),
      turnId: this.turnId,
      basis: this.speechStoppedAt
        ? "speech-end → first audio"
        : "speech-start → first audio (streaming overlap)",
    });
    this.onEvent({
      type: "latency",
      stage: "translation",
      milliseconds: 0,
      turnId: this.turnId,
      basis: "integrated voice-to-voice model",
    });
    this.onEvent({
      type: "latency",
      stage: "tts",
      milliseconds: 0,
      turnId: this.turnId,
      basis: "integrated voice-to-voice model",
    });
  }

  private monitorOutputAudio(stream: MediaStream): void {
    if (this.outputFrame !== undefined) cancelAnimationFrame(this.outputFrame);
    this.outputSource?.disconnect();
    this.outputSilentGain?.disconnect();
    void this.outputContext?.close().catch(() => undefined);

    const context = new AudioContext({ latencyHint: "interactive" });
    const source = context.createMediaStreamSource(stream);
    const analyser = context.createAnalyser();
    const silentGain = context.createGain();
    analyser.fftSize = 512;
    analyser.smoothingTimeConstant = 0.15;
    silentGain.gain.value = 0;
    source.connect(analyser);
    analyser.connect(silentGain);
    silentGain.connect(context.destination);
    this.outputContext = context;
    this.outputSource = source;
    this.outputAnalyser = analyser;
    this.outputSilentGain = silentGain;
    void context.resume().catch(() => undefined);

    const samples = new Float32Array(analyser.fftSize);
    const inspect = () => {
      if (this.closed || this.outputAnalyser !== analyser) return;
      analyser.getFloatTimeDomainData(samples);
      if (!this.firstAudioSeen && (this.speechStoppedAt || this.speechStartedAt) && hasAudibleSignal(samples)) {
        this.markFirstAudio();
      }
      this.outputFrame = requestAnimationFrame(inspect);
    };
    inspect();
  }

  private ensureTurn(): void {
    if (this.turnId === 0) {
      this.turnId = 1;
      this.speechStartedAt = performance.now();
    }
  }

  private emitError(code: string, message: string, retryable: boolean): void {
    this.onEvent?.({ type: "error", code, message, retryable });
  }
}
