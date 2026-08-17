import type {
  CascadeServerEvent,
  LanguagePair,
} from "../../shared/protocol";

export type InterpreterEvent = CascadeServerEvent;
export type EventHandler = (event: InterpreterEvent) => void;

export interface InterpreterTransport {
  connect(pair: LanguagePair, onEvent: EventHandler): Promise<void>;
  disconnect(): Promise<void>;
}

export function parseServerError(payload: unknown, fallback: string): Error {
  if (
    payload &&
    typeof payload === "object" &&
    "error" in payload &&
    payload.error &&
    typeof payload.error === "object" &&
    "message" in payload.error &&
    typeof payload.error.message === "string"
  ) {
    return new Error(payload.error.message);
  }
  return new Error(fallback);
}

export function microphoneError(error: unknown): Error {
  if (error instanceof DOMException && error.name === "NotAllowedError") {
    return new Error("Microphone permission was denied. Allow microphone access and try again.");
  }
  if (error instanceof DOMException && error.name === "NotFoundError") {
    return new Error("No microphone was found on this device.");
  }
  return error instanceof Error ? error : new Error("The microphone could not be started.");
}

