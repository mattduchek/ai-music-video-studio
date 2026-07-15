import { execFile } from "node:child_process";
import { readFileSync, existsSync, mkdirSync } from "node:fs";
import { join, extname, basename } from "node:path";
import { promisify } from "node:util";
import type { PreviewImage } from "./types";

const execFileAsync = promisify(execFile);

const IMAGE_MEDIA_TYPES: Record<string, string> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".gif": "image/gif",
};

export function imageMediaType(path: string): string | undefined {
  return IMAGE_MEDIA_TYPES[extname(path).toLowerCase()];
}

/** Read an image file as a base64 preview part (skips non-images / missing). */
export function readImagePreview(path: string, maxBytes = 4_000_000): PreviewImage | null {
  const mediaType = imageMediaType(path);
  if (!mediaType || !existsSync(path)) return null;
  const buf = readFileSync(path);
  if (buf.length > maxBytes) return null;
  return { data: buf.toString("base64"), mediaType };
}

export interface MediaInfo {
  durationSec?: number;
  width?: number;
  height?: number;
  hasAudio: boolean;
  hasVideo: boolean;
}

/** Probe a media file for duration, resolution, and whether it has audio. */
export async function probeMedia(path: string): Promise<MediaInfo | undefined> {
  try {
    const { stdout } = await execFileAsync("ffprobe", [
      "-v", "error",
      "-show_entries", "format=duration:stream=codec_type,width,height",
      "-of", "json",
      path,
    ]);
    const data = JSON.parse(stdout) as {
      format?: { duration?: string };
      streams?: Array<{ codec_type?: string; width?: number; height?: number }>;
    };
    const streams = data.streams ?? [];
    const video = streams.find((s) => s.codec_type === "video");
    const duration = Number(data.format?.duration);
    return {
      durationSec: Number.isFinite(duration) ? duration : undefined,
      width: video?.width,
      height: video?.height,
      hasAudio: streams.some((s) => s.codec_type === "audio"),
      hasVideo: Boolean(video),
    };
  } catch {
    return undefined;
  }
}

export async function probeDurationSeconds(path: string): Promise<number | undefined> {
  try {
    const { stdout } = await execFileAsync("ffprobe", [
      "-v", "error",
      "-show_entries", "format=duration",
      "-of", "default=noprint_wrappers=1:nokey=1",
      path,
    ]);
    const d = Number(stdout.trim());
    return Number.isFinite(d) ? d : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Extract up to `count` evenly spaced frames (downscaled) from a video so the
 * multimodal model can actually see what it generated. Best-effort: returns
 * whatever frames succeed.
 */
export async function extractVideoFrames(
  videoPath: string,
  outDir: string,
  count = 3
): Promise<PreviewImage[]> {
  if (!existsSync(outDir)) mkdirSync(outDir, { recursive: true });
  const duration = (await probeDurationSeconds(videoPath)) ?? 0;
  const stamps =
    duration > 0
      ? Array.from({ length: count }, (_, i) => (duration * (i + 0.5)) / count)
      : [0];

  const previews: PreviewImage[] = [];
  for (let i = 0; i < stamps.length; i++) {
    const out = join(outDir, `${basename(videoPath)}.frame${i}.jpg`);
    try {
      await execFileAsync("ffmpeg", [
        "-y",
        "-ss", String(stamps[i]),
        "-i", videoPath,
        "-frames:v", "1",
        "-vf", "scale=512:-2",
        out,
      ]);
      const preview = readImagePreview(out);
      if (preview) previews.push(preview);
    } catch {
      // skip failed frame
    }
  }
  return previews;
}
