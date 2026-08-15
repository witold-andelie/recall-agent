import { NextResponse } from "next/server";
import { parseUsernamePassword } from "@/lib/session/password";
import { loginUser } from "@/lib/session/user";

export async function POST(req: Request) {
  try {
    const body = (await req.json().catch(() => ({}))) as {
      username?: string;
      password?: string;
    };
    const parsed = parseUsernamePassword(body);
    if ("error" in parsed) {
      return NextResponse.json({ error: parsed.error }, { status: 400 });
    }
    const result = await loginUser(parsed);
    if ("error" in result) {
      return NextResponse.json({ error: result.error }, { status: result.status });
    }
    return NextResponse.json({ ok: true, ...result });
  } catch (e) {
    const message = e instanceof Error ? e.message : "login failed";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
