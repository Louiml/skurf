import { NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/db"
import { handleRoute, requireUser } from "@/lib/auth/session"

export async function GET(req: NextRequest) {
  return handleRoute(async () => {
    const user = await requireUser(req)
    const deviceId = req.headers.get("x-device-id")
    if (!deviceId) return NextResponse.json({ envelopes: [] })
    const envelopes = await prisma.envelope.findMany({
      where: { toUserId: user.id, toDeviceId: deviceId, consumedAt: null },
      orderBy: { createdAt: "asc" },
      take: 500,
    })
    return NextResponse.json({
      envelopes: envelopes.map((e) => ({
        id: e.id,
        messageId: e.messageId,
        type: e.type,
        chatId: e.chatId,
        fromUserId: e.fromUserId,
        fromDevice: e.fromDevice,
        payload: e.payload,
      })),
    })
  })
}
