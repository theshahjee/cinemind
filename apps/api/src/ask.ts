import type { Title, TitleType } from "@cinemind/core";
import type { LlmProvider } from "./llm/provider.js";

/** Structured constraints extracted from a natural-language request. */
export interface Constraints {
  includeGenres: string[];
  excludeGenres: string[];
  types: TitleType[];
  maxRuntimeMinutes?: number;
  minYear?: number;
  maxYear?: number;
  language?: string;
  /** Free-text mood or tone hints that metadata can't filter on. Shown to the user, not enforced. */
  softPreferences: string[];
}

const GENRES = [
  "Action", "Adventure", "Animation", "Biography", "Comedy", "Crime", "Documentary", "Drama", "Family",
  "Fantasy", "History", "Horror", "Music", "Musical", "Mystery", "Romance", "Sci-Fi", "Sport", "Thriller", "War", "Western",
];

const SCHEMA = {
  type: "object",
  properties: {
    includeGenres: { type: "array", items: { type: "string", enum: GENRES } },
    excludeGenres: { type: "array", items: { type: "string", enum: GENRES } },
    types: { type: "array", items: { type: "string", enum: ["movie", "tvSeries", "tvMiniSeries"] } },
    maxRuntimeMinutes: { type: "integer" },
    minYear: { type: "integer" },
    maxYear: { type: "integer" },
    language: { type: "string", description: "ISO 639-1 code, only if the user asked for one" },
    softPreferences: { type: "array", items: { type: "string" } },
  },
  required: ["includeGenres", "excludeGenres", "types", "softPreferences"],
} as const;

const PROMPT = `You turn a viewer's request into search filters for a personal movie and TV catalogue.
Only fill a field when the request clearly implies it. Put mood, tone and theme wishes that genres cannot express
(for example "not depressing", "satisfying ending", "believable characters") in softPreferences, in a few words each.
Do not invent titles. Request:
`;

/**
 * Turn a request into constraints with the LLM when one is configured, and
 * with a small rule-based parser otherwise, so the feature degrades instead of failing.
 */
export async function extractConstraints(query: string, llm?: LlmProvider): Promise<{ constraints: Constraints; via: string }> {
  if (llm) {
    try {
      const c = await llm.generateJson<Constraints>(PROMPT + JSON.stringify(query), SCHEMA);
      return { constraints: { ...c, softPreferences: c.softPreferences ?? [] }, via: llm.name };
    } catch {
      // Fall through to the rule-based parser: quota exhaustion shouldn't break search.
    }
  }
  return { constraints: ruleBasedConstraints(query), via: "rules" };
}

export function ruleBasedConstraints(query: string): Constraints {
  const q = query.toLowerCase();
  const c: Constraints = { includeGenres: [], excludeGenres: [], types: [], softPreferences: [] };
  const aliases: Record<string, string> = { "sci fi": "Sci-Fi", "science fiction": "Sci-Fi", scifi: "Sci-Fi", funny: "Comedy", scary: "Horror", romantic: "Romance" };

  const mentions = [...GENRES.map((g) => [g.toLowerCase(), g] as const), ...Object.entries(aliases)];
  for (const [word, genre] of mentions) {
    const idx = q.indexOf(word);
    if (idx < 0) continue;
    const before = q.slice(Math.max(0, idx - 15), idx);
    const target = /\b(no|not|without|less|avoid)\b[^,.]*$/.test(before) ? c.excludeGenres : c.includeGenres;
    if (!target.includes(genre)) target.push(genre);
  }
  if (/\b(series|show|tv)\b/.test(q)) c.types.push("tvSeries", "tvMiniSeries");
  if (/\b(movie|film)s?\b/.test(q)) c.types.push("movie");

  const hours = q.match(/under (one|two|three|\d+(?:\.\d+)?) hours?/);
  if (hours) {
    const words: Record<string, number> = { one: 1, two: 2, three: 3 };
    c.maxRuntimeMinutes = Math.round((words[hours[1]!] ?? Number(hours[1])) * 60);
  }
  const mins = q.match(/under (\d+) min/);
  if (mins) c.maxRuntimeMinutes = Number(mins[1]);

  const decade = q.match(/\b(19|20)(\d)0s\b/);
  if (decade) {
    c.minYear = Number(`${decade[1]}${decade[2]}0`);
    c.maxYear = c.minYear + 9;
  }
  return c;
}

export function matchesConstraints(t: Title, c: Constraints): boolean {
  if (c.includeGenres.length && !c.includeGenres.some((g) => t.genres.includes(g))) return false;
  if (c.excludeGenres.some((g) => t.genres.includes(g))) return false;
  if (c.types.length && !c.types.includes(t.type)) return false;
  if (c.maxRuntimeMinutes && t.runtimeMinutes && t.runtimeMinutes > c.maxRuntimeMinutes) return false;
  if (c.minYear && t.year && t.year < c.minYear) return false;
  if (c.maxYear && t.year && t.year > c.maxYear) return false;
  if (c.language && t.language && t.language !== c.language) return false;
  return true;
}
