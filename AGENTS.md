# Coding agent directions

This project was built with Codex under the following user and project constraints.

## Product direction

- Read the project requirements PDF through the verified PDF-to-Markdown workflow and treat the generated Markdown as the requirement source during implementation.
- Ignore the brief’s time-box section; prioritize completing a functional implementation quickly.
- Use an all-TypeScript stack.
- Use the OpenAI API for both architectures because an API account is available.
- Make English → Japanese the default experience while preserving the required English ↔ Spanish support.
- Implement the complete application, then publish it to `cloudspiral/ai-interpreter-workbench` and deploy the functional result to Railway.

## Engineering direction

- Keep the OpenAI API key server-only and never commit `.env`.
- Use the exact `gpt-realtime` default named in the brief. Make model names configurable, and surface unavailable model/account errors rather than silently substituting a different evaluation target.
- Stream every cascade boundary; do not wait for a complete utterance before beginning translation and synthesis.
- Keep browser UI state mode-agnostic and transport implementations separate.
- Put translation and TTS behind provider interfaces and keep provider SDK calls out of the cascade coordinator.
- Show only measured latency. Label integrated Realtime stages instead of fabricating separate measurements.
- Add targeted tests for chunking, orchestration, safe provider failures, live UI events, language defaults, and mid-session switching.
- Make Git commits logical and comprehensive; commit messages should describe all material changes, even if the messages are long.

## Completion evidence

- Run `pnpm check` before publication.
- Verify `/api/health`, exercise the production browser build, and perform a provider model preflight without printing the API key.
- Treat latency thresholds and five-minute stability as live acceptance trials, not claims that unit tests can prove.
- After deployment, verify the public health route and visible browser UI.
