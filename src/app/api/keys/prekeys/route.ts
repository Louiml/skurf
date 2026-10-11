import { NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/db"
import { handleRoute, requireUser } from "@/lib/auth/session"
import { preKeysUploadSchema } from "@/lib/validations"

export async function POST(req: NextRequest) {
  return handleRoute(async () => {
    const user = await requireUser(req)
    const deviceId = req.headers.get("x-device-id")
    if (!deviceId) return NextResponse.json({ error: "Missing device" }, { status: 400 })
    const device = await prisma.device.findFirst({ where: { id: deviceId, userId: user.id } })
    if (!device) return NextResponse.json({ error: "Unknown device" }, { status: 404 })
    const input = preKeysUploadSchema.parse(await req.json())
    if (input.oneTimePreKeys.length > 0) {
      await prisma.preKey.createMany({
        data: input.oneTimePreKeys.map((k) => ({
          userId: user.id,
          deviceId: device.id,
          keyId: k.keyId,
          publicKey: k.publicKey,
        })),
        skipDuplicates: true,
      })
    }
    return NextResponse.json({ ok: true })
  })
}
