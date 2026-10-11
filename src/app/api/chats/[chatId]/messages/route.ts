import { NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/db"
import { handleRoute, requireUser } from "@/lib/auth/session"
import { requireMembership } from "@/lib/validations"

export async function GET(req: NextRequest, ctx: { params: { chatId: string } }) {
  return handleRoute(async () => {
    const user = await requireUser(req)
    const member = await requireMembership(ctx.params.chatId, user.id)
    const url = new URL(req.url)
    const deviceId = req.headers.get("x-device-id") ?? ""
    const afterSeq = url.searchParams.get("afterSeq") ? parseInt(url.searchParams.get("afterSeq")!) : undefined
    const beforeSeq = url.searchParams.get("beforeSeq") ? parseInt(url.searchParams.get("beforeSeq")!) : undefined
    const limit = Math.min(parseInt(url.searchParams.get("limit") ?? "50"), 100)

    const messages = await prisma.message.findMany({
      where: {
        chatId: ctx.params.chatId,
        ...(afterSeq !== undefined && !Number.isNaN(afterSeq) ? { seq: { gt: afterSeq } } : {}),
        ...(beforeSeq !== undefined && !Number.isNaN(beforeSeq) ? { seq: { lt: beforeSeq } } : {}),
        deletions: { none: { userId: user.id } },
      },
      orderBy: { seq: "desc" },
      take: limit,
      include: {
        reactions: { select: { userId: true, emoji: true } },
        receipts: { select: { userId: true, deliveredAt: true, readAt: true } },
        poll: { select: { allowMultiple: true, anonymous: true, closedAt: true } },
        envelopes: {
          where: { toUserId: user.id, toDeviceId: deviceId, consumedAt: null, type: "MESSAGE" },
          select: { id: true, payload: true, createdAt: true },
        },
        replyTo: {
          select: { id: true, senderId: true, type: true, body: true, meta: true, seq: true, createdAt: true },
        },
      },
    })

    const result = messages.map((m) => ({
      id: m.id,
      chatId: m.chatId,
      senderId: m.senderId,
      senderDeviceId: m.senderDeviceId,
      type: m.type,
      seq: m.seq,
      body: m.body,
      meta: m.meta,
      replyTo: m.replyTo
        ? { id: m.replyTo.id, senderId: m.replyTo.senderId, type: m.replyTo.type, seq: m.replyTo.seq }
        : null,
      forwardedFromChat: m.forwardedFromChat,
      forwardedFromUser: m.forwardedFromUser,
      editedAt: m.editedAt?.toISOString() ?? null,
      deletedForEveryone: m.deletedForEveryone,
      expiresAt: m.expiresAt?.toISOString() ?? null,
      createdAt: m.createdAt.toISOString(),
      reactions: m.reactions,
      receipts: m.receipts.map((r) => ({ userId: r.userId, delivered: !!r.deliveredAt, read: !!r.readAt })),
      poll: m.poll ? { allowMultiple: m.poll.allowMultiple, anonymous: m.poll.anonymous, closed: !!m.poll.closedAt } : null,
      envelope: m.envelopes.length > 0 ? { id: m.envelopes[0].id, payload: m.envelopes[0].payload } : null,
    }))

    const votes = await prisma.pollVote.groupBy({
      by: ["pollMessageId", "optionIndex"],
      where: { poll: { chatId: ctx.params.chatId } },
      _count: { userId: true },
    })

    return NextResponse.json({
      messages: result.reverse(),
      pollCounts: votes.map((v) => ({ messageId: v.pollMessageId, optionIndex: v.optionIndex, count: v._count.userId })),
      lastReadSeq: member.lastReadSeq,
    })
  })
}
