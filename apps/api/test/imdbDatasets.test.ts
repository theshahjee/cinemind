import { describe, expect, it } from "vitest";
import { buildCatalogue } from "../src/imdbDatasets.js";

async function* lines(xs: string[]) {
  yield* xs;
}

const FILES: Record<string, string[]> = {
  "title.ratings.tsv.gz": ["tconst\taverageRating\tnumVotes", "tt01\t8.1\t50000", "tt02\t6.0\t100", "tt03\t7.0\t30000", "tt04\t7.5\t90000"],
  "title.basics.tsv.gz": [
    "tconst\ttitleType\tprimaryTitle\toriginalTitle\tisAdult\tstartYear\tendYear\truntimeMinutes\tgenres",
    "tt01\tmovie\tFilm One\tFilm One\t0\t2001\t\\N\t120\tCrime,Drama",
    "tt02\tmovie\tObscure\tObscure\t0\t2002\t\\N\t90\tDrama",
    "tt03\ttvEpisode\tAn Episode\tAn Episode\t0\t2003\t\\N\t45\tComedy",
    "tt04\ttvSeries\tA Show\tA Show\t0\t2010\t2014\t\\N\t\\N",
  ],
  "title.crew.tsv.gz": ["tconst\tdirectors\twriters", "tt01\tnm1,nm2\t\\N", "tt04\t\\N\tnm3"],
  "name.basics.tsv.gz": ["nconst\tprimaryName\tbirthYear", "nm1\tJane Doe\t1970", "nm2\tJohn Roe\t1980", "nm9\tUnused\t1990"],
};

describe("buildCatalogue", () => {
  it("joins the IMDb datasets, filtering by votes and type", async () => {
    const titles = await buildCatalogue({ minVotes: 1000, types: ["movie", "tvSeries"] }, (f) => lines(FILES[f]!));
    expect(titles).toEqual([
      {
        id: "tt01",
        title: "Film One",
        type: "movie",
        year: 2001,
        runtimeMinutes: 120,
        genres: ["Crime", "Drama"],
        directors: ["Jane Doe", "John Roe"],
        imdbRating: 8.1,
        numVotes: 50000,
      },
      {
        id: "tt04",
        title: "A Show",
        type: "tvSeries",
        year: 2010,
        runtimeMinutes: undefined,
        genres: [],
        directors: [],
        imdbRating: 7.5,
        numVotes: 90000,
      },
    ]);
  });
});
