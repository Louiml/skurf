import { NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/db"
import { handleRoute, requireUser } from "@/lib/auth/session"

export async function GET(req: NextRequest, ctx: { params: { userId: string } }) {
  return handleRoute(async () => {
    await requireUser(req)
    const devices = await prisma.device.findMany({
      where: { userId: ctx.params.userId, revokedAt: null },
      select: {
        id: true,
        identityKey: true,
        signingKey: true,
        signedPreKeyId: true,
        signedPreKey: true,
        signedPreKeySig: true,
      },
    })
    const bundle = await Promise.all(
      devices.map(async (d) => {
        const opk = await prisma.preKey.findFirst({
          where: { deviceId: d.id, usedAt: null },
          orderBy: { keyId: "asc" },
        })
        if (opk) {
          await prisma.preKey.update({ where: { id: opk.id }, data: { usedAt: new Date() } })
        }
        return {
          deviceId: d.id,
          identityKey: d.identityKey,
          signingKey: d.signingKey,
          signedPreKeyId: d.signedPreKeyId,
          signedPreKey: d.signedPreKey,
          signedPreKeySig: d.signedPreKeySig,
          oneTimePreKeyId: opk?.keyId,
          oneTimePreKey: opk?.publicKey,
        }
      })
    )
    const user = await prisma.user.findUnique({
      where: { id: ctx.params.userId },
      select: { displayName: true, username: true },
    })
    return NextResponse.json({ devices: bundle, user })
  })
}
