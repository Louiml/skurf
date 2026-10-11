import { NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/db"
import { ApiError, handleRoute, requireUser } from "@/lib/auth/session"
import { getIO } from "@/lib/socket/io"
import { z } from "zod"

const controlSchema = z.object({
  toUserId: z.string(),
  toDeviceId: z.string(),
  payload: z.string().min(1).max(65536),
  type: z.enum(["MESSAGE", "CONTROL", "EPOCH"]),
  chatId: z.string().optional(),
})

export async function POST(req: NextRequest) {
  return handleRoute(async () => {
    const user = await requireUser(req)
    const input = controlSchema.parse(await req.json())
    const device = await prisma.device.findFirst({ where: { userId: user.id, id: req.headers.get("x-device-id") ?? "" } })
    if (!device) throw new ApiError(400, "Unknown device")
    const target = await prisma.device.findFirst({ where: { id: input.toDeviceId, userId: input.toUserId, revokedAt: null } })
    if (!target) throw new ApiError(404, "Target device not found")
    const env = await prisma.envelope.create({
      data: {
        type: input.type,
        chatId: input.chatId ?? null,
        fromUserId: user.id,
        fromDevice: device.id,
        toUserId: input.toUserId,
        toDeviceId: input.toDeviceId,
        payload: input.payload,
      },
    })
    getIO()?.to(`d:${input.toDeviceId}`).emit("envelope:new", {
      envelopeId: env.id,
      type: env.type,
      chatId: env.chatId ?? undefined,
      fromUserId: env.fromUserId,
      fromDevice: env.fromDevice,
      payload: env.payload,
    })
    return NextResponse.json({ ok: true, id: env.id })
  })
}
