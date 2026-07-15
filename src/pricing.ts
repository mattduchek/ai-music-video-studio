import type { GenProvider } from "./types";

/**
 * Best-effort cost estimation for FAL / Replicate generations.
 *
 * Prices verified against fal.ai/pricing, individual fal model pages, and
 * replicate.com pricing on 2026-07-13. They WILL drift, check the provider's
 * model page for authoritative rates. The billing unit differs per model:
 * per second of output video, per whole video, per 1M video "tokens"
 * (h*w*fps*dur/1024), per megapixel of video, per image, or per image megapixel.
 *
 * We read the request `input` (resolution/duration/fps) so token- and
 * second-priced models are estimated correctly rather than assuming a flat rate.
 * We never reconcile against provider compute time: GPU seconds are NOT video
 * seconds, so that would be meaningless.
 */

type VideoUnit = "second" | "video" | "mtoken" | "mpixel";
interface VideoRule {
  match: RegExp;
  unit: VideoUnit;
  price: number;
  note?: string;
}

// Order matters: more specific patterns first.
const VIDEO_RULES: VideoRule[] = [
  // Google Veo
  { match: /veo-?3\.?1.*(fast|lite)/i, unit: "second", price: 0.1 },
  { match: /veo-?3\.?1/i, unit: "second", price: 0.2 },
  { match: /veo-?3/i, unit: "second", price: 0.4 },
  // OpenAI Sora
  { match: /sora-?2.*pro/i, unit: "second", price: 0.5 },
  { match: /sora-?2/i, unit: "second", price: 0.3 },
  // Kling
  { match: /kling.*v?3/i, unit: "second", price: 0.112 },
  { match: /kling.*2\.5.*turbo/i, unit: "second", price: 0.07 },
  { match: /kling.*2\.1.*(standard|std)/i, unit: "second", price: 0.05 },
  { match: /kling/i, unit: "second", price: 0.07 },
  // Wan
  { match: /wan.*pro/i, unit: "video", price: 0.16 },
  { match: /wan.*2\.5/i, unit: "second", price: 0.05 },
  { match: /wan.*2\.2/i, unit: "second", price: 0.1 },
  { match: /wan/i, unit: "second", price: 0.09 },
  // ByteDance Seedance (token-priced: $/1M video tokens)
  { match: /seedance.*pro/i, unit: "mtoken", price: 2.5 },
  { match: /seedance/i, unit: "mtoken", price: 1.8 },
  // MiniMax / Hailuo
  { match: /hailuo.*pro/i, unit: "video", price: 0.49 },
  { match: /hailuo|minimax/i, unit: "second", price: 0.045 },
  // Lightricks LTX (per megapixel of generated video)
  { match: /ltx/i, unit: "mpixel", price: 0.0018 },
  // PixVerse (tiered by resolution/audio; mid estimate)
  { match: /pixverse/i, unit: "second", price: 0.09 },
  // xAI Grok Imagine
  { match: /grok/i, unit: "second", price: 0.05 },
  // Ovi
  { match: /ovi/i, unit: "video", price: 0.2 },
];

type ImageUnit = "image" | "mpixel";
interface ImageRule {
  match: RegExp;
  unit: ImageUnit;
  price: number;
}

const IMAGE_RULES: ImageRule[] = [
  { match: /flux.*schnell/i, unit: "image", price: 0.003 },
  { match: /flux.*(1\.1|kontext|pro)/i, unit: "image", price: 0.04 },
  { match: /flux.*dev/i, unit: "image", price: 0.025 },
  { match: /flux/i, unit: "image", price: 0.025 },
  { match: /seedream/i, unit: "image", price: 0.03 },
  { match: /nano-?banana/i, unit: "image", price: 0.04 },
  { match: /imagen/i, unit: "image", price: 0.04 },
  { match: /ideogram.*turbo/i, unit: "image", price: 0.03 },
  { match: /ideogram/i, unit: "image", price: 0.09 },
  { match: /recraft/i, unit: "image", price: 0.04 },
  { match: /qwen/i, unit: "mpixel", price: 0.02 },
  { match: /sdxl|stable-?diffusion|sd3/i, unit: "image", price: 0.01 },
];

// Conservative fallbacks for models we do not recognize.
const FALLBACK_VIDEO_PER_SECOND = 0.15;
const FALLBACK_IMAGE = 0.04;
const DEFAULT_SECONDS = 5;
const DEFAULT_FPS = 24;

function toNumber(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const n = parseFloat(value);
    if (Number.isFinite(n)) return n;
  }
  return undefined;
}

/** Infer output width/height/fps/duration from a request input object. */
function dimsFrom(
  input: Record<string, unknown>,
  estimatedSeconds?: number
): { w: number; h: number; fps: number; dur: number } {
  const res = String(input.resolution ?? input.resolution_profile ?? input.size ?? "").toLowerCase();
  let w = 1280;
  let h = 720;
  if (res.includes("2160") || res.includes("4k")) {
    w = 3840;
    h = 2160;
  } else if (res.includes("1440")) {
    w = 2560;
    h = 1440;
  } else if (res.includes("1080")) {
    w = 1920;
    h = 1080;
  } else if (res.includes("480")) {
    w = 854;
    h = 480;
  } else if (res.includes("360")) {
    w = 640;
    h = 360;
  } else if (res.includes("720")) {
    w = 1280;
    h = 720;
  } else {
    const iw = toNumber(input.width);
    const ih = toNumber(input.height);
    if (iw && ih) {
      w = iw;
      h = ih;
    }
  }
  const fps = toNumber(input.fps) ?? DEFAULT_FPS;
  const dur = toNumber(input.duration) ?? estimatedSeconds ?? DEFAULT_SECONDS;
  return { w, h, fps, dur };
}

export function estimateCost(args: {
  kind: "video" | "image";
  provider: GenProvider;
  model: string;
  input?: Record<string, unknown>;
  estimatedSeconds?: number;
}): number {
  const input = args.input ?? {};
  if (args.kind === "video") {
    const rule = VIDEO_RULES.find((r) => r.match.test(args.model));
    const { w, h, fps, dur } = dimsFrom(input, args.estimatedSeconds);
    if (!rule) return round(FALLBACK_VIDEO_PER_SECOND * dur);
    switch (rule.unit) {
      case "second":
        return round(rule.price * dur);
      case "video":
        return round(rule.price);
      case "mtoken":
        return round(((w * h * fps * dur) / 1024 / 1e6) * rule.price);
      case "mpixel":
        return round(((w * h * fps * dur) / 1e6) * rule.price);
    }
  }
  const rule = IMAGE_RULES.find((r) => r.match.test(args.model));
  if (!rule) return round(FALLBACK_IMAGE);
  if (rule.unit === "mpixel") {
    const iw = toNumber(input.width) ?? 1024;
    const ih = toNumber(input.height) ?? 1024;
    return round(((iw * ih) / 1e6) * rule.price);
  }
  return round(rule.price);
}

function round(n: number): number {
  return Math.round(n * 1e6) / 1e6;
}
