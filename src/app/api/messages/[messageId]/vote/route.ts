import { NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/db"
import { ApiError, handleRoute, requireUser } from "@/lib/auth/session"
import { requireMembership, voteSchema } from "@/lib/validations"
import { getIO } from "@/lib/socket/io"

export async function GET(req: NextRequest, ctx: { params: { messageId: string } }) {
  return handleRoute(async () => {
    const user = await requireUser(req)
    const message = await prisma.message.findUnique({
      where: { id: ctx.params.messageId },
      include: { poll: true },
    })
    if (!message || !message.poll) throw new ApiError(404, "Poll not found")
    await requireMembership(message.chatId, user.id)
    const votes = await prisma.pollVote.groupBy({
      by: ["optionIndex"],
      where: { pollMessageId: message.id },
      _count: { userId: true },
    })
    const totalVoters = await prisma.pollVote.count({ where: { pollMessageId: message.id, optionIndex: 0 } })
    const distinctVoters = await prisma.$queryRaw<{ count: bigint }[]>`SELECT COUNT(DISTINCT "userId")::int AS count FROM "PollVote" WHERE "pollMessageId" = ${message.id}`
    return NextResponse.json({
      counts: votes.map((v) => ({ optionIndex: v.optionIndex, count: v._count.userId })),
      totalVoters: Number(distinctVoters[0]?.count ?? totalVoters),
    })
  })
}

export async function POST(req: NextRequest, ctx: { params: { messageId: string } }) {
  return handleRoute(async () => {
    const user = await requireUser(req)
    const message = await prisma.message.findUnique({
      where: { id: ctx.params.messageId },
      include: { poll: true },
    })
    if (!message || !message.poll) throw new ApiError(404, "Poll not found")
    await requireMembership(message.chatId, user.id)
    if (message.poll.closedAt) throw new ApiError(400, "Poll closed")
    const input = voteSchema.parse(await req.json())
    if (!message.poll.allowMultiple) {
      await prisma.pollVote.deleteMany({ where: { pollMessageId: message.id, userId: user.id } })
    }
    await prisma.pollVote.upsert({
      where: { pollMessageId_userId_optionIndex: { pollMessageId: message.id, userId: user.id, optionIndex: input.optionIndex } },
      create: { pollMessageId: message.id, userId: user.id, optionIndex: input.optionIndex },
      update: {},
    })
    const votes = await prisma.pollVote.groupBy({
      by: ["optionIndex"],
      where: { pollMessageId: message.id },
      _count: { userId: true },
    })
    const distinctVoters = await prisma.$queryRaw<{ count: bigint }[]>`SELECT COUNT(DISTINCT "userId")::int AS count FROM "PollVote" WHERE "pollMessageId" = ${message.id}`
    getIO()?.to(`c:${message.chatId}`).emit("poll:update", {
      messageId: message.id,
      counts: votes.map((v) => ({ optionIndex: v.optionIndex, count: v._count.userId })),
      totalVoters: Number(distinctVoters[0]?.count ?? 0),
    })
    return NextResponse.json({ ok: true })
  })
}
