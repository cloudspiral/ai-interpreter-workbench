import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { CascadeServerEvent, LanguagePair } from "../shared/protocol";
import { App, type TransportFactory } from "./App";
import type { EventHandler, InterpreterTransport } from "./lib/interpreter";

class FakeTransport implements InterpreterTransport {
  readonly connect = vi.fn(async (_pair: LanguagePair, onEvent: EventHandler) => {
    onEvent({
      type: "ready",
      models: {
        realtimeModel: "gpt-realtime",
        transcriptionModel: "gpt-live-transcribe",
        translationModel: "gpt-5.4-mini",
        ttsModel: "tts-1",
        apiKeyConfigured: true,
      },
    });
    onEvent({ type: "status", status: "listening", message: "Ready for speech" });
  });

  readonly disconnect = vi.fn(async () => undefined);

  emit(onEvent: EventHandler, ...events: CascadeServerEvent[]): void {
    for (const event of events) onEvent(event);
  }
}

describe("App", () => {
  it("starts Japanese-first and retains the rubric-required Spanish directions", () => {
    render(<App transportFactory={() => new FakeTransport()} />);

    expect(screen.getByRole("combobox", { name: "Language direction" })).toHaveValue("en-ja");
    expect(screen.getByRole("option", { name: "English → Spanish" })).toBeInTheDocument();
    expect(screen.getByRole("option", { name: "Spanish → English" })).toBeInTheDocument();
    expect(screen.getByRole("radio", { name: /Realtime/ })).toHaveAttribute("aria-checked", "true");
  });

  it("connects the selected transport and renders streamed transcripts and latency", async () => {
    const transport = new FakeTransport();
    let handler: EventHandler | undefined;
    transport.connect.mockImplementation(async (_pair, onEvent) => {
      handler = onEvent;
      onEvent({ type: "status", status: "listening", message: "Ready for speech" });
    });
    const factory: TransportFactory = () => transport;
    render(<App transportFactory={factory} />);

    fireEvent.click(screen.getByRole("button", { name: /Start interpreting/ }));
    await waitFor(() => expect(transport.connect).toHaveBeenCalledWith(expect.objectContaining({ id: "en-ja" }), expect.any(Function)));

    handler?.({ type: "source_delta", delta: "Good morning", turnId: 1 });
    handler?.({ type: "source_done", transcript: "Good morning", turnId: 1 });
    handler?.({ type: "target_delta", delta: "おはようございます", turnId: 1 });
    handler?.({ type: "target_done", translation: "おはようございます", turnId: 1 });
    handler?.({ type: "latency", stage: "total", milliseconds: 842, turnId: 1, basis: "speech-end → first audio" });

    expect(await screen.findByText("Good morning")).toBeInTheDocument();
    expect(screen.getByText("おはようございます")).toBeInTheDocument();
    expect(screen.getByText("842 ms")).toBeInTheDocument();
  });

  it("shows connection failures without exposing implementation details", async () => {
    const transport = new FakeTransport();
    transport.connect.mockRejectedValueOnce(new Error("OpenAI rejected the session. Check the configured model and account access."));
    render(<App transportFactory={() => transport} />);

    fireEvent.click(screen.getByRole("button", { name: /Start interpreting/ }));

    expect(await screen.findByRole("alert")).toHaveTextContent("OpenAI rejected the session");
    expect(screen.getByRole("status")).toHaveTextContent("Needs attention");
  });

  it("hot-switches an active session from Realtime to Cascade", async () => {
    const transports = [new FakeTransport(), new FakeTransport()];
    const factory = vi.fn(() => transports.shift() ?? new FakeTransport());
    render(<App transportFactory={factory} />);

    fireEvent.click(screen.getByRole("button", { name: /Start interpreting/ }));
    await screen.findByRole("button", { name: /End session/ });
    fireEvent.click(screen.getByRole("radio", { name: /Cascade/ }));

    await waitFor(() => expect(factory).toHaveBeenCalledTimes(2));
    expect(screen.getByRole("radio", { name: /Cascade/ })).toHaveAttribute("aria-checked", "true");
  });
});
