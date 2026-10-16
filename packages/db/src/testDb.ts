/**
 * Database URL for integration tests, from TEST_DATABASE_URL. Tests truncate
 * tables, so this refuses any database whose name doesn't contain "test".
 * That keeps a stray run from wiping a real CineMind database.
 */
export function testDatabaseUrl(env: NodeJS.ProcessEnv = process.env): string | undefined {
  const url = env.TEST_DATABASE_URL;
  if (!url) return undefined;
  const name = new URL(url).pathname.replace(/^\//, "");
  if (!name.includes("test")) {
    throw new Error(`TEST_DATABASE_URL points at "${name}". Integration tests truncate tables, so the database name must contain "test".`);
  }
  return url;
}
