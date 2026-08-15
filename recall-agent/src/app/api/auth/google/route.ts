import { NextResponse } from "next/server";
import { randomBytes } from "crypto";
import { cookies } from "next/headers";
import { googleAuthorizeUrl, googleConfigured } from "@/lib/session/google";

export async function GET(req: Request) {
  if (!googleConfigured()) {
    return NextResponse.json(
      { error: "Google sign-in is not configured (GOOGLE_CLIENT_ID / SECRET)" },
      { status: 503 },
    );
  }
  const state = randomBytes(16).toString("hex");
  const jar = await cookies();
  jar.set("oauth_state", state, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 600,
  });
  return NextResponse.redirect(googleAuthorizeUrl(req, state));
}
