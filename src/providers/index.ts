import { writeFileSync } from "node:fs";
import { extname } from "node:path";
import type { GenProvider, ProviderResult } from "../types";
import { falGenerate } from "./fal";
import { replicateGenerate } from "./replicate";
import { ProviderError } from "./errors";

export { ProviderError } from "./errors";

export async function generateMedia(args: {
  provider: GenProvider;
  model: string;
  input: Record<string, unknown>;
  keys: { fal: string; replicate: string };
  signal?: AbortSignal;
}): Promise<ProviderResult> {
  const { provider, model, input, keys, signal } = args;
  if (provider === "fal") {
    return falGenerate({ model, input, apiKey: keys.fal, signal });
  }
  if (provider === "replicate") {
    return replicateGenerate({ model, input, apiKey: keys.replicate, signal });
  }
  throw new ProviderError(`Unknown provider "${provider}" (use "fal" or "replicate")`);
}

/** Download a URL to disk, returning the absolute path written. */
export async function downloadToFile(
  url: string,
  destPathNoExt: string,
  signal?: AbortSignal
): Promise<string> {
  const res = await fetch(url, { signal });
  if (!res.ok) throw new ProviderError(`Download failed (${res.status}) for ${url}`);
  const ext = guessExtension(url, res.headers.get("content-type"));
  const dest = destPathNoExt + ext;
  const buf = Buffer.from(await res.arrayBuffer());
  writeFileSync(dest, buf);
  return dest;
}

function guessExtension(url: string, contentType: string | null): string {
  const urlExt = extname(new URL(url).pathname);
  if (urlExt) return urlExt;
  if (contentType?.includes("mp4")) return ".mp4";
  if (contentType?.includes("webm")) return ".webm";
  if (contentType?.includes("png")) return ".png";
  if (contentType?.includes("jpeg")) return ".jpg";
  if (contentType?.includes("gif")) return ".gif";
  if (contentType?.includes("webp")) return ".webp";
  return ".bin";
}
