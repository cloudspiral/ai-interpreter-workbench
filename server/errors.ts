import OpenAI from "openai";

export class PublicError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly retryable = false,
    public readonly status = 500,
  ) {
    super(message);
    this.name = "PublicError";
  }
}

export function toPublicError(error: unknown): PublicError {
  if (error instanceof PublicError) {
    return error;
  }

  if (error instanceof OpenAI.APIError) {
    if (error.status === 429) {
      return new PublicError(
        "provider_rate_limit",
        "OpenAI is rate-limiting this session. Wait briefly and try again.",
        true,
        429,
      );
    }
    if (error.status === 401 || error.status === 403) {
      return new PublicError(
        "provider_auth",
        "The server could not authenticate with OpenAI. Check the API key and model access.",
        false,
        502,
      );
    }
    if (error.status === 404) {
      return new PublicError(
        "model_unavailable",
        "The configured OpenAI model is unavailable for this account.",
        false,
        502,
      );
    }
    return new PublicError(
      "provider_failure",
      "OpenAI could not complete this interpretation stage.",
      error.status >= 500,
      502,
    );
  }

  if (error instanceof Error && (error.name === "AbortError" || error.name === "TimeoutError")) {
    return new PublicError(
      "provider_timeout",
      "An interpretation stage timed out. Please try again.",
      true,
      504,
    );
  }

  return new PublicError(
    "internal_error",
    "The interpretation session ended unexpectedly.",
    true,
    500,
  );
}
