import type { Config } from "../config.js";
import { GeminiProvider } from "./gemini.js";
import { OpenAiCompatibleProvider } from "./openaiCompatible.js";
import type { LlmProvider } from "./provider.js";

/** Build the configured provider, or undefined to run without an LLM. */
export function createLlm(config: Config): LlmProvider | undefined {
  switch (config.llmProvider) {
    case "none":
      return undefined;
    case "gemini":
      if (!config.geminiApiKey) throw new Error("LLM_PROVIDER=gemini needs GEMINI_API_KEY");
      return new GeminiProvider(config.geminiApiKey, config.llmModel, config.embeddingModel);
    case "openai":
      if (!config.llmBaseUrl) throw new Error("LLM_PROVIDER=openai needs LLM_BASE_URL");
      return new OpenAiCompatibleProvider({
        baseUrl: config.llmBaseUrl,
        apiKey: config.llmApiKey,
        model: config.llmModel,
        embeddingBaseUrl: config.embeddingBaseUrl,
        embeddingApiKey: config.embeddingApiKey,
        embeddingModel: config.embeddingModel,
        name: new URL(config.llmBaseUrl).hostname,
      });
  }
}
