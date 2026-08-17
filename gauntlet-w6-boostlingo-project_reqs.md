> This Markdown file is an agent-friendly companion to the original PDF. The PDF remains the authoritative source. Any conflict or ambiguity must be verified against the PDF.

## Source

- **PDF:** `gauntlet-w6-boostlingo-project_reqs.pdf`
- **SHA-256:** `dfcb03bce12ba543e31d62f609f2bfb5d28bc09db5d1fd608909be1323d9f071`
- **Physical pages:** 3
- **Extraction backend:** `pypdf 6.10.0`
- **Verification status:** Verified

# AI Interpreter Workbench: Realtime API vs. Cascade Pipeline

## Problem Statement

Boostlingo connects people who need language interpretation with professional human interpreters. AI offers two distinct architectural patterns for live interpretation: direct voice-to-voice models through the OpenAI Realtime API and composable STT → Translation → TTS cascade pipelines. Their trade-offs in latency, quality, cost, and operational control are not obvious until both are built. The project calls for building and instrumenting both, then forming a defensible opinion about when each architecture fits. [PDF p. 1]

## Business Context & Impact

### Business Context

Live interpretation is Boostlingo's core product. Architectural choices will determine cost per minute, the latency floor, vendor lock-in, and the ability to offer differentiated quality on uncommon language pairs. The industry is split between vertically integrated voice-to-voice models, which offer less control and lower latency, and cascade pipelines, which offer more control but introduce more moving parts. Boostlingo wants to understand which architecture fits which use case to inform product and platform investment over the next 12–18 months. [PDF p. 1]

### Key Impact Metrics

- End-to-end latency in milliseconds.
- Cost per minute.
- Interpretation quality, measured subjectively and with word error rate (WER).
- Provider flexibility.
- Time required to onboard a new language pair. [PDF p. 1]

## Technical Requirements

### Required Programming Languages

<a id="req-001"></a>**REQ-001** - The programming languages are the candidate's choice. The preferred stack is .NET/C# for the backend and TypeScript for the frontend; Python is acceptable. [PDF p. 1]

<a id="req-002"></a>**REQ-002** - The candidate should explain the programming-language choice. [PDF p. 1]

### AI/ML Frameworks

<a id="req-003"></a>**REQ-003** - Realtime mode must use the OpenAI Realtime API with the `gpt-realtime` model and provide voice input and voice output. [PDF pp. 1-2]

<a id="req-004"></a>**REQ-004** - Cascade mode must use a composed STT → Translation → TTS pipeline. [PDF pp. 1-2]

<a id="req-005"></a>**REQ-005** - Cascade-mode providers are the candidate's choice. Examples given are OpenAI, Deepgram, AssemblyAI, or Soniox for STT; OpenAI, Anthropic Claude, or DeepL for translation; and OpenAI TTS, ElevenLabs, Azure Speech, or Polly for TTS. [PDF p. 1]

### Development Tools

<a id="req-006"></a>**REQ-006** - An agentic coding assistant such as Claude Code, Codex, Cursor agent mode, or an equivalent is required; tab completion alone is insufficient. [PDF pp. 1-2]

<a id="req-007"></a>**REQ-007** - Git is required. [PDF p. 2]

<a id="req-008"></a>**REQ-008** - The web framework, package manager, and build tooling are the candidate's choice. [PDF p. 2]

### Cloud Platforms

Deployment is optional and encouraged but not required. AWS is preferred if the project is deployed. A local-only implementation is acceptable when it includes clear setup instructions. [PDF p. 2]

### Other Specific Requirements

<a id="req-009"></a>**REQ-009** - Cascade mode must use provider abstractions so the STT, translation, and TTS providers can be swapped without rewriting the application. [PDF p. 2]

<a id="req-010"></a>**REQ-010** - Streaming must continue throughout the cascade pipeline, with no full-utterance blocking. [PDF p. 2]

<a id="req-011"></a>**REQ-011** - An `AGENTS.md` or `CLAUDE.md` file must document how the candidate directed the coding agent. [PDF p. 2]

<a id="req-012"></a>**REQ-012** - Git history must reflect iterative development. [PDF p. 2]

<a id="req-013"></a>**REQ-013** - Per-stage latency instrumentation must be visible in the UI. [PDF p. 2]

## Success Criteria

### Functional Requirements (Must-Haves)

<a id="req-014"></a>**REQ-014** - Provide a browser-based single-page application with microphone capture and audio playback. [PDF p. 2]

- Realtime mode is defined by [REQ-003](#req-003). [PDF p. 2]
- Cascade mode is defined by [REQ-004](#req-004) and its streaming behavior by [REQ-010](#req-010). [PDF p. 2]

<a id="req-015"></a>**REQ-015** - Provide a UI toggle that can switch between modes either mid-session or before a session. [PDF p. 2]

<a id="req-016"></a>**REQ-016** - Provide language-pair selection with, at minimum, English ↔ Spanish. [PDF p. 2]

<a id="req-017"></a>**REQ-017** - Display live transcripts containing both source text and target text as they are produced. [PDF p. 2]

- The user-visible per-stage latency display is defined by [REQ-013](#req-013). [PDF p. 2]

<a id="req-018"></a>**REQ-018** - Deliver a one-to-two-page comparison write-up covering latency, quality, cost, controllability, and a recommendation for which mode fits which scenario. [PDF p. 2]

### Code Quality Expectations

<a id="req-019"></a>**REQ-019** - Keep mode-specific transport cleanly separated from the mode-agnostic UI. [PDF p. 2]

- Provider-boundary expectations are defined by [REQ-009](#req-009). [PDF p. 2]

<a id="req-020"></a>**REQ-020** - Add targeted tests for the cascade pipeline and provider boundaries. Full coverage is not required, but critical paths must be tested. [PDF p. 2]

<a id="req-021"></a>**REQ-021** - Handle provider failures, including rate limits, timeouts, and empty results, and handle denied microphone permission. [PDF p. 2]

<a id="req-022"></a>**REQ-022** - Provide a `README` with setup, run, and architecture-overview instructions. [PDF p. 2]

- The agent-usage document is defined by [REQ-011](#req-011). [PDF p. 2]

<a id="req-023"></a>**REQ-023** - Scope commits to logical units of work with meaningful messages; do not use a single "initial commit" dump. [PDF p. 2]

### Performance Benchmarks

<a id="req-024"></a>**REQ-024** - Realtime mode must have under 1.5 seconds of end-to-end perceived latency, measured from speech end to first audio output. [PDF p. 2]

<a id="req-025"></a>**REQ-025** - Cascade mode must have under 3 seconds of end-to-end latency, with a target below 2 seconds when fully streaming. [PDF p. 3]

<a id="req-026"></a>**REQ-026** - The application must sustain a five-minute back-and-forth conversation without disconnection, audio drift, or memory leaks. [PDF p. 3]

## Time Constraints

<a id="req-027"></a>**REQ-027** - The stated build constraint is three to four days, or approximately 15–20 hours of total effort. [PDF p. 3]

## Critical Requirement Indexes

### Mandatory Conditions

- [REQ-003](#req-003)
- [REQ-004](#req-004)
- [REQ-006](#req-006)
- [REQ-007](#req-007)
- [REQ-009](#req-009)
- [REQ-010](#req-010)
- [REQ-011](#req-011)
- [REQ-012](#req-012)
- [REQ-013](#req-013)
- [REQ-014](#req-014)
- [REQ-015](#req-015)
- [REQ-016](#req-016)
- [REQ-017](#req-017)
- [REQ-018](#req-018)
- [REQ-019](#req-019)
- [REQ-020](#req-020)
- [REQ-021](#req-021)
- [REQ-022](#req-022)
- [REQ-023](#req-023)
- [REQ-024](#req-024)
- [REQ-025](#req-025)
- [REQ-026](#req-026)

### Automatic-Failure Conditions

None stated.

### Deadlines

- [REQ-027](#req-027)

### Numeric Thresholds

- [REQ-016](#req-016)
- [REQ-018](#req-018)
- [REQ-024](#req-024)
- [REQ-025](#req-025)
- [REQ-026](#req-026)
- [REQ-027](#req-027)

### Required Paths

- [REQ-011](#req-011)
- [REQ-022](#req-022)

### Deliverables

- [REQ-014](#req-014)
- [REQ-018](#req-018)
- [REQ-022](#req-022)

## Source Coverage Audit

| Physical page | Captured content | Visuals/tables | Verification |
| --- | --- | --- | --- |
| 1 | Title; problem statement; business context and impact; key metrics; programming-language, AI/ML, and provider-choice requirements; start of development-tools heading | No diagrams, screenshots, or tables | Verified against the 160-DPI page render and selectable-text extraction |
| 2 | Development tools; cloud guidance; provider abstraction and streaming; functional must-haves; code quality; realtime performance benchmark | No diagrams, screenshots, or tables | Verified against the 160-DPI page render and selectable-text extraction |
| 3 | Cascade performance benchmark; stability benchmark; time constraint | No diagrams, screenshots, or tables | Verified against the 160-DPI page render and selectable-text extraction |

## Acceptance Checklist

- [ ] [REQ-001](#req-001)
- [ ] [REQ-002](#req-002)
- [ ] [REQ-003](#req-003)
- [ ] [REQ-004](#req-004)
- [ ] [REQ-005](#req-005)
- [ ] [REQ-006](#req-006)
- [ ] [REQ-007](#req-007)
- [ ] [REQ-008](#req-008)
- [ ] [REQ-009](#req-009)
- [ ] [REQ-010](#req-010)
- [ ] [REQ-011](#req-011)
- [ ] [REQ-012](#req-012)
- [ ] [REQ-013](#req-013)
- [ ] [REQ-014](#req-014)
- [ ] [REQ-015](#req-015)
- [ ] [REQ-016](#req-016)
- [ ] [REQ-017](#req-017)
- [ ] [REQ-018](#req-018)
- [ ] [REQ-019](#req-019)
- [ ] [REQ-020](#req-020)
- [ ] [REQ-021](#req-021)
- [ ] [REQ-022](#req-022)
- [ ] [REQ-023](#req-023)
- [ ] [REQ-024](#req-024)
- [ ] [REQ-025](#req-025)
- [ ] [REQ-026](#req-026)
- [ ] [REQ-027](#req-027)

## Ambiguities and Questions

<a id="amb-001"></a>**AMB-001** - The PDF requires streaming throughout the cascade pipeline but does not define the minimum chunking granularity or whether each provider must emit partial results before the prior stage finalizes a segment. [PDF p. 2]

<a id="amb-002"></a>**AMB-002** - The PDF identifies subjective interpretation quality and WER as impact metrics but does not supply an evaluation corpus, reference translations/transcripts, raters, or scoring methodology. [PDF p. 1]

<a id="amb-003"></a>**AMB-003** - The cascade benchmark says "end-to-end" but, unlike the Realtime benchmark, does not explicitly define its start and end events. [PDF pp. 2-3]

<a id="amb-004"></a>**AMB-004** - The PDF does not define how provider flexibility or time-to-onboard a new language pair should be quantified. [PDF p. 1]

## Visual Content Index

None. The source contains no diagrams, screenshots, or complex tables.
