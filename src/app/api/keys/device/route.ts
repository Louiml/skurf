import { NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/db"
import { handleRoute, requireUser } from "@/lib/auth/session"
import { deviceRegistrationSchema } from "@/lib/validations"

export async function POST(req: NextRequest) {
  return handleRoute(async () => {
    const user = await requireUser(req)
    const input = deviceRegistrationSchema.parse(await req.json())
    const device = await prisma.device.create({
      data: {
        userId: user.id,
        name: input.name,
        platform: input.platform,
        registrationId: input.registrationId,
        identityKey: input.identityKey,
        signingKey: input.signingKey,
        signedPreKeyId: input.signedPreKeyId,
        signedPreKey: input.signedPreKey,
        signedPreKeySig: input.signedPreKeySig,
      },
    })
    if (input.oneTimePreKeys.length > 0) {
      await prisma.preKey.createMany({
        data: input.oneTimePreKeys.map((k) => ({
          userId: user.id,
          deviceId: device.id,
          keyId: k.keyId,
          publicKey: k.publicKey,
        })),
      })
    }
    if (user.identityKey !== input.identityKey) {
      await prisma.user.update({ where: { id: user.id }, data: { identityKey: input.identityKey, signingKey: input.signingKey } })
    }
    return NextResponse.json({ deviceId: device.id })
  })
}
