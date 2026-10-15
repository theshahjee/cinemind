import type { LlmProvider } from "./provider.js";

const BASE = "https://generativelanguage.googleapis.com/v1beta";

/**
 * Gemini over its REST API. The key stays on the server and is sent in a
 * header, never in a URL.
 */
export class GeminiProvider implements LlmProvider {
  readonly name = "gemini";

  constructor(
    private readonly apiKey: string,
    private readonly model: string,
    private readonly embeddingModel: string,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  private async post(path: string, body: unknown): Promise<unknown> {
    const res = await this.fetchImpl(`${BASE}/${path}`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-goog-api-key": this.apiKey },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(30_000),
    });
    if (!res.ok) throw new Error(`Gemini ${path} failed with ${res.status}: ${(await res.text()).slice(0, 300)}`);
    return res.json();
  }

  async generateJson<T>(prompt: string, schema: Record<string, unknown>): Promise<T> {
    const data = (await this.post(`models/${this.model}:generateContent`, {
      contents: [{ role: "user", parts: [{ text: prompt }] }],
      generationConfig: { responseMimeType: "application/json", responseJsonSchema: schema, temperature: 0 },
    })) as { candidates?: { content?: { parts?: { text?: string }[] } }[] };
    const text = data.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!text) throw new Error("Gemini returned no content");
    return JSON.parse(text) as T;
  }

  async embed(texts: readonly string[]): Promise<number[][]> {
    const data = (await this.post(`models/${this.embeddingModel}:batchEmbedContents`, {
      requests: texts.map((text) => ({
        model: `models/${this.embeddingModel}`,
        content: { parts: [{ text }] },
        taskType: "SEMANTIC_SIMILARITY",
        outputDimensionality: 768,
      })),
    })) as { embeddings: { values: number[] }[] };
    return data.embeddings.map((e) => e.values);
  }
}
