import { chatGateSnapshot } from "@/lib/limit";
import { instanceId } from "@/lib/env";

export const runtime = "nodejs";

/** Process liveness. Do not touch Cockroach here — Render uses this path. */
export async function GET() {
  return Response.json({
    ok: true,
    instance: instanceId(),
    chat: chatGateSnapshot(),
  });
}
