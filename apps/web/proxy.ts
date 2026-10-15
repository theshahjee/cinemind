import { NextResponse, type NextRequest } from "next/server";

/**
 * Optional HTTP basic auth for the whole UI. The API token never reaches the
 * browser (pages call the API server-side), so this is what keeps strangers out
 * when the app is reachable beyond localhost.
 */
export function proxy(req: NextRequest) {
  const password = process.env.CINEMIND_WEB_PASSWORD;
  if (!password) return NextResponse.next();
  const header = req.headers.get("authorization") ?? "";
  const [scheme, encoded] = header.split(" ");
  if (scheme === "Basic" && encoded) {
    const decoded = atob(encoded);
    if (constantTimeEqual(decoded.slice(decoded.indexOf(":") + 1), password)) return NextResponse.next();
  }
  return new NextResponse("Authentication required", {
    status: 401,
    headers: { "WWW-Authenticate": 'Basic realm="CineMind"' },
  });
}

export const config = { matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"] };

function constantTimeEqual(a: string, b: string): boolean {
  let diff = a.length ^ b.length;
  for (let i = 0; i < Math.max(a.length, b.length); i++) diff |= (a.charCodeAt(i) || 0) ^ (b.charCodeAt(i) || 0);
  return diff === 0;
}
