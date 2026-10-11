import { NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/db"
import { ApiError, handleRoute, requireUser } from "@/lib/auth/session"
import { mediaMetaSchema } from "@/lib/validations"
import { saveStream, deleteMedia } from "@/lib/storage"

export async function POST(req: NextRequest) {
  return handleRoute(async () => {
    const user = await requireUser(req)
    const form = await req.formData()
    const file = form.get("file")
    const metaRaw = form.get("meta")
    if (!(file instanceof File)) throw new ApiError(400, "Missing file")
    if (file.size > 100 * 1024 * 1024) throw new ApiError(413, "File too large (max 100MB)")
    const meta = mediaMetaSchema.parse(JSON.parse(String(metaRaw ?? "{}")))
    const { storageKey, size } = await saveStream(file.stream(), file.type || meta.mime || "application/octet-stream")
    const asset = await prisma.mediaAsset.create({
      data: {
        ownerId: user.id,
        kind: meta.kind,
        mime: file.type || meta.mime || "application/octet-stream",
        size,
        width: meta.width,
        height: meta.height,
        durationMs: meta.durationMs,
        waveform: meta.waveform,
        storageKey,
      },
    })
    return NextResponse.json({
      asset: { id: asset.id, kind: asset.kind, mime: asset.mime, size: asset.size, width: asset.width, height: asset.height, durationMs: asset.durationMs, waveform: asset.waveform },
    })
  })
}

export async function DELETE(req: NextRequest) {
  return handleRoute(async () => {
    const user = await requireUser(req)
    const id = new URL(req.url).searchParams.get("id")
    if (!id) throw new ApiError(400, "Missing id")
    const asset = await prisma.mediaAsset.findFirst({ where: { id, ownerId: user.id } })
    if (!asset) throw new ApiError(404, "Not found")
    await deleteMedia(asset.storageKey)
    await prisma.mediaAsset.delete({ where: { id } })
    return NextResponse.json({ ok: true })
  })
}
