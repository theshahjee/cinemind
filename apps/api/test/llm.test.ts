import { describe, expect, it } from "vitest";
import { loadConfig } from "../src/config.js";
import { createLlm } from "../src/llm/index.js";
import { OpenAiCompatibleProvider } from "../src/llm/openaiCompatible.js";

function fakeFetch(responses: Record<string, unknown>, calls: { url: string; body: any; headers: any }[]): typeof fetch {
  return (async (url: string, init: RequestInit) => {
    calls.push({ url, body: JSON.parse(init.body as string), headers: init.headers });
    const key = Object.keys(responses).find((k) => url.endsWith(k))!;
    return new Response(JSON.stringify(responses[key]), { status: 200 });
  }) as unknown as typeof fetch;
}

describe("OpenAiCompatibleProvider", () => {
  it("requests JSON and parses it", async () => {
    const calls: any[] = [];
    const p = new OpenAiCompatibleProvider({
      baseUrl: "http://localhost:11434/v1/",
      model: "llama3.1",
      fetchImpl: fakeFetch({ "/chat/completions": { choices: [{ message: { content: '{"a":1}' } }] } }, calls),
    });
    expect(await p.generateJson("hi", { type: "object" })).toEqual({ a: 1 });
    expect(calls[0].url).toBe("http://localhost:11434/v1/chat/completions");
    expect(calls[0].body.response_format).toEqual({ type: "json_object" });
    expect(calls[0].headers.authorization).toBeUndefined();
  });

  it("sends embeddings to a separate server and checks dimensions", async () => {
    const calls: any[] = [];
    const vec = Array(768).fill(0.1);
    const p = new OpenAiCompatibleProvider({
      baseUrl: "https://api.groq.com/openai/v1",
      apiKey: "chat-key",
      model: "m",
      embeddingBaseUrl: "http://localhost:11434/v1",
      embeddingModel: "nomic-embed-text",
      fetchImpl: fakeFetch({ "/embeddings": { data: [{ index: 1, embedding: vec }, { index: 0, embedding: vec }] } }, calls),
    });
    expect(await p.embed(["a", "b"])).toHaveLength(2);
    expect(calls[0].url).toBe("http://localhost:11434/v1/embeddings");
    expect(calls[0].headers.authorization).toBe("Bearer chat-key");

    const bad = new OpenAiCompatibleProvider({
      baseUrl: "x://",
      model: "m",
      embeddingModel: "e",
      fetchImpl: fakeFetch({ "/embeddings": { data: [{ index: 0, embedding: [1, 2] }] } }, []),
    });
    await expect(bad.embed(["a"])).rejects.toThrow(/768/);
  });
});

describe("config", () => {
  const base = { CINEMIND_API_TOKEN: "secret" };
  it("runs without an LLM by default", () => {
    expect(createLlm(loadConfig(base))).toBeUndefined();
  });
  it("selects Gemini when only a Gemini key is set", () => {
    expect(createLlm(loadConfig({ ...base, GEMINI_API_KEY: "k" }))?.name).toBe("gemini");
  });
  it("configures an OpenAI-compatible server", () => {
    const llm = createLlm(loadConfig({ ...base, LLM_PROVIDER: "openai", LLM_BASE_URL: "https://api.groq.com/openai/v1" }));
    expect(llm?.name).toBe("api.groq.com");
  });
  it("refuses the placeholder token", () => {
    expect(() => loadConfig({ CINEMIND_API_TOKEN: "change-me" })).toThrow();
  });
});
