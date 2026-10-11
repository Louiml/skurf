import { createWriteStream } from "node:fs"
import { mkdir, stat, unlink } from "node:fs/promises"
import path from "node:path"
import { Readable } from "node:stream"
import { pipeline } from "node:stream/promises"
import { randomBytes } from "node:crypto"
import { getEnv } from "./env"

const globalAny = globalThis as unknown as { __mediaDir?: string }

function mediaDir() {
  const dir = globalAny.__mediaDir ?? getEnv().MEDIA_DIR
  return path.resolve(dir)
}

export async function ensureMediaDir() {
  await mkdir(mediaDir(), { recursive: true })
}

export function safeExtension(mime: string, fallback: string) {
  const map: Record<string, string> = {
    "image/jpeg": ".jpg",
    "image/png": ".png",
    "image/webp": ".webp",
    "image/gif": ".gif",
    "video/webm": ".webm",
    "video/mp4": ".mp4",
    "audio/webm": ".webm",
    "audio/ogg": ".ogg",
    "audio/mpeg": ".mp3",
    "audio/wav": ".wav",
    "application/pdf": ".pdf",
  }
  return map[mime] ?? fallback
}

export async function saveStream(file: ReadableStream<Uint8Array> | Readable, mime: string) {
  await ensureMediaDir()
  const key = `${Date.now()}-${randomBytes(12).toString("hex")}${safeExtension(mime, ".bin")}`
  const filePath = path.join(mediaDir(), key)
  const nodeStream = file instanceof Readable ? file : Readable.fromWeb(file as any)
  await pipeline(nodeStream, createWriteStream(filePath))
  const s = await stat(filePath)
  return { storageKey: key, size: s.size }
}

export async function deleteMedia(storageKey: string) {
  try {
    await unlink(path.join(mediaDir(), storageKey))
  } catch {}
}

export function mediaPath(storageKey: string) {
  return path.join(mediaDir(), storageKey)
}
