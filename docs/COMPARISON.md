# Realtime vs. Cascade: architecture recommendation

Kiku implements both modes with OpenAI so the comparison is about architecture, not a confounded comparison of vendors. The same browser interaction, language directions, transcript surface, and latency definitions make the operational difference visible.

## Executive recommendation

Use **Realtime** for fluid live conversation: interpreting a meeting, customer call, or in-person exchange where turn-taking and perceived responsiveness matter most. Use **Cascade** when the product must inspect, transform, govern, route, or independently replace stages—for example, regulated workflows, terminology-heavy domains, auditable transcripts, or vendor optimization.

For Boostlingo’s likely production setting, I would make Realtime the default conversational experience and retain the cascade as a policy-controlled path. The direct path optimizes human flow; the cascade is the engineering control plane. A mature product can route per tenant or scenario rather than forcing one architecture everywhere.

## Tradeoff matrix

| Dimension | Realtime voice-to-voice | Streaming cascade |
|---|---|---|
| Latency | Lowest theoretical and perceived latency because one model handles the interaction and WebRTC is optimized for media. | More network and scheduling boundaries. Stable partial-text chunking overlaps stages, but STT, translation, and TTS each add time. |
| Quality | Strong conversational prosody, turn-taking, and interruption behavior. The integrated model has more acoustic context. | Each stage can be selected and prompted for its task. Text boundaries can lose tone or context, but terminology and output can be validated explicitly. |
| Cost | One multimodal session and a simpler infrastructure path. Exact economics depend on audio token duration and session behavior. | Three billable services plus orchestration. It can still win when cheaper specialist providers or selective synthesis are used. |
| Control | Instructions can constrain the interpreter, but internal translation and voice generation are inseparable. | Full control over intermediate text, glossary injection, moderation, fallback, retries, caching, and vendor selection. |
| Observability | Clear end-to-end behavior and usage, but stage-specific timing is inherently integrated. | Each boundary exposes latency, errors, tokens, transcript fragments, and retry decisions. |
| Resilience | Fewer moving parts, although a Realtime session failure ends the full path. | More failure modes, but stages can have independent fallbacks or circuit breakers. |
| Compliance | Audio is handled by the integrated provider and transcript events can be observed. | Intermediate text can be logged, reviewed, redacted, or blocked before synthesis—subject to the product’s data policy. |

## What the implementation teaches

### Realtime path

WebRTC is the right browser transport. The backend creates the call but never proxies the media, avoiding an unnecessary server audio hop. Server VAD creates responses and supports interruption. Input and output transcript events let the UI remain transparent without rebuilding the voice pipeline.

The main gotcha is that integrated architecture limits attribution. It is truthful to measure speech-end-to-first-audio and speech-start-to-first-transcript. It is not truthful to invent separate translation and TTS numbers, so Kiku labels those stages **integrated**. Model lifecycle and account access are another operational risk: the brief names `gpt-realtime`, and the service fails clearly if that exact configured model is unavailable rather than silently changing the evaluation target.

### Cascade path

“Streaming” needs to apply to every boundary. Streaming microphone bytes into STT and then waiting for the final utterance before translation would still feel like a batch system. Kiku uses stable incremental chunks: punctuation dispatches a fragment once it is long enough, and hard limits find safe word boundaries. Japanese uses shorter thresholds because it has no whitespace-based word cadence.

Translation output streams into the transcript, while each completed translated fragment begins TTS immediately. The browser schedules raw PCM buffers on one audio clock, preventing gaps from each network chunk. A serialized work queue preserves phrase order and bounds concurrency.

The main cascade gotcha is the stability/latency tension. Tiny partials reduce latency but can translate ambiguous clauses incorrectly; large chunks improve context but recreate full-utterance blocking. Production should tune thresholds from captured conversational data and add domain glossaries. It should also add provider-specific retry budgets, per-stage circuit breakers, and a bounded session-level queue.

## Quality, cost, and evaluation

No single demo conversation can establish quality or cost. A credible evaluation set should contain English ↔ Japanese and English ↔ Spanish turns covering names, numbers, corrections, interruptions, idioms, domain terminology, code-switching, and noisy audio. Human raters should score meaning preservation, omissions, additions, tone, pronunciation, and time-to-understanding.

Cost should be measured from actual provider usage across the same audio corpus. Realtime reports session input/output usage. The cascade reports translation token usage; STT and TTS should additionally be calculated from audio duration/characters using current account pricing. Pricing is deliberately not hard-coded because it changes independently of the application.

For latency, capture distributions rather than averages: median, p95, and worst case for each visible metric. The required acceptance targets are:

- Realtime: speech end to first output audio under 1.5 seconds.
- Cascade: end-to-end under 3 seconds, targeting under 2 seconds while fully streaming.
- Both: a five-minute back-and-forth session without disconnect, audio drift, or unbounded memory growth.

Kiku exposes the measurements needed for those trials but does not pre-populate or claim unobserved results. Network location, microphone hardware, speech cadence, language pair, provider load, and account tier all affect the result.

## Scenario guidance

Choose **Realtime** when:

- people are actively conversing and interruption must feel natural;
- the language task is ordinary interpretation rather than a governed text workflow;
- the product values minimal latency and infrastructure simplicity;
- one provider and one integrated quality profile are acceptable.

Choose **Cascade** when:

- terminology, translation memory, redaction, or validation must run between stages;
- intermediate transcripts are a product artifact or audit requirement;
- providers must be swapped per region, customer, price, or outage;
- independent stage telemetry and deterministic policy control outweigh the added latency.

The practical recommendation is therefore not “one always wins.” Realtime is the better default experience; cascade is the better controlled system. Kiku makes that boundary explicit enough to support a measured routing decision later.
