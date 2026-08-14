export function sessionSecret(): string {
  const s = process.env.SESSION_SECRET;
  if (process.env.NODE_ENV === "production") {
    if (!s || s === "dev" || s === "change-me-in-production") {
      throw new Error("SESSION_SECRET must be set to a long random value in production");
    }
  }
  return s || "dev";
}
