/**
 * Provider abstraction so the LLM can be swapped (Gemini today, a local model
 * later) and so the app keeps working when no provider is configured.
 */
export interface LlmProvider {
  readonly name: string;
  /** Ask for JSON matching `schema` (a JSON Schema object). Returns the parsed value. */
  generateJson<T>(prompt: string, schema: Record<string, unknown>): Promise<T>;
  /** Embed texts into fixed-size vectors (768 dimensions, matching the database column). */
  embed(texts: readonly string[]): Promise<number[][]>;
}

export class LlmUnavailableError extends Error {
  constructor(message = "No LLM provider is configured") {
    super(message);
  }
}
