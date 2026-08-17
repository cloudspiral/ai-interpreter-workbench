# Kiku — AI Interpreter Workbench

Kiku is a browser-based speech interpreter that compares two OpenAI-backed architectures under one interface:

- **Realtime:** microphone → `gpt-realtime` → interpreted audio
- **Cascade:** microphone → `gpt-4o-mini-transcribe` → `gpt-5.4-mini` → `tts-1` → interpreted audio

English → Japanese is the default product experience. Japanese → English and the assignment-required English ↔ Spanish directions are also available.

## What it demonstrates

- Browser microphone capture and immediate audio playback
- A mode switch that works before a session or reconnects during one
- Live source and target transcripts
- Real latency telemetry for recognition, translation, speech synthesis, and speech-end-to-first-audio
- Streaming at every cascade boundary: 24 kHz PCM input, partial transcripts, stable text fragments, token deltas, and PCM output chunks
- Provider boundaries for translation and speech synthesis, with the transcription transport isolated in the cascade socket adapter
- Safe handling for microphone denial, timeouts, rate limits, missing models, empty responses, and provider disconnects

The verified requirements companion is [`gauntlet-w6-boostlingo-project_reqs.md`](./gauntlet-w6-boostlingo-project_reqs.md). The architecture tradeoff write-up is [`docs/COMPARISON.md`](./docs/COMPARISON.md).

## Stack choice

The project uses TypeScript end to end: React/Vite in the browser and Express/WebSocket on Node.js. One language keeps the streaming event contract shared and statically checked across microphone capture, server orchestration, transcript rendering, and telemetry. The intentionally thin Node backend protects the API key and handles OpenAI server-to-server calls; WebRTC carries the latency-sensitive Realtime media path directly between the browser and OpenAI.

## Run locally

Requirements: Node.js 20+ and pnpm 11.

```bash
corepack enable
pnpm install
cp .env.example .env
# Add OPENAI_API_KEY to .env
pnpm dev
```

Open `http://localhost:5173`. The Vite development server proxies HTTP and WebSocket API traffic to the Node server on port 3001.

For the production-shaped local build:

```bash
pnpm check
pnpm start
```

Open `http://localhost:3001` after `pnpm check` builds both server and browser assets.

## Configuration

| Variable | Default | Purpose |
|---|---|---|
| `OPENAI_API_KEY` | required | Server-only OpenAI credential |
| `OPENAI_REALTIME_MODEL` | `gpt-realtime` | Exact model required by the brief |
| `OPENAI_TRANSCRIPTION_MODEL` | `gpt-4o-mini-transcribe` | Streaming STT with server-side voice activity detection |
| `OPENAI_TRANSLATION_MODEL` | `gpt-5.4-mini` | Incremental text translation |
| `OPENAI_TTS_MODEL` | `tts-1` | Low-latency PCM speech synthesis |
| `OPENAI_REALTIME_VOICE` | `marin` | Realtime output voice |
| `OPENAI_TTS_VOICE` | `coral` | Cascade output voice |
| `PORT` | `3001` | HTTP/WebSocket server port |

The API key never enters the browser bundle. Realtime session creation is brokered by `POST /api/realtime/session`; cascade provider calls stay entirely on the Node server.

To verify that the configured key can see every selected model without sending speech:

```bash
pnpm preflight
```

## Architecture

### Realtime mode

The browser captures the microphone through `getUserMedia`, creates a WebRTC peer connection, and sends its SDP offer to the backend. The backend adds directional interpreter instructions and creates an OpenAI Realtime call through the unified `/v1/realtime/calls` interface. Audio flows over WebRTC; the data channel supplies partial input and output transcripts plus response usage.

This path is deliberately integrated. Translation and synthesis timings are shown as **integrated**, while STT and end-to-end timing use provider events observed in the browser.

### Cascade mode

An AudioWorklet resamples microphone audio to mono 24 kHz PCM and streams it over `/api/cascade`. The server forwards frames to an OpenAI transcription WebSocket. Stable partial-text chunks are dispatched at sentence or safe length boundaries—before the utterance completes—to the translation provider. Translation deltas appear immediately in the UI; each completed fragment is sent to TTS, whose PCM chunks are forwarded and scheduled by the browser audio player.

The cascade queue preserves segment order. Interfaces in `server/providers/interfaces.ts` keep translation and speech implementations replaceable. `CascadePipeline` contains no OpenAI SDK calls and is tested with fake providers.

## Latency semantics

| Metric | Measurement |
|---|---|
| STT | speech start → first source transcript delta |
| Translation | translation request → first translated text delta |
| TTS | speech request → first PCM audio chunk |
| Total | speech end → first audio chunk; speech start is used and labeled when streaming audio begins before speech ends |

Values are captured from monotonic browser time in Realtime mode and server time in cascade mode. They are per-turn observations, not benchmark claims. Run representative speech, network, and five-minute stability trials before making production SLO claims.

## Quality gates

```bash
pnpm typecheck  # browser and server TypeScript
pnpm test       # component, pipeline, chunking, and safe-failure tests
pnpm build      # production server and Vite bundle
pnpm check      # all three in sequence
```

## Deploy to Railway

The repository includes a multi-stage `Dockerfile` and `railway.json`. Create a Railway service, set `OPENAI_API_KEY`, and deploy the repository. Railway supplies `PORT`; the server binds to `0.0.0.0` and exposes `/api/health` for health checks.

Never commit `.env`. It is excluded by Git and Docker.

## Known constraints

- Browser autoplay and microphone rules require a user gesture and HTTPS outside localhost.
- Realtime model availability is account-dependent. The default remains the exact model named by the brief; override it only when intentionally testing another model.
- The app stores transcripts only in React memory and does not persist audio or text.
- The five-minute stability and latency thresholds require live spoken trials in the target deployment environment; unit tests cannot prove them.
