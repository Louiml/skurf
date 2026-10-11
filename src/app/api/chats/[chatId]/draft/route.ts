import { NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/db"
import { handleRoute, requireUser } from "@/lib/auth/session"
import { requireMembership, draftSchema } from "@/lib/validations"

export async function GET(req: NextRequest, ctx: { params: { chatId: string } }) {
  return handleRoute(async () => {
    const user = await requireUser(req)
    await requireMembership(ctx.params.chatId, user.id)
    const draft = await prisma.draft.findUnique({
      where: { chatId_userId: { chatId: ctx.params.chatId, userId: user.id } },
    })
    return NextResponse.json({ draft: draft?.content ?? null })
  })
}

export async function PUT(req: NextRequest, ctx: { params: { chatId: string } }) {
  return handleRoute(async () => {
    const user = await requireUser(req)
    await requireMembership(ctx.params.chatId, user.id)
    const input = draftSchema.parse(await req.json())
    await prisma.draft.upsert({
      where: { chatId_userId: { chatId: ctx.params.chatId, userId: user.id } },
      create: { chatId: ctx.params.chatId, userId: user.id, content: input.content },
      update: { content: input.content },
    })
    return NextResponse.json({ ok: true })
  })
}

export async function DELETE(req: NextRequest, ctx: { params: { chatId: string } }) {
  return handleRoute(async () => {
    const user = await requireUser(req)
    await requireMembership(ctx.params.chatId, user.id)
    await prisma.draft.deleteMany({ where: { chatId: ctx.params.chatId, userId: user.id } })
    return NextResponse.json({ ok: true })
  })
}
