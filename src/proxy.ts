import { NextRequest, NextResponse } from "next/server";

const PUBLIC = ["/login", "/api/health"];

/**
 * Mirror of the flag in src/lib/auth.ts. Duplicated on purpose: this file runs
 * in the middleware runtime, which cannot import `next/headers` or the `pg`
 * pool that auth.ts pulls in.
 *
 * Development only — inert when NODE_ENV=production. See src/lib/auth.ts for
 * why it exists (browsers that refuse third-party cookies inside the preview
 * iframe can never persist a session).
 */
const DEMO_AUTOLOGIN =
  process.env.NODE_ENV !== "production" && (process.env.DEMO_AUTOLOGIN ?? "").trim().length > 0;

export function proxy(req: NextRequest) {
  const { pathname } = req.nextUrl;

  if (DEMO_AUTOLOGIN) {
    // Open the preview straight into the app instead of a PIN pad that cannot
    // remember you. Only for real browser navigations (Sec-Fetch-Mode: navigate
    // covers both top-level documents and iframe loads) — programmatic clients,
    // e.g. scripts/demo.mjs, still get the page so they can exercise real
    // PIN login.
    const isBrowserNavigation = req.headers.get("sec-fetch-mode") === "navigate";
    if (pathname === "/login" && isBrowserNavigation) {
      const url = req.nextUrl.clone();
      url.pathname = "/";
      url.search = "";
      return NextResponse.redirect(url);
    }
    return NextResponse.next();
  }

  if (PUBLIC.some((p) => pathname.startsWith(p))) {
    return NextResponse.next();
  }
  const session = req.cookies.get("ember_session")?.value;
  if (!session) {
    const url = req.nextUrl.clone();
    url.pathname = "/login";
    url.search = "";
    return NextResponse.redirect(url);
  }
  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
