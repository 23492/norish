/**
 * Redact credentials from a URL string.
 *
 * Handles both standard `user:password@host` and password-only `:password@host`
 * patterns found in PostgreSQL and Redis connection strings.
 *
 * Examples:
 *   postgres://norish:secret@localhost/norish  →  postgres://norish:***@localhost/norish
 *   redis://:secret@localhost:6379/10          →  redis://:***@localhost:6379/10
 */
export function redactUrl(raw: string): string {
  try {
    const url = new URL(raw);

    if (url.password) {
      url.password = "***";
    }

    return url.toString();
  } catch {
    // If URL parsing fails, do a best-effort regex redaction so we never
    // accidentally log the raw value.
    return raw.replace(/(\/\/)([^@]+)@/, "$1***@");
  }
}
