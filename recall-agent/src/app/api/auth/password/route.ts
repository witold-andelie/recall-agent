import { NextResponse } from "next/server";
import { changePassword } from "@/lib/session/user";

export async function POST(req: Request) {
  try {
    const body = (await req.json().catch(() => ({}))) as {
      currentPassword?: string;
      newPassword?: string;
    };
    const currentPassword = body.currentPassword || "";
    const newPassword = body.newPassword || "";
    if (newPassword.length < 8 || newPassword.length > 128) {
      return NextResponse.json(
        { error: "password must be 8–128 characters" },
        { status: 400 },
      );
    }
    const result = await changePassword({ currentPassword, newPassword });
    if ("error" in result) {
      return NextResponse.json({ error: result.error }, { status: result.status });
    }
    return NextResponse.json({ ok: true });
  } catch (e) {
    const message = e instanceof Error ? e.message : "password change failed";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
