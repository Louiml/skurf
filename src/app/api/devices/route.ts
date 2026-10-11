import { NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/db"
import { ApiError, handleRoute, requireUser } from "@/lib/auth/session"
import { getIO } from "@/lib/socket/io"

export async function GET(req: NextRequest) {
  return handleRoute(async () => {
    const user = await requireUser(req)
    const devices = await prisma.device.findMany({
      where: { userId: user.id, revokedAt: null },
      select: { id: true, name: true, platform: true, lastActiveAt: true, createdAt: true },
      orderBy: { createdAt: "asc" },
    })
    const credentials = await prisma.webAuthnCredential.count({ where: { userId: user.id } })
    return NextResponse.json({ devices, passkeyCount: credentials })
  })
}

export async function DELETE(req: NextRequest) {
  return handleRoute(async () => {
    const user = await requireUser(req)
    const id = new URL(req.url).searchParams.get("id")
    if (!id) throw new ApiError(400, "Missing id")
    const device = await prisma.device.findFirst({ where: { id, userId: user.id } })
    if (!device) throw new ApiError(404, "Device not found")
    const count = await prisma.device.count({ where: { userId: user.id, revokedAt: null } })
    if (count <= 1) throw new ApiError(400, "Cannot revoke last device")
    await prisma.device.update({ where: { id }, data: { revokedAt: new Date() } })
    getIO()?.in(`d:${id}`).disconnectSockets(true)
    return NextResponse.json({ ok: true })
  })
}
