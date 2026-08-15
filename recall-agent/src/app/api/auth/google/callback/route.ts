import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { appOrigin, exchangeGoogleCode } from "@/lib/session/google";
import { loginWithGoogle } from "@/lib/session/user";

export async function GET(req: Request) {
  const url = new URL(req.url);
  const err = url.searchParams.get("error");
  const origin = appOrigin(req);
  if (err) {
    return NextResponse.redirect(`${origin}/?auth_error=${encodeURIComponent(err)}`);
  }
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const jar = await cookies();
  const expected = jar.get("oauth_state")?.value;
  jar.set("oauth_state", "", { path: "/", maxAge: 0 });
  if (!code || !state || !expected || state !== expected) {
    return NextResponse.redirect(`${origin}/?auth_error=invalid_state`);
  }
  try {
    const profile = await exchangeGoogleCode(req, code);
    const result = await loginWithGoogle(profile);
    if ("error" in result) {
      return NextResponse.redirect(
        `${origin}/?auth_error=${encodeURIComponent(result.error)}`,
      );
    }
    return NextResponse.redirect(`${origin}/`);
  } catch (e) {
    const message = e instanceof Error ? e.message : "google_failed";
    return NextResponse.redirect(
      `${origin}/?auth_error=${encodeURIComponent(message.slice(0, 120))}`,
    );
  }
}
