import { NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/db"
import { ApiError, handleRoute, requireUser } from "@/lib/auth/session"
import { getIO } from "@/lib/socket/io"

export async function GET(req: NextRequest) {
  return handleRoute(async () => {
    const user = await requireUser(req)
    const q = new URL(req.url).searchParams.get("q")?.toLowerCase() ?? ""
    if (q.length < 2) return NextResponse.json({ results: [] })
    const users = await prisma.user.findMany({
      where: {
        OR: [{ username: { contains: q } }, { displayName: { contains: q, mode: "insensitive" } }],
      },
      take: 20,
      select: { id: true, username: true, displayName: true, identityKey: true, bio: true },
    })
    const channels = await prisma.chat.findMany({
      where: { type: "CHANNEL", isPublic: true, OR: [{ title: { contains: q, mode: "insensitive" } }, { handle: { contains: q } }] },
      take: 20,
      include: { _count: { select: { members: true } } },
    })
    return NextResponse.json({
      users: users.filter((u) => u.id !== user.id),
      channels: channels.map((c) => ({ id: c.id, title: c.title, handle: c.handle, description: c.description, subscribers: c._count.members })),
    })
  })
}

export async function POST(req: NextRequest) {
  return handleRoute(async () => {
    const user = await requireUser(req)
    const { chatId } = await req.json().then((b) => ({ chatId: typeof b?.chatId === "string" ? b.chatId : "" }))
    const chat = await prisma.chat.findUnique({ where: { id: chatId } })
    if (!chat || chat.type !== "CHANNEL") throw new ApiError(404, "Channel not found")
    const existing = await prisma.chatMember.findUnique({ where: { chatId_userId: { chatId, userId: user.id } } })
    if (!existing) {
      await prisma.chatMember.create({ data: { chatId, userId: user.id, role: "SUBSCRIBER" } })
      getIO()?.in(`u:${user.id}`).socketsJoin(`c:${chatId}`)
      getIO()?.to(`u:${user.id}`).emit("chat:new", { chatId })
    }
    return NextResponse.json({ ok: true })
  })
}
