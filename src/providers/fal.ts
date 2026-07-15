import type { ProviderResult } from "../types";
import { ProviderError, collectUrls, sleep } from "./errors";

const QUEUE_BASE = "https://queue.fal.run";
const POLL_INTERVAL_MS = 2500;
const MAX_POLLS = 240; // ~10 min

interface FalSubmit {
  request_id: string;
  status_url?: string;
  response_url?: string;
}

/**
 * Submit a job to FAL's queue API, poll to completion, and return output URLs.
 * `model` is a FAL model id such as "fal-ai/kling-video/v1/standard/text-to-video".
 */
export async function falGenerate(args: {
  model: string;
  input: Record<string, unknown>;
  apiKey: string;
  signal?: AbortSignal;
}): Promise<ProviderResult> {
  const { model, input, apiKey, signal } = args;
  if (!apiKey) throw new ProviderError("FAL_KEY is not set");

  const headers = {
    Authorization: `Key ${apiKey}`,
    "Content-Type": "application/json",
  };

  const submitRes = await fetch(`${QUEUE_BASE}/${model}`, {
    method: "POST",
    headers,
    body: JSON.stringify(input),
    signal,
  });
  if (!submitRes.ok) {
    throw new ProviderError(
      `FAL submit failed (${submitRes.status})`,
      await safeText(submitRes)
    );
  }
  const submit = (await submitRes.json()) as FalSubmit;
  const statusUrl =
    submit.status_url ?? `${QUEUE_BASE}/${model}/requests/${submit.request_id}/status`;
  const responseUrl =
    submit.response_url ?? `${QUEUE_BASE}/${model}/requests/${submit.request_id}`;

  for (let i = 0; i < MAX_POLLS; i++) {
    await sleep(POLL_INTERVAL_MS);
    const statusRes = await fetch(statusUrl, { headers, signal });
    if (!statusRes.ok) continue;
    const status = (await statusRes.json()) as { status?: string };
    if (status.status === "COMPLETED") break;
    if (status.status === "FAILED" || status.status === "ERROR") {
      throw new ProviderError("FAL job failed", status);
    }
    if (i === MAX_POLLS - 1) throw new ProviderError("FAL job timed out");
  }

  const resultRes = await fetch(responseUrl, { headers, signal });
  if (!resultRes.ok) {
    throw new ProviderError(
      `FAL result fetch failed (${resultRes.status})`,
      await safeText(resultRes)
    );
  }
  const raw = await resultRes.json();
  const outputUrls = collectUrls(raw);
  if (outputUrls.length === 0) {
    throw new ProviderError("FAL returned no output URLs", raw);
  }
  return { outputUrls, raw };
}

async function safeText(res: Response): Promise<string> {
  try {
    return await res.text();
  } catch {
    return "";
  }
}
