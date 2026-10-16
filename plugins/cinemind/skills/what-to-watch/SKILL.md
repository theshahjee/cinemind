---
name: what-to-watch
description: Pick something to watch from the user's own CineMind taste profile. Use when the user asks what to watch, wants a film or series suggestion, or asks why they might like a title.
---

Use the `cinemind` MCP tools. Don't recommend from general knowledge alone.

1. If the request has constraints (mood, length, genre, decade, "like X"), call `ask` with the request in the user's words. Otherwise call `recommend`.
2. For "like X", call `search_titles` first to confirm X is in the catalogue and see how the user rated it.
3. Suggest three to five titles. For each one, give the year and runtime, plus one line on why it fits, taken from its `matches`. If `conflicts` is non-empty, mention it.
4. Keep the two kinds of data apart. Genres, year, runtime and IMDb rating are catalogue facts. Score, matches and conflicts are predictions about the user's taste.
5. Only call `rate_title` or `add_to_watchlist` when the user explicitly asks, and never invent a rating.
