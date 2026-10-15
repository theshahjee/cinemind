export type LlmProviderName = "none" | "gemini" | "openai";

export interface Config {
  port: number;
  host: string;
  databaseUrl?: string;
  apiToken: string;
  tmdbToken?: string;
  llmProvider: LlmProviderName;
  llmModel: string;
  /** OpenAI-compatible chat endpoint, for example http://localhost:11434/v1 for Ollama. */
  llmBaseUrl?: string;
  llmApiKey?: string;
  geminiApiKey?: string;
  embeddingModel: string;
  embeddingBaseUrl?: string;
  embeddingApiKey?: string;
  corsOrigin: string;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const apiToken = env.CINEMIND_API_TOKEN;
  if (!apiToken || apiToken === "change-me") {
    throw new Error("Set CINEMIND_API_TOKEN to a random secret (for example: openssl rand -hex 32)");
  }
  const provider = (env.LLM_PROVIDER ?? (env.GEMINI_API_KEY ? "gemini" : "none")) as LlmProviderName;
  if (!["none", "gemini", "openai"].includes(provider)) throw new Error(`Unknown LLM_PROVIDER "${provider}"`);
  const defaults = {
    none: { model: "", embedding: "" },
    gemini: { model: "gemini-2.5-flash", embedding: "gemini-embedding-001" },
    openai: { model: "llama3.1", embedding: "nomic-embed-text" },
  }[provider];

  return {
    port: Number(env.PORT ?? 4000),
    host: env.HOST ?? "0.0.0.0",
    databaseUrl: env.DATABASE_URL || undefined,
    apiToken,
    tmdbToken: env.TMDB_READ_TOKEN || undefined,
    llmProvider: provider,
    llmModel: env.LLM_MODEL || defaults.model,
    llmBaseUrl: env.LLM_BASE_URL || undefined,
    llmApiKey: env.LLM_API_KEY || undefined,
    geminiApiKey: env.GEMINI_API_KEY || undefined,
    embeddingModel: env.EMBEDDING_MODEL || defaults.embedding,
    embeddingBaseUrl: env.EMBEDDING_BASE_URL || undefined,
    embeddingApiKey: env.EMBEDDING_API_KEY || undefined,
    corsOrigin: env.CORS_ORIGIN ?? "http://localhost:3000",
  };
}
