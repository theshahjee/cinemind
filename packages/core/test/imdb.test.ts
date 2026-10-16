import { describe, expect, it } from "vitest";
import { importImdbRatings, parseCsv } from "../src/index.js";

const HEADER =
  "Const,Your Rating,Date Rated,Title,Original Title,URL,Title Type,IMDb Rating,Runtime (mins),Year,Genres,Num Votes,Release Date,Directors";

describe("parseCsv", () => {
  it("handles quoted commas, escaped quotes and CRLF", () => {
    const rows = parseCsv('a,b\r\n"x, y","say ""hi"""\r\n');
    expect(rows).toEqual([
      ["a", "b"],
      ["x, y", 'say "hi"'],
    ]);
  });

  it("strips a UTF-8 BOM", () => {
    expect(parseCsv("﻿a,b\n1,2")[0]).toEqual(["a", "b"]);
  });
});

describe("importImdbRatings", () => {
  it("parses a ratings export", () => {
    const csv = [
      HEADER,
      'tt0000001,9,2024-03-01,"Film, The",Film,https://x,Movie,8.1,120,2010,"Drama, Crime",50000,2010-01-01,"Jane Doe, John Roe"',
      "tt0000002,4,2024-04-01,Show,Show,https://x,TV Series,7.0,45,2019,Comedy,1000,2019-01-01,",
    ].join("\n");
    const res = importImdbRatings(csv);
    expect(res.skipped).toEqual([]);
    expect(res.ratings).toHaveLength(2);
    expect(res.titles[0]).toMatchObject({
      id: "tt0000001",
      title: "Film, The",
      type: "movie",
      genres: ["Drama", "Crime"],
      directors: ["Jane Doe", "John Roe"],
      runtimeMinutes: 120,
    });
    expect(res.titles[1]!.type).toBe("tvSeries");
    expect(res.titles[1]!.directors).toEqual([]);
  });

  it("reports bad rows instead of failing the whole import", () => {
    const csv = [HEADER, "tt1,11,2024-01-01,Bad,,,Movie,,,,,,,", "nope,5,2024-01-01,Bad,,,Movie,,,,,,,"].join("\n");
    const res = importImdbRatings(csv);
    expect(res.ratings).toHaveLength(0);
    expect(res.skipped.map((s) => s.line)).toEqual([2, 3]);
  });

  it("recognises a watchlist export and keeps list order", () => {
    const LIST =
      "Position,Const,Created,Modified,Description,Title,Original Title,URL,Title Type,IMDb Rating,Runtime (mins),Year,Genres,Num Votes,Release Date,Directors,Your Rating,Date Rated";
    const csv = [
      LIST,
      "1,tt0000005,2025-01-01,2025-01-01,,Saved Film,,https://x,Movie,7.1,100,2020,Drama,5000,2020-01-01,Someone,,",
      "2,tt0000006,2025-02-01,2025-02-01,,Saved Show,,https://x,TV Series,8.0,50,2019,Comedy,9000,2019-01-01,,7,2025-03-01",
      "3,bad,2025-02-01,,,Broken,,,Movie,,,,,,,,,",
    ].join("\n");
    const res = importImdbRatings(csv);
    expect(res.kind).toBe("list");
    expect(res.listIds).toEqual(["tt0000005", "tt0000006"]);
    expect(res.titles.map((t) => t.type)).toEqual(["movie", "tvSeries"]);
    expect(res.ratings).toEqual([{ titleId: "tt0000006", rating: 7, ratedAt: new Date("2025-03-01") }]);
    expect(res.skipped.map((s) => s.line)).toEqual([4]);
  });

  it("treats a ratings export as ratings", () => {
    const res = importImdbRatings([HEADER, "tt0000001,9,2024-03-01,Film,,,Movie,,,,,,,"].join("\n"));
    expect(res.kind).toBe("ratings");
    expect(res.listIds).toEqual([]);
  });

  it("rejects files that are not IMDb exports", () => {
    expect(() => importImdbRatings("foo,bar\n1,2")).toThrow(/Missing required column/);
  });
});
