import { NextResponse } from "next/server";
import { logoutCurrentSession } from "@/lib/session/user";

export async function POST() {
  try {
    await logoutCurrentSession();
    return NextResponse.json({ ok: true });
  } catch (e) {
    const message = e instanceof Error ? e.message : "logout failed";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
