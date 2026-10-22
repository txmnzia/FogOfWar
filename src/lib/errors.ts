// Turn anything thrown into readable text. Supabase errors (PostgrestError,
// AuthError) are plain objects, not Error instances, so String(e) would show
// "[object Object]" and hide the real cause.
export function errorMessage(e: unknown): string {
  if (e instanceof Error) return e.message;
  if (e && typeof e === "object") {
    const { message, code, details, hint } = e as Record<string, unknown>;
    const parts = [message, details, hint].filter((p) => typeof p === "string" && p);
    if (parts.length) return (code ? `${code}: ` : "") + parts.join(" ");
    try {
      return JSON.stringify(e);
    } catch {
      /* fall through */
    }
  }
  return String(e);
}
