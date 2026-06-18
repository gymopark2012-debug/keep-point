import { NextResponse } from "next/server";

export function middleware(request) {
  const { pathname } = request.nextUrl;

  if (pathname === "/" || pathname === "") {
    const url = request.nextUrl.clone();
    url.pathname = "/index.html";
    return NextResponse.rewrite(url);
  }

  const readerMatch = pathname.match(/^\/reader\/([^/]+)\/?$/);
  if (readerMatch) {
    const url = request.nextUrl.clone();
    url.pathname = "/reader.html";
    url.searchParams.set("id", decodeURIComponent(readerMatch[1]));
    const mode = request.nextUrl.searchParams.get("mode");
    if (mode) url.searchParams.set("mode", mode);
    return NextResponse.rewrite(url);
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/", "/reader/:path*"]
};
