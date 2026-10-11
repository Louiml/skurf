import { NextRequest, NextResponse } from "next/server"
import { prisma, } from "@/lib/db"
import { ApiError, handleRoute, requireUser } from "@/lib/auth/session"
import { requireMembership, updateChatSchema } from "@/lib/validations"
import { getIO } from "@/lib/socket/io"

export async function GET(req: NextRequest, ctx: { params: { chatId: string } }) {
  return handleRoute(async () => {
    const user = await requireUser(req)
    const member = await requireMembership(ctx.params.chatId, user.id)
    const chat = await prisma.chat.findUnique({
      where: { id: ctx.params.chatId },
      include: {
        members: {
          select: {
            userId: true,
            role: true,
            lastReadSeq: true,
            user: { select: { id: true, username: true, displayName: true, identityKey: true, lastSeenAt: true, avatarMediaId: true } },
          },
        },
      },
    })
    if (!chat) throw new ApiError(404, "Chat not found")
    return NextResponse.json({
      chat: {
        id: chat.id,
        type: chat.type,
        title: chat.title,
        description: chat.description,
        handle: chat.handle,
        isPublic: chat.isPublic,
        inviteCode: chat.inviteCode,
        disappearAfter: chat.disappearAfter,
        lastMessageAt: chat.lastMessageAt,
        createdAt: chat.createdAt,
        seqCounter: chat.seqCounter,
      },
      members: chat.members,
      you: { role: member.role, lastReadSeq: member.lastReadSeq },
    })
  })
}

export async function PATCH(req: NextRequest, ctx: { params: { chatId: string } }) {
  return handleRoute(async () => {
    const user = await requireUser(req)
    const url = new URL(req.url)
    const action = url.searchParams.get("action")
    const chatId = ctx.params.chatId

    if (action === "members") {
      const me = await requireMembership(chatId, user.id)
      if (me.role !== "OWNER" && me.role !== "ADMIN") throw new ApiError(403, "Admin required")
      const body = await req.json().catch(() => ({}))
      const usernames: string[] = Array.isArray(body?.usernames) ? body.usernames : []
      if (usernames.length === 0) throw new ApiError(400, "No usernames")
      const users = await prisma.user.findMany({ where: { username: { in: usernames } } })
      const chat = await prisma.chat.findUnique({ where: { id: chatId } })
      if (!chat) throw new ApiError(404, "Chat not found")
      const io = getIO()
      for (const u of users) {
        const existing = await prisma.chatMember.findUnique({ where: { chatId_userId: { chatId, userId: u.id } } })
        if (existing) continue
        await prisma.chatMember.create({
          data: { chatId, userId: u.id, role: chat.type === "CHANNEL" ? "SUBSCRIBER" : "MEMBER" },
        })
        io?.in(`u:${u.id}`).socketsJoin(`c:${chatId}`)
        io?.to(`u:${u.id}`).emit("chat:new", { chatId })
      }
      io?.to(`c:${chatId}`).emit("chat:members-changed", {
        chatId,
        added: users.map((u) => u.id),
        removed: [],
        epochBump: true,
      })
      return NextResponse.json({ ok: true })
    }

    if (action === "leave") {
      const member = await requireMembership(chatId, user.id)
      await prisma.chatMember.delete({ where: { id: member.id } })
      getIO()?.to(`c:${chatId}`).emit("chat:members-changed", { chatId, added: [], removed: [user.id], epochBump: true })
      getIO()?.in(`u:${user.id}`).socketsLeave(`c:${chatId}`)
      return NextResponse.json({ ok: true })
    }

    const member = await requireMembership(chatId, user.id)
    if (member.role !== "OWNER" && member.role !== "ADMIN") throw new ApiError(403, "Admin required")
    const input = updateChatSchema.parse(await req.json())
    await prisma.chat.update({
      where: { id: chatId },
      data: {
        title: input.title,
        description: input.description,
        disappearAfter: input.disappearAfter,
        isPublic: input.isPublic,
      },
    })
    return NextResponse.json({ ok: true })
  })
}

export async function DELETE(req: NextRequest, ctx: { params: { chatId: string } }) {
  return handleRoute(async () => {
    const user = await requireUser(req)
    const member = await requireMembership(ctx.params.chatId, user.id)
    if (member.role !== "OWNER") throw new ApiError(403, "Owner required")
    await prisma.chat.delete({ where: { id: ctx.params.chatId } })
    return NextResponse.json({ ok: true })
  })
}
