/** Raised when a generation-provider call fails (used to log wasted spend). */
export class ProviderError extends Error {
  constructor(
    message: string,
    public readonly detail?: unknown
  ) {
    super(message);
    this.name = "ProviderError";
  }
}

/** Recursively collect http(s) URLs from a provider response (output fields). */
export function collectUrls(value: unknown, acc: string[] = []): string[] {
  if (value == null) return acc;
  if (typeof value === "string") {
    if (/^https?:\/\//i.test(value)) acc.push(value);
    return acc;
  }
  if (Array.isArray(value)) {
    for (const v of value) collectUrls(v, acc);
    return acc;
  }
  if (typeof value === "object") {
    for (const v of Object.values(value as Record<string, unknown>)) collectUrls(v, acc);
  }
  return acc;
}

export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
