import { randomBytes } from "crypto";

export function newRequestId(): string {
  return randomBytes(8).toString("hex");
}

export function logEvent(
  event: string,
  fields: Record<string, string | number | boolean | null | undefined>,
): void {
  const line = {
    ts: new Date().toISOString(),
    event,
    ...fields,
  };
  console.log(JSON.stringify(line));
}
