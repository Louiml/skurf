import { NextRequest, NextResponse } from "next/server"
import { handleRoute, requireUser } from "@/lib/auth/session"
import { prisma } from "@/lib/db"

export async function GET(req: NextRequest) {
  return handleRoute(async () => {
    const user = await requireUser(req)
    const devices = await prisma.device.findMany({
      where: { userId: user.id, revokedAt: null },
      select: {
        id: true,
        name: true,
        platform: true,
        lastActiveAt: true,
        createdAt: true,
        identityKey: true,
      },
    })
    const folders = await prisma.folder.findMany({
      where: { userId: user.id },
      orderBy: { position: "asc" },
    })
    const savedChat = await prisma.chat.findFirst({
      where: { type: "SAVED", members: { some: { userId: user.id } } },
      select: { id: true },
    })
    return NextResponse.json({
      user: {
        id: user.id,
        username: user.username,
        displayName: user.displayName,
        bio: user.bio,
        identityKey: user.identityKey,
        lastSeenVisibility: user.lastSeenVisibility,
        readReceiptsEnabled: user.readReceiptsEnabled,
      },
      devices,
      folders,
      savedChatId: savedChat?.id ?? null,
    })
  })
}
