import { NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/db"
import { ApiError, handleRoute, requireUser } from "@/lib/auth/session"
import { mediaPath } from "@/lib/storage"
import { createReadStream } from "node:fs"
import { Readable } from "node:stream"

export async function GET(req: NextRequest, ctx: { params: { id: string } }) {
  return handleRoute(async () => {
    const user = await requireUser(req)
    const asset = await prisma.mediaAsset.findUnique({ where: { id: ctx.params.id } })
    if (!asset) throw new ApiError(404, "Not found")
    const stream = createReadStream(mediaPath(asset.storageKey))
    const web = Readable.toWeb(stream) as ReadableStream<Uint8Array>
    return new NextResponse(web, {
      headers: {
        "Content-Type": asset.mime,
        "Content-Length": String(asset.size),
        "Cache-Control": "private, max-age=31536000, immutable",
      },
    })
  })
}
