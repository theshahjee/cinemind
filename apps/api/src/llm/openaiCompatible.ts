import type { LlmProvider } from "./provider.js";

/**
 * Any server that speaks the OpenAI chat-completions and embeddings API:
 * Ollama (local, free), Groq, OpenRouter, DeepSeek, Mistral, OpenAI, LM Studio.
 * Chat and embeddings can point at different servers, for example Groq for
 * chat and a local Ollama for embeddings.
 */
export interface OpenAiCompatibleOptions {
  baseUrl: string;
  apiKey?: string;
  model: string;
  embeddingBaseUrl?: string;
  embeddingApiKey?: string;
  embeddingModel?: string;
  name?: string;
  fetchImpl?: typeof fetch;
}

export class OpenAiCompatibleProvider implements LlmProvider {
  readonly name: string;
  private readonly fetchImpl: typeof fetch;

  constructor(private readonly opts: OpenAiCompatibleOptions) {
    this.name = opts.name ?? "openai-compatible";
    this.fetchImpl = opts.fetchImpl ?? fetch;
  }

  private async post(baseUrl: string, apiKey: string | undefined, path: string, body: unknown): Promise<unknown> {
    const headers: Record<string, string> = { "content-type": "application/json" };
    if (apiKey) headers.authorization = `Bearer ${apiKey}`;
    const res = await this.fetchImpl(`${baseUrl.replace(/\/$/, "")}${path}`, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(60_000),
    });
    if (!res.ok) throw new Error(`${this.name} ${path} failed with ${res.status}: ${(await res.text()).slice(0, 300)}`);
    return res.json();
  }

  async generateJson<T>(prompt: string, schema: Record<string, unknown>): Promise<T> {
    // json_object mode is the most widely supported option; the schema goes in the prompt.
    const data = (await this.post(this.opts.baseUrl, this.opts.apiKey, "/chat/completions", {
      model: this.opts.model,
      temperature: 0,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: `Reply with a single JSON object matching this JSON Schema:\n${JSON.stringify(schema)}` },
        { role: "user", content: prompt },
      ],
    })) as { choices?: { message?: { content?: string } }[] };
    const text = data.choices?.[0]?.message?.content;
    if (!text) throw new Error(`${this.name} returned no content`);
    return JSON.parse(text) as T;
  }

  async embed(texts: readonly string[]): Promise<number[][]> {
    if (!this.opts.embeddingModel) throw new Error("No embedding model configured");
    const data = (await this.post(
      this.opts.embeddingBaseUrl ?? this.opts.baseUrl,
      this.opts.embeddingApiKey ?? this.opts.apiKey,
      "/embeddings",
      { model: this.opts.embeddingModel, input: texts },
    )) as { data: { embedding: number[]; index: number }[] };
    const vecs = [...data.data].sort((a, b) => a.index - b.index).map((d) => d.embedding);
    for (const v of vecs) {
      if (v.length !== 768) throw new Error(`Embedding model returned ${v.length} dimensions; CineMind stores 768`);
    }
    return vecs;
  }
}
