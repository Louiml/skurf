import { NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/db"
import { ApiError, handleRoute, requireUser } from "@/lib/auth/session"
import { requireMembership, folderChatsSchema } from "@/lib/validations"

export async function PUT(req: NextRequest, ctx: { params: { folderId: string } }) {
  return handleRoute(async () => {
    const user = await requireUser(req)
    const folder = await prisma.folder.findFirst({ where: { id: ctx.params.folderId, userId: user.id } })
    if (!folder) throw new ApiError(404, "Folder not found")
    const input = folderChatsSchema.parse(await req.json())
    for (const chatId of input.chatIds) {
      await requireMembership(chatId, user.id)
    }
    await prisma.folderChat.deleteMany({ where: { folderId: folder.id } })
    if (input.chatIds.length > 0) {
      await prisma.folderChat.createMany({
        data: input.chatIds.map((chatId) => ({ folderId: folder.id, chatId })),
        skipDuplicates: true,
      })
    }
    return NextResponse.json({ ok: true })
  })
}
