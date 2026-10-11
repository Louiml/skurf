import { NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/db"
import { handleRoute, requireUser } from "@/lib/auth/session"
import { requireMembership } from "@/lib/validations"
import { isOnline } from "@/lib/redis"

export async function POST(req: NextRequest) {
  return handleRoute(async () => {
    const user = await requireUser(req)
    const { userIds } = await req.json().then((b) => ({ userIds: Array.isArray(b?.userIds) ? b.userIds.slice(0, 100) : [] }))
    const unique = [...new Set(userIds as string[])]
    const users = await prisma.user.findMany({
      where: { id: { in: unique } },
      select: { id: true, lastSeenAt: true, lastSeenVisibility: true },
    })
    const result = await Promise.all(
      users.map(async (u) => {
        let lastSeenAt: string | null = u.lastSeenAt?.toISOString() ?? null
        if (u.lastSeenVisibility === "NONE" && u.id !== user.id) lastSeenAt = null
        return { userId: u.id, online: u.id === user.id ? true : await isOnline(u.id), lastSeenAt }
      })
    )
    return NextResponse.json({ presence: result })
  })
}
