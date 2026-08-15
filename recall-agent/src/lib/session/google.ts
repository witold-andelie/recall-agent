const AUTH = "https://accounts.google.com/o/oauth2/v2/auth";
const TOKEN = "https://oauth2.googleapis.com/token";
const USERINFO = "https://www.googleapis.com/oauth2/v3/userinfo";

export function googleConfigured(): boolean {
  return Boolean(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET);
}

export function appOrigin(req: Request): string {
  const fromEnv = process.env.APP_URL?.replace(/\/$/, "");
  if (fromEnv) return fromEnv;
  const host = req.headers.get("x-forwarded-host") || req.headers.get("host");
  const proto = req.headers.get("x-forwarded-proto") || "http";
  if (host) return `${proto}://${host}`;
  return new URL(req.url).origin;
}

export function googleRedirectUri(req: Request): string {
  return `${appOrigin(req)}/api/auth/google/callback`;
}

export function googleAuthorizeUrl(req: Request, state: string): string {
  const id = process.env.GOOGLE_CLIENT_ID;
  if (!id) throw new Error("GOOGLE_CLIENT_ID is not set");
  const params = new URLSearchParams({
    client_id: id,
    redirect_uri: googleRedirectUri(req),
    response_type: "code",
    scope: "openid email profile",
    state,
    prompt: "select_account",
  });
  return `${AUTH}?${params.toString()}`;
}

export async function exchangeGoogleCode(
  req: Request,
  code: string,
): Promise<{ sub: string; email?: string; name?: string }> {
  const id = process.env.GOOGLE_CLIENT_ID;
  const secret = process.env.GOOGLE_CLIENT_SECRET;
  if (!id || !secret) throw new Error("Google OAuth is not configured");

  const tokenRes = await fetch(TOKEN, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code,
      client_id: id,
      client_secret: secret,
      redirect_uri: googleRedirectUri(req),
      grant_type: "authorization_code",
    }),
  });
  if (!tokenRes.ok) {
    const body = await tokenRes.text();
    throw new Error(`Google token exchange failed: ${tokenRes.status} ${body}`);
  }
  const tokens = (await tokenRes.json()) as { access_token?: string };
  if (!tokens.access_token) throw new Error("Google token response missing access_token");

  const meRes = await fetch(USERINFO, {
    headers: { Authorization: `Bearer ${tokens.access_token}` },
  });
  if (!meRes.ok) {
    const body = await meRes.text();
    throw new Error(`Google userinfo failed: ${meRes.status} ${body}`);
  }
  const me = (await meRes.json()) as {
    sub?: string;
    email?: string;
    name?: string;
  };
  if (!me.sub) throw new Error("Google userinfo missing sub");
  return { sub: me.sub, email: me.email, name: me.name };
}
