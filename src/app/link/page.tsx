"use client"

import { useEffect, useRef, useState } from "react"
import { useRouter } from "next/navigation"
import { Button, Card, Input, Spinner, cn } from "@/components/ui"
import { PUT } from "@/lib/client/api"
import jsQR from "jsqr"

export default function LinkPage() {
  const router = useRouter()
  const [manual, setManual] = useState("")
  const [status, setStatus] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const videoRef = useRef<HTMLVideoElement>(null)

  useEffect(() => {
    const token = window.location.hash.slice(1)
    if (token) setManual(token)
  }, [])

  useEffect(() => {
    let stream: MediaStream | null = null
    let raf = 0
    let canvas: HTMLCanvasElement
    let ctx: CanvasRenderingContext2D
    let cancelled = false

    async function start() {
      try {
        stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment" } })
        if (videoRef.current) {
          videoRef.current.srcObject = stream
          await videoRef.current.play()
          canvas = document.createElement("canvas")
          canvas.width = videoRef.current.videoWidth
          canvas.height = videoRef.current.videoHeight
          ctx = canvas.getContext("2d")!
          const tick = () => {
            if (cancelled) return
            if (videoRef.current && canvas.width > 0) {
              ctx.drawImage(videoRef.current, 0, 0)
              const img = ctx.getImageData(0, 0, canvas.width, canvas.height)
              const code = jsQR(img.data, canvas.width, canvas.height)
              if (code?.data) {
                const url = code.data
                const token = url.includes("#") ? url.split("#")[1] : url
                if (token.length > 16) {
                  cancelled = true
                  setManual(token)
                  stream?.getTracks().forEach((t) => t.stop())
                }
              }
            }
            raf = requestAnimationFrame(tick)
          }
          tick()
        }
      } catch {
        // camera unavailable; manual entry
      }
    }
    if (!manual) void start()
    return () => {
      cancelled = true
      cancelAnimationFrame(raf)
      stream?.getTracks().forEach((t) => t.stop())
    }
  }, [manual])

  async function link() {
    setBusy(true)
    setError(null)
    try {
      setStatus("Generating this device's encryption keys…")
      const nacl = (await import("tweetnacl")).default
      const { toB64 } = await import("@/lib/crypto/protocol")
      const { db } = await import("@/lib/client/dexie")
      const { setDeviceId } = await import("@/lib/client/api")
      const identity = nacl.box.keyPair()
      const signing = nacl.sign.keyPair()
      const spk = nacl.box.keyPair()
      const spkSig = nacl.sign.detached(spk.publicKey, signing.secretKey)
      const oneTime: Array<{ keyId: number; publicKey: string }> = []
      const nextOpkId = 1
      for (let i = 0; i < 60; i++) {
        const opk = nacl.box.keyPair()
        oneTime.push({ keyId: nextOpkId + i, publicKey: toB64(opk.publicKey) })
        await db.opkSecrets.put({ keyId: nextOpkId + i, secret: toB64(opk.secretKey) })
      }
      setStatus("Linking with your account…")
      const res = await PUT<{ deviceId: string; userId: string }>("/api/devices/link", {
        token: manual,
        device: {
          name: `${navigator.platform || "Web"} browser (linked)`,
          platform: "web",
          identityKey: toB64(identity.publicKey),
          signingKey: toB64(signing.publicKey),
          registrationId: Math.floor(Math.random() * 16384),
          signedPreKeyId: nextOpkId,
          signedPreKey: toB64(spk.publicKey),
          signedPreKeySig: toB64(spkSig),
          oneTimePreKeys: oneTime,
        },
      })
      await db.deviceKeys.put({
        deviceId: res.deviceId,
        identitySecret: toB64(identity.secretKey),
        signingSecret: toB64(signing.secretKey),
        spkSecret: toB64(spk.secretKey),
        spkId: nextOpkId,
        nextOpkId: nextOpkId + 60,
      })
      await db.meta.put({ key: "userId", value: res.userId })
      localStorage.setItem("skurf:userId", res.userId)
      setDeviceId(res.deviceId)
      setStatus("Linked! Redirecting…")
      setTimeout(() => router.push("/app"), 600)
    } catch (err) {
      setError((err as Error).message)
      setStatus(null)
    } finally {
      setBusy(false)
    }
  }

  const canLink = manual.length > 16

  return (
    <main className="flex min-h-screen items-center justify-center bg-canvas-soft p-6">
      <Card className="w-full max-w-sm bg-canvas-soft">
        <h1 className="display-hero text-3xl">Link a device</h1>
        <p className="mt-2 text-sm text-body">
          Scan the QR shown by an already-logged-in device (Settings → Link a device), or paste the code below. This
          device gets its <strong>own independent encryption keys</strong> — new messages arrive here, old ones stay on
          the original device.
        </p>
        <div className="mt-4 overflow-hidden rounded-lg bg-ink">
          <video ref={videoRef} className={cn("h-56 w-full object-cover", canLink && "hidden")} muted playsInline />
          {!canLink && (
            <div className="flex h-56 items-center justify-center text-sm text-canvas-soft">
              <Spinner className="mr-2 border-canvas-soft/30 border-t-canvas-soft" /> Point camera at the QR code
            </div>
          )}
        </div>
        <div className="mt-3 space-y-2">
          <Input placeholder="or paste link code here" value={manual} onChange={(e) => setManual(e.target.value)} />
          {status && <p className="text-sm text-positive-deep">{status}</p>}
          {error && <p className="text-sm text-negative">{error}</p>}
          <Button className="w-full" onClick={link} disabled={!canLink || busy}>
            {busy ? "Linking…" : "Link this device"}
          </Button>
        </div>
      </Card>
    </main>
  )
}
