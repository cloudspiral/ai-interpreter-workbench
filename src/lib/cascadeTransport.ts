import type { CascadeServerEvent, LanguagePair } from "../../shared/protocol";
import type { EventHandler, InterpreterTransport } from "./interpreter";
import { microphoneError } from "./interpreter";
import { PcmPlayer } from "./pcmPlayer";

export class CascadeTransport implements InterpreterTransport {
  private socket?: WebSocket;
  private stream?: MediaStream;
  private context?: AudioContext;
  private source?: MediaStreamAudioSourceNode;
  private capture?: AudioWorkletNode;
  private silentGain?: GainNode;
  private player?: PcmPlayer;
  private onEvent?: EventHandler;
  private closed = false;
  private startedCapture = false;

  async connect(pair: LanguagePair, onEvent: EventHandler): Promise<void> {
    this.onEvent = onEvent;
    this.closed = false;
    onEvent({ type: "status", status: "connecting", message: "Connecting cascade stages" });

    const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
    const url = `${protocol}//${window.location.host}/api/cascade?source=${pair.source}&target=${pair.target}`;
    const socket = new WebSocket(url);
    socket.binaryType = "arraybuffer";
    this.socket = socket;

    await new Promise<void>((resolve, reject) => {
      const timeout = window.setTimeout(() => {
        reject(new Error("The cascade connection timed out while contacting OpenAI."));
      }, 20_000);

      socket.addEventListener("error", () => {
        window.clearTimeout(timeout);
        reject(new Error("The browser could not connect to the cascade pipeline."));
      }, { once: true });

      socket.addEventListener("message", (message) => {
        if (message.data instanceof ArrayBuffer) {
          this.player?.enqueue(message.data);
          return;
        }

        const event = this.parseEvent(message.data);
        if (!event) return;
        onEvent(event);

        if (event.type === "ready" && !this.startedCapture) {
          window.clearTimeout(timeout);
          void this.startCapture()
            .then(resolve)
            .catch(reject);
        }
      });

      socket.addEventListener("close", (event) => {
        if (!this.closed && event.code !== 1000) {
          onEvent({
            type: "error",
            code: "cascade_disconnected",
            message: "The cascade connection closed unexpectedly.",
            retryable: true,
          });
        }
      });
    }).catch(async (error) => {
      await this.disconnect();
      throw error;
    });
  }

  async disconnect(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    this.stopCapture();

    if (this.socket?.readyState === WebSocket.OPEN) {
      this.socket.send(JSON.stringify({ type: "stop" }));
      await new Promise((resolve) => window.setTimeout(resolve, 900));
      await this.player?.drain(3_000);
      this.socket.close(1000, "Session stopped");
    }

    await this.context?.close().catch(() => undefined);
    this.socket = undefined;
    this.context = undefined;
    this.player = undefined;
    this.onEvent = undefined;
  }

  private async startCapture(): Promise<void> {
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

    const context = new AudioContext({ latencyHint: "interactive" });
    this.context = context;
    this.player = new PcmPlayer(context);
    await context.audioWorklet.addModule("/pcm-worklet.js");
    await context.resume();

    const source = context.createMediaStreamSource(this.stream);
    const capture = new AudioWorkletNode(context, "pcm-capture");
    const silentGain = context.createGain();
    silentGain.gain.value = 0;

    capture.port.onmessage = (event: MessageEvent<ArrayBuffer>) => {
      if (this.socket?.readyState === WebSocket.OPEN && !this.closed) {
        this.socket.send(event.data);
      }
    };

    source.connect(capture);
    capture.connect(silentGain);
    silentGain.connect(context.destination);
    this.source = source;
    this.capture = capture;
    this.silentGain = silentGain;
    this.startedCapture = true;
  }

  private stopCapture(): void {
    for (const track of this.stream?.getTracks() ?? []) track.stop();
    this.source?.disconnect();
    this.capture?.disconnect();
    this.silentGain?.disconnect();
    this.capture?.port.close();
    this.stream = undefined;
    this.source = undefined;
    this.capture = undefined;
    this.silentGain = undefined;
    this.startedCapture = false;
  }

  private parseEvent(raw: unknown): CascadeServerEvent | null {
    if (typeof raw !== "string") return null;
    try {
      return JSON.parse(raw) as CascadeServerEvent;
    } catch {
      this.onEvent?.({
        type: "error",
        code: "invalid_server_event",
        message: "The cascade server returned an unreadable event.",
        retryable: true,
      });
      return null;
    }
  }
}

