import { NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/db"
import { ApiError, handleRoute, requireUser } from "@/lib/auth/session"
import { createChatSchema } from "@/lib/validations"
import { randomBytes } from "node:crypto"
import { getIO } from "@/lib/socket/io"

export async function GET(req: NextRequest) {
  return handleRoute(async () => {
    const user = await requireUser(req)
    const memberships = await prisma.chatMember.findMany({
      where: { userId: user.id },
      include: {
        chat: {
          include: {
            members: {
              select: {
                userId: true,
                role: true,
                user: { select: { id: true, username: true, displayName: true, identityKey: true, avatarMediaId: true } },
              },
            },
          },
        },
      },
      orderBy: { chat: { lastMessageAt: "desc" },
      },
    })
    const io = getIO()
    if (io) for (const m of memberships) io.in(`u:${user.id}`).socketsJoin(`c:${m.chatId}`)
    const result = memberships.map((m) => ({
      id: m.chat.id,
      type: m.chat.type,
      title: m.chat.title,
      description: m.chat.description,
      handle: m.chat.handle,
      isPublic: m.chat.isPublic,
      disappearAfter: m.chat.disappearAfter,
      lastMessageAt: m.chat.lastMessageAt.toISOString(),
      role: m.role,
      lastReadSeq: m.lastReadSeq,
      pinned: m.pinned,
      archived: m.archived,
      mutedUntil: m.mutedUntil?.toISOString() ?? null,
      seqCounter: m.chat.seqCounter,
      members: m.chat.members,
    }))
    return NextResponse.json({ chats: result })
  })
}

export async function POST(req: NextRequest) {
  return handleRoute(async () => {
    const user = await requireUser(req)
    const input = createChatSchema.parse(await req.json())
    const memberIds = [user.id]
    if (input.type !== "CHANNEL") {
      const users = await prisma.user.findMany({ where: { username: { in: input.memberUsernames } } })
      if (users.length !== input.memberUsernames.length) throw new ApiError(404, "Some users not found")
      for (const u of users) if (u.id !== user.id) memberIds.push(u.id)
    }

    if (input.type === "DIRECT") {
      if (memberIds.length !== 2) throw new ApiError(400, "Direct chat needs exactly one other member")
      const other = memberIds.find((id) => id !== user.id)!
      const existing = await prisma.chat.findFirst({
        where: {
          type: "DIRECT",
          AND: [
            { members: { some: { userId: user.id } } },
            { members: { some: { userId: other } } },
          ],
        },
        include: { members: true },
      })
      if (existing && existing.members.length === 2) {
        return NextResponse.json({ chatId: existing.id, existing: true })
      }
    }

    const chat = await prisma.chat.create({
      data: {
        type: input.type,
        title: input.title,
        description: input.description,
        isPublic: input.isPublic,
        handle: input.type === "CHANNEL" ? input.handle : undefined,
        inviteCode: input.type !== "DIRECT" ? randomBytes(9).toString("base64url") : undefined,
        createdById: user.id,
        members: {
          create: memberIds.map((id) => ({
            userId: id,
            role: id === user.id ? "OWNER" : input.type === "CHANNEL" ? "SUBSCRIBER" : "MEMBER",
          })),
        },
      },
    })
    const io = getIO()
    if (io) {
      for (const id of memberIds) {
        io.in(`u:${id}`).socketsJoin(`c:${chat.id}`)
        io.to(`u:${id}`).emit("chat:new", { chatId: chat.id })
      }
    }
    return NextResponse.json({ chatId: chat.id, existing: false })
  })
}
