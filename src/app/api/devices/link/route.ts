import { NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/db"
import { ApiError, handleRoute, requireUser } from "@/lib/auth/session"
import { createSession, hashToken, setSessionCookie } from "@/lib/auth/session"
import { deviceLinkSchema } from "@/lib/validations"
import { randomBytes } from "node:crypto"
import { getIO } from "@/lib/socket/io"
import { getEnv } from "@/lib/env"

export async function POST(req: NextRequest) {
  return handleRoute(async () => {
    const user = await requireUser(req)
    const raw = randomBytes(24).toString("base64url")
    const token = await prisma.linkToken.create({
      data: {
        userId: user.id,
        codeHash: hashToken(raw),
        expiresAt: new Date(Date.now() + 5 * 60 * 1000),
      },
    })
    const env = getEnv()
    return NextResponse.json({
      token: `${token.id}.${raw}`,
      url: `${env.NEXT_PUBLIC_APP_URL}/link#${token.id}.${raw}`,
      expiresAt: token.expiresAt.toISOString(),
    })
  })
}

export async function PUT(req: NextRequest) {
  return handleRoute(async () => {
    const input = deviceLinkSchema.parse(await req.json())
    const [id, raw] = input.token.split(".")
    if (!id || !raw) throw new ApiError(400, "Invalid token")
    const token = await prisma.linkToken.findUnique({ where: { id } })
    if (!token || token.consumedAt || token.expiresAt < new Date() || token.codeHash !== hashToken(raw)) {
      throw new ApiError(400, "Link token invalid or expired")
    }
    const device = await prisma.device.create({
      data: {
        userId: token.userId,
        name: input.device.name,
        platform: input.device.platform,
        registrationId: input.device.registrationId,
        identityKey: input.device.identityKey,
        signingKey: input.device.signingKey,
        signedPreKeyId: input.device.signedPreKeyId,
        signedPreKey: input.device.signedPreKey,
        signedPreKeySig: input.device.signedPreKeySig,
      },
    })
    if (input.device.oneTimePreKeys.length > 0) {
      await prisma.preKey.createMany({
        data: input.device.oneTimePreKeys.map((k) => ({
          userId: token.userId,
          deviceId: device.id,
          keyId: k.keyId,
          publicKey: k.publicKey,
        })),
      })
    }
    await prisma.linkToken.update({ where: { id }, data: { consumedAt: new Date() } })
    const { token: sessionToken } = await createSession(token.userId, input.device.name)
    await setSessionCookie(sessionToken)
    getIO()?.to(`u:${token.userId}`).emit("device:linked", { deviceId: device.id, name: input.device.name })
    return NextResponse.json({ deviceId: device.id, userId: token.userId })
  })
}
