import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  LANGUAGE_PAIRS,
  type CascadeServerEvent,
  type ConnectionStatus,
  type InterpreterMode,
  type LanguagePair,
  type LatencyStage,
  type RuntimeConfig,
} from "../shared/protocol";
import { CascadeTransport } from "./lib/cascadeTransport";
import type { InterpreterTransport } from "./lib/interpreter";
import { RealtimeTransport } from "./lib/realtimeTransport";

interface Turn {
  id: number;
  source: string;
  target: string;
  sourceDone: boolean;
  targetDone: boolean;
}

interface LatencyReading {
  stage: LatencyStage;
  milliseconds: number;
  turnId: number;
  basis?: string;
}

interface Usage {
  inputTokens: number;
  outputTokens: number;
}

export type TransportFactory = (mode: InterpreterMode) => InterpreterTransport;

const MODE_COPY: Record<InterpreterMode, { label: string; detail: string; badge: string }> = {
  realtime: { label: "Realtime", detail: "One model · speech to speech", badge: "Lowest latency" },
  cascade: { label: "Cascade", detail: "STT → translation → TTS", badge: "Most control" },
};

const STATUS_COPY: Record<ConnectionStatus, string> = {
  idle: "Ready to begin",
  connecting: "Connecting",
  listening: "Listening",
  speaking: "Interpreting",
  error: "Needs attention",
};

const LATENCY_COPY: Array<{ stage: LatencyStage; label: string; short: string }> = [
  { stage: "stt", label: "Speech recognition", short: "STT" },
  { stage: "translation", label: "Translation", short: "Translate" },
  { stage: "tts", label: "Speech synthesis", short: "TTS" },
  { stage: "total", label: "Speech end to audio", short: "Total" },
];

const defaultTransportFactory: TransportFactory = (mode) =>
  mode === "realtime" ? new RealtimeTransport() : new CascadeTransport();

function upsertTurn(turns: Turn[], turnId: number, update: (turn: Turn) => Turn): Turn[] {
  const index = turns.findIndex((turn) => turn.id === turnId);
  if (index === -1) {
    return [...turns, update({ id: turnId, source: "", target: "", sourceDone: false, targetDone: false })];
  }
  return turns.map((turn, turnIndex) => (turnIndex === index ? update(turn) : turn));
}

function formatLatency(milliseconds: number): string {
  if (milliseconds === 0) return "integrated";
  if (milliseconds < 1_000) return `${milliseconds} ms`;
  return `${(milliseconds / 1_000).toFixed(2)} s`;
}

function languageLabel(pair: LanguagePair): string {
  return `${pair.sourceName} → ${pair.targetName}`;
}

export function App({ transportFactory = defaultTransportFactory }: { transportFactory?: TransportFactory }) {
  const [mode, setMode] = useState<InterpreterMode>("realtime");
  const [pairId, setPairId] = useState<LanguagePair["id"]>("en-ja");
  const [status, setStatus] = useState<ConnectionStatus>("idle");
  const [statusMessage, setStatusMessage] = useState("Choose a mode, then start speaking.");
  const [turns, setTurns] = useState<Turn[]>([]);
  const [latencies, setLatencies] = useState<LatencyReading[]>([]);
  const [usage, setUsage] = useState<Usage>({ inputTokens: 0, outputTokens: 0 });
  const [models, setModels] = useState<RuntimeConfig | null>(null);
  const [error, setError] = useState<string | null>(null);
  const transportRef = useRef<InterpreterTransport | null>(null);
  const generationRef = useRef(0);

  const pair = useMemo(
    () => LANGUAGE_PAIRS.find((candidate) => candidate.id === pairId) ?? LANGUAGE_PAIRS[0],
    [pairId],
  );
  const active = status === "connecting" || status === "listening" || status === "speaking";
  const latestLatency = useMemo(() => {
    const readings = new Map<LatencyStage, LatencyReading>();
    for (const reading of latencies) readings.set(reading.stage, reading);
    return readings;
  }, [latencies]);

  const applyEvent = useCallback((event: CascadeServerEvent) => {
    switch (event.type) {
      case "ready":
        setModels(event.models);
        break;
      case "status":
        setStatus(event.status);
        setStatusMessage(event.message);
        if (event.status !== "error") setError(null);
        break;
      case "source_delta":
        setTurns((current) => upsertTurn(current, event.turnId, (turn) => ({ ...turn, source: turn.source + event.delta })));
        break;
      case "source_done":
        setTurns((current) => upsertTurn(current, event.turnId, (turn) => ({ ...turn, source: event.transcript || turn.source, sourceDone: true })));
        break;
      case "target_delta":
        setTurns((current) => upsertTurn(current, event.turnId, (turn) => ({ ...turn, target: turn.target + event.delta })));
        break;
      case "target_done":
        setTurns((current) => upsertTurn(current, event.turnId, (turn) => ({ ...turn, target: event.translation || turn.target, targetDone: true })));
        break;
      case "audio_start":
        setStatus("speaking");
        setStatusMessage("Playing interpreted audio");
        break;
      case "latency":
        setLatencies((current) => [
          ...current.filter((reading) => !(reading.turnId === event.turnId && reading.stage === event.stage)),
          event,
        ]);
        break;
      case "usage":
        setUsage((current) => ({
          inputTokens: current.inputTokens + event.inputTokens,
          outputTokens: current.outputTokens + event.outputTokens,
        }));
        break;
      case "error":
        setError(event.message);
        setStatus("error");
        setStatusMessage(event.retryable ? "You can retry this session." : "Check the server configuration.");
        break;
      case "audio_end":
        break;
    }
  }, []);

  const stopSession = useCallback(async (nextStatus: ConnectionStatus = "idle") => {
    generationRef.current += 1;
    const transport = transportRef.current;
    transportRef.current = null;
    if (transport) await transport.disconnect();
    setStatus(nextStatus);
    if (nextStatus === "idle") setStatusMessage("Session stopped. Your transcript is preserved.");
  }, []);

  const startSession = useCallback(async (selectedMode: InterpreterMode, selectedPair: LanguagePair) => {
    const generation = generationRef.current + 1;
    generationRef.current = generation;
    const transport = transportFactory(selectedMode);
    transportRef.current = transport;
    setError(null);
    setStatus("connecting");
    setStatusMessage(`Starting ${MODE_COPY[selectedMode].label.toLowerCase()} interpretation…`);

    try {
      await transport.connect(selectedPair, (event) => {
        if (generationRef.current === generation) applyEvent(event);
      });
    } catch (caught) {
      if (generationRef.current !== generation) return;
      const message = caught instanceof Error ? caught.message : "The interpreter could not start.";
      setError(message);
      setStatus("error");
      setStatusMessage("The session did not connect.");
      transportRef.current = null;
    }
  }, [applyEvent, transportFactory]);

  const switchConfiguration = useCallback(async (nextMode: InterpreterMode, nextPair: LanguagePair) => {
    const shouldRestart = active;
    if (transportRef.current) await stopSession();
    if (shouldRestart) await startSession(nextMode, nextPair);
  }, [active, startSession, stopSession]);

  useEffect(() => () => {
    generationRef.current += 1;
    void transportRef.current?.disconnect();
  }, []);

  const chooseMode = (nextMode: InterpreterMode) => {
    if (nextMode === mode) return;
    setMode(nextMode);
    void switchConfiguration(nextMode, pair);
  };

  const choosePair = (nextPairId: LanguagePair["id"]) => {
    const nextPair = LANGUAGE_PAIRS.find((candidate) => candidate.id === nextPairId);
    if (!nextPair) return;
    setPairId(nextPairId);
    void switchConfiguration(mode, nextPair);
  };

  const toggleSession = () => {
    if (active) void stopSession();
    else void startSession(mode, pair);
  };

  const clearTranscript = () => {
    setTurns([]);
    setLatencies([]);
    setUsage({ inputTokens: 0, outputTokens: 0 });
  };

  const currentModel = models
    ? mode === "realtime"
      ? models.realtimeModel
      : `${models.transcriptionModel} + ${models.translationModel} + ${models.ttsModel}`
    : mode === "realtime" ? "gpt-realtime" : "OpenAI cascade";

  return (
    <main className="app-shell">
      <header className="masthead">
        <a className="brand" href="#top" aria-label="Kiku home">
          <span className="brand-mark" aria-hidden="true">聞</span>
          <span><strong>Kiku</strong><small>AI interpreter workbench</small></span>
        </a>
        <div className={`connection-pill status-${status}`} role="status" aria-live="polite">
          <span className="status-dot" />{STATUS_COPY[status]}
        </div>
      </header>

      <section className="hero" id="top">
        <div>
          <p className="eyebrow">聞く · listen deeply</p>
          <h1>Interpretation,<br /><em>in the moment.</em></h1>
        </div>
        <p className="hero-copy">
          Compare OpenAI’s direct voice-to-voice model with a composable streaming cascade—using
          the same microphone, conversation, and honest latency measurements.
        </p>
      </section>

      <section className="mode-panel" aria-labelledby="mode-heading">
        <div className="section-heading">
          <div><p className="section-index">01</p><h2 id="mode-heading">Choose a pipeline</h2></div>
          <p>Switch at any time. An active session reconnects automatically.</p>
        </div>
        <div className="mode-grid" role="radiogroup" aria-label="Interpretation pipeline">
          {(["realtime", "cascade"] as const).map((candidate) => (
            <button
              className={`mode-card ${mode === candidate ? "selected" : ""}`}
              type="button" role="radio" aria-checked={mode === candidate}
              onClick={() => chooseMode(candidate)} key={candidate}
            >
              <span className="mode-radio" aria-hidden="true" />
              <span className="mode-number">{candidate === "realtime" ? "A" : "B"}</span>
              <strong>{MODE_COPY[candidate].label}</strong>
              <span>{MODE_COPY[candidate].detail}</span>
              <small>{MODE_COPY[candidate].badge}</small>
            </button>
          ))}
        </div>
      </section>

      <section className="session-panel" aria-labelledby="session-heading">
        <div className="section-heading compact">
          <div><p className="section-index">02</p><h2 id="session-heading">Live session</h2></div>
          <label className="language-select">
            <span>Language direction</span>
            <select value={pairId} onChange={(event) => choosePair(event.target.value as LanguagePair["id"])} aria-label="Language direction">
              {LANGUAGE_PAIRS.map((candidate) => <option value={candidate.id} key={candidate.id}>{languageLabel(candidate)}</option>)}
            </select>
          </label>
        </div>

        <div className="session-stage">
          <div className="session-toolbar">
            <div>
              <span className={`live-orb status-${status}`} aria-hidden="true" />
              <strong>{statusMessage}</strong>
              <small>{MODE_COPY[mode].label} · {languageLabel(pair)}</small>
            </div>
            <button className="clear-button" type="button" onClick={clearTranscript} disabled={turns.length === 0}>Clear transcript</button>
          </div>

          <div className="transcript" aria-live="polite" aria-label="Live transcript">
            {turns.length === 0 ? (
              <div className="empty-transcript"><span aria-hidden="true">あ</span><p>Your source and interpreted speech will appear here, live.</p></div>
            ) : turns.map((turn) => (
              <article className="turn" key={turn.id}>
                <div>
                  <p className="turn-label">{pair.sourceName} <span>Original</span></p>
                  <p className={!turn.sourceDone ? "streaming-text" : ""}>{turn.source || (turn.sourceDone ? "No speech detected." : "Listening…")}</p>
                </div>
                <div className="turn-arrow" aria-hidden="true">→</div>
                <div className="target-turn">
                  <p className="turn-label">{pair.targetName} <span>Interpretation</span></p>
                  <p className={!turn.targetDone ? "streaming-text" : ""}>{turn.target || (turn.targetDone ? "No interpreted speech." : "Interpreting…")}</p>
                </div>
              </article>
            ))}
          </div>

          {error && <div className="error-banner" role="alert"><strong>Session error</strong><span>{error}</span></div>}

          <div className="session-controls">
            <button className={`session-button ${active ? "active" : ""}`} type="button" onClick={toggleSession} disabled={status === "connecting"}>
              <span className="mic-icon" aria-hidden="true">{active ? "■" : "●"}</span>
              {status === "connecting" ? "Connecting…" : active ? "End session" : "Start interpreting"}
            </button>
            <p>Microphone audio is streamed to OpenAI only while the session is active.</p>
          </div>
        </div>
      </section>

      <section className="metrics-panel" aria-labelledby="metrics-heading">
        <div className="section-heading">
          <div><p className="section-index">03</p><h2 id="metrics-heading">Latency, exposed</h2></div>
          <p>Latest measured turn · no simulated values</p>
        </div>
        <div className="metric-grid">
          {LATENCY_COPY.map(({ stage, label, short }) => {
            const reading = latestLatency.get(stage);
            return (
              <div className={`metric ${stage === "total" ? "total" : ""}`} key={stage} title={reading?.basis}>
                <span>{short}</span><strong>{reading ? formatLatency(reading.milliseconds) : "—"}</strong><small>{label}</small>
              </div>
            );
          })}
        </div>
        <div className="runtime-line">
          <span><strong>Pipeline</strong> {currentModel}</span>
          <span><strong>Tokens</strong> {usage.inputTokens.toLocaleString()} in · {usage.outputTokens.toLocaleString()} out</span>
        </div>
      </section>

      <section className="architecture" aria-label="Pipeline architecture">
        <div><p className="section-index">How it flows</p><h2>{MODE_COPY[mode].label}</h2></div>
        {mode === "realtime" ? (
          <div className="flow" aria-label="Microphone to GPT Realtime to speaker"><span>Microphone</span><i>→</i><strong>GPT Realtime</strong><i>→</i><span>Speaker</span></div>
        ) : (
          <div className="flow" aria-label="Microphone to transcription to translation to speech to speaker"><span>Microphone</span><i>→</i><strong>STT</strong><i>→</i><strong>Translate</strong><i>→</i><strong>TTS</strong><i>→</i><span>Speaker</span></div>
        )}
      </section>

      <footer><span>Kiku / 聞く</span><span>Built for transparent AI interpretation</span></footer>
    </main>
  );
}
