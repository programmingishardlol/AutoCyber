import { NextResponse, type NextRequest } from "next/server";

const protectedPrefixes = [
  "/",
  "/projects",
  "/repositories",
  "/scanner",
  "/scans",
  "/findings",
  "/fix-proposals",
  "/verification",
  "/pull-requests",
  "/integrations",
  "/memory",
  "/workflows",
  "/settings"
];

export function middleware(request: NextRequest) {
  if (!isClerkConfigured()) return NextResponse.next();
  if (!isProtectedPath(request.nextUrl.pathname)) return NextResponse.next();
  if (request.cookies.has("__session")) return NextResponse.next();

  const loginUrl = new URL("/login", request.url);
  loginUrl.searchParams.set("redirect_url", request.nextUrl.pathname);
  return NextResponse.redirect(loginUrl);
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|api/health).*)"]
};

function isProtectedPath(pathname: string): boolean {
  return protectedPrefixes.some((prefix) => pathname === prefix || (prefix !== "/" && pathname.startsWith(`${prefix}/`)));
}

function isClerkConfigured(): boolean {
  return Boolean(process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY && process.env.CLERK_SECRET_KEY);
}
