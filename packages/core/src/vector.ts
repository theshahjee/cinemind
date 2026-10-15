export function dot(a: readonly number[], b: readonly number[]): number {
  let s = 0;
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i++) s += a[i]! * b[i]!;
  return s;
}

export function norm(a: readonly number[]): number {
  return Math.sqrt(dot(a, a));
}

export function cosine(a: readonly number[], b: readonly number[]): number {
  const d = norm(a) * norm(b);
  return d === 0 ? 0 : dot(a, b) / d;
}

/** Accumulate `w * v` into `acc` in place, growing `acc` if needed. */
export function addScaled(acc: number[], v: readonly number[], w: number): number[] {
  for (let i = 0; i < v.length; i++) acc[i] = (acc[i] ?? 0) + w * v[i]!;
  return acc;
}
