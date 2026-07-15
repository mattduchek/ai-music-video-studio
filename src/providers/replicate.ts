import type { ProviderResult } from "../types";
import { ProviderError, collectUrls, sleep } from "./errors";

const API = "https://api.replicate.com/v1";
const POLL_INTERVAL_MS = 2500;
const MAX_POLLS = 240;

interface Prediction {
  status: "starting" | "processing" | "succeeded" | "failed" | "canceled";
  output?: unknown;
  error?: unknown;
  metrics?: { predict_time?: number };
  urls?: { get?: string };
}

/**
 * Run a Replicate model and return output URLs. `model` may be:
 *   - "owner/name"          -> official-model predictions endpoint
 *   - "owner/name:version"  -> versioned predictions endpoint
 */
export async function replicateGenerate(args: {
  model: string;
  input: Record<string, unknown>;
  apiKey: string;
  signal?: AbortSignal;
}): Promise<ProviderResult> {
  const { model, input, apiKey, signal } = args;
  if (!apiKey) throw new ProviderError("REPLICATE_API_TOKEN is not set");

  const headers = {
    Authorization: `Bearer ${apiKey}`,
    "Content-Type": "application/json",
    Prefer: "wait",
  };

  let url: string;
  let body: Record<string, unknown>;
  if (model.includes(":")) {
    const version = model.slice(model.indexOf(":") + 1);
    url = `${API}/predictions`;
    body = { version, input };
  } else {
    url = `${API}/models/${model}/predictions`;
    body = { input };
  }

  const createRes = await fetch(url, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
    signal,
  });
  if (!createRes.ok) {
    throw new ProviderError(
      `Replicate create failed (${createRes.status})`,
      await safeText(createRes)
    );
  }

  let pred = (await createRes.json()) as Prediction;
  let polls = 0;
  while (pred.status === "starting" || pred.status === "processing") {
    if (polls++ >= MAX_POLLS) throw new ProviderError("Replicate prediction timed out");
    await sleep(POLL_INTERVAL_MS);
    const getUrl = pred.urls?.get;
    if (!getUrl) break;
    const getRes = await fetch(getUrl, { headers, signal });
    if (!getRes.ok) continue;
    pred = (await getRes.json()) as Prediction;
  }

  if (pred.status !== "succeeded") {
    throw new ProviderError(`Replicate prediction ${pred.status}`, pred.error ?? pred);
  }

  const outputUrls = collectUrls(pred.output);
  if (outputUrls.length === 0) {
    throw new ProviderError("Replicate returned no output URLs", pred.output);
  }
  return { outputUrls, raw: pred, predictSeconds: pred.metrics?.predict_time };
}

async function safeText(res: Response): Promise<string> {
  try {
    return await res.text();
  } catch {
    return "";
  }
}
