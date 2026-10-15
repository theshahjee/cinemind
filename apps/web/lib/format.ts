/** "genre:Thriller" -> "Thriller", "director:Jane Doe" -> "Jane Doe (director)". */
export function featureLabel(f: string): string {
  const [kind, ...rest] = f.split(":");
  const value = rest.join(":");
  switch (kind) {
    case "genre":
      return value;
    case "decade":
      return value;
    case "language":
      return `${value.toUpperCase()} language`;
    default:
      return `${value} (${kind})`;
  }
}

export function runtime(min?: number): string | undefined {
  if (!min) return undefined;
  const h = Math.floor(min / 60);
  return h ? `${h}h ${min % 60}m` : `${min}m`;
}

export function posterUrl(path?: string): string | undefined {
  return path ? `https://image.tmdb.org/t/p/w342${path}` : undefined;
}
