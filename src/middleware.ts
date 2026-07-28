import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

export async function middleware(request: NextRequest) {
  let supabaseResponse = NextResponse.next({ request });

  const supabase = createServerClient(
    process.env.SUPABASE_URL!,
    process.env.SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) =>
            request.cookies.set(name, value)
          );
          supabaseResponse = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) =>
            supabaseResponse.cookies.set(name, value, options)
          );
        },
      },
    }
  );

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user && request.nextUrl.pathname.startsWith("/dashboard")) {
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    return NextResponse.redirect(url);
  }

  return supabaseResponse;
}

export const config = {
  /*
   * Must run on essentially every request, not just /dashboard. Nothing else
   * refreshes the session: the dashboard's client components never instantiate
   * a Supabase browser client, so there is no autoRefreshToken timer running
   * while a tab sits open. If middleware only covers /dashboard/:path*, an
   * access token can expire with no navigation to renew it, leaving each
   * /api/* call to attempt its own refresh — and a rotated refresh token that
   * fails to persist logs the user out.
   *
   * Excluded:
   * - api/cron: authenticated by CRON_SECRET bearer token, never a cookie
   *   session, so an auth round-trip per tick is pure overhead
   * - static assets and images
   */
  matcher: [
    "/((?!api/cron|_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico|woff2?)$).*)",
  ],
};
