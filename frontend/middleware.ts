import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

/**
 * Coming-soon branch (never merged to main): the coming-soon page is
 * the site root, and every other path redirects to it. Production
 * deploys this branch until launch, when it switches to main.
 * The matcher leaves API routes, Next.js static assets, and the
 * favicon alone; the function lets the root itself through.
 */
export const config = {
  matcher: ["/((?!api|_next/static|_next/image|favicon.ico).*)"],
};

export function middleware(req: NextRequest) {
  if (req.nextUrl.pathname === "/") {
    return NextResponse.next();
  }
  return NextResponse.redirect(new URL("/", req.url));
}
