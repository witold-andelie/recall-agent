import { NextResponse } from "next/server";
import { getOrCreateUser } from "@/lib/session/user";

export async function POST() {
  try {
    const session = await getOrCreateUser();
    return NextResponse.json({ ok: true, ...session });
  } catch (e) {
    const message = e instanceof Error ? e.message : "auth failed";
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}

export async function GET() {
  return POST();
}
