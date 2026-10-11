"use client"

export interface UploadedAsset {
  id: string
  kind: string
  mime: string
  size: number
  width?: number | null
  height?: number | null
  durationMs?: number | null
  waveform?: string | null
}

async function canvasToBlob(canvas: HTMLCanvasElement, mime: string, quality: number): Promise<Blob> {
  return new Promise((resolve) => canvas.toBlob((b) => resolve(b!), mime, quality))
}

export async function compressImage(file: File, maxDim = 1920, quality = 0.85): Promise<{ file: File; width: number; height: number; preview: string }> {
  const bitmap = await createImageBitmap(file)
  let { width, height } = bitmap
  const scale = Math.min(1, maxDim / Math.max(width, height))
  width = Math.round(width * scale)
  height = Math.round(height * scale)
  const canvas = document.createElement("canvas")
  canvas.width = width
  canvas.height = height
  const ctx = canvas.getContext("2d")!
  ctx.drawImage(bitmap, 0, 0, width, height)
  const blob = await canvasToBlob(canvas, "image/webp", quality)
  const preview = await canvasToBlob(canvas, "image/webp", 0.3)
  const previewUrl = URL.createObjectURL(preview)
  const name = file.name.replace(/\.[^.]+$/, "") + ".webp"
  return { file: new File([blob], name, { type: "image/webp" }), width, height, preview: previewUrl }
}

export class VoiceRecorder {
  private recorder?: MediaRecorder
  private stream?: MediaStream
  private chunks: Blob[] = []
  private samples: number[] = []
  private analyser?: AnalyserNode
  private audioCtx?: AudioContext
  private raf?: number
  startedAt = 0

  async start() {
    this.stream = await navigator.mediaDevices.getUserMedia({ audio: true })
    const mime = MediaRecorder.isTypeSupported("audio/webm;codecs=opus") ? "audio/webm;codecs=opus" : "audio/webm"
    this.recorder = new MediaRecorder(this.stream, { mimeType: mime })
    this.chunks = []
    this.recorder.ondataavailable = (e) => e.data.size > 0 && this.chunks.push(e.data)
    this.startedAt = Date.now()
    this.audioCtx = new AudioContext()
    const source = this.audioCtx.createMediaStreamSource(this.stream)
    this.analyser = this.audioCtx.createAnalyser()
    this.analyser.fftSize = 256
    source.connect(this.analyser)
    const data = new Uint8Array(this.analyser.frequencyBinCount)
    const tick = () => {
      this.analyser!.getByteTimeDomainData(data)
      let sum = 0
      for (const v of data) sum += (v - 128) * (v - 128)
      const rms = Math.sqrt(sum / data.length) / 128
      this.samples.push(Math.min(1, rms * 3))
      this.raf = requestAnimationFrame(tick)
    }
    tick()
    this.recorder.start(200)
  }

  get amplitude(): number {
    return this.samples[this.samples.length - 1] ?? 0
  }

  async stop(): Promise<{ file: File; durationMs: number; waveform: number[] } | null> {
    cancelAnimationFrame(this.raf!)
    this.analyser?.disconnect()
    await this.audioCtx?.close()
    if (!this.recorder) return null
    const done = new Promise<void>((resolve) => {
      this.recorder!.onstop = () => resolve()
    })
    this.recorder.stop()
    await done
    this.stream?.getTracks().forEach((t) => t.stop())
    const blob = new Blob(this.chunks, { type: this.chunks[0]?.type ?? "audio/webm" })
    if (blob.size === 0) return null
    const downsampled = downsample(this.samples, 48)
    return {
      file: new File([blob], `voice-${Date.now()}.webm`, { type: blob.type }),
      durationMs: Date.now() - this.startedAt,
      waveform: downsampled,
    }
  }

  async cancel() {
    cancelAnimationFrame(this.raf!)
    this.analyser?.disconnect()
    await this.audioCtx?.close()
    this.recorder?.stop()
    this.stream?.getTracks().forEach((t) => t.stop())
    this.chunks = []
  }
}

function downsample(samples: number[], n: number): number[] {
  if (samples.length === 0) return []
  const out: number[] = []
  const bucket = Math.max(1, Math.floor(samples.length / n))
  for (let i = 0; i < n; i++) {
    const slice = samples.slice(i * bucket, (i + 1) * bucket)
    if (slice.length === 0) break
    out.push(Math.max(...slice))
  }
  return out
}

export async function uploadAsset(file: File, meta: Record<string, unknown>): Promise<UploadedAsset> {
  const form = new FormData()
  form.append("file", file)
  form.append("meta", JSON.stringify(meta))
  const res = await fetch("/api/media", { method: "POST", body: form, credentials: "include" })
  if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error ?? "Upload failed")
  const data = await res.json()
  return data.asset
}

export async function getCurrentPosition(): Promise<GeolocationPosition> {
  return new Promise((resolve, reject) => {
    navigator.geolocation.getCurrentPosition(resolve, reject, { enableHighAccuracy: true, timeout: 10000 })
  })
}
