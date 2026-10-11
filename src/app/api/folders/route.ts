import { NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/db"
import { ApiError, handleRoute, requireUser } from "@/lib/auth/session"
import { folderSchema } from "@/lib/validations"

export async function GET(req: NextRequest) {
  return handleRoute(async () => {
    const user = await requireUser(req)
    const folders = await prisma.folder.findMany({
      where: { userId: user.id },
      orderBy: { position: "asc" },
      include: { chats: { select: { chatId: true } } },
    })
    return NextResponse.json({
      folders: folders.map((f) => ({ id: f.id, name: f.name, emoji: f.emoji, position: f.position, chatIds: f.chats.map((c) => c.chatId) })),
    })
  })
}

export async function POST(req: NextRequest) {
  return handleRoute(async () => {
    const user = await requireUser(req)
    const input = folderSchema.parse(await req.json())
    const folder = await prisma.folder.create({ data: { ...input, userId: user.id } })
    return NextResponse.json({ folder: { id: folder.id, name: folder.name, emoji: folder.emoji, position: folder.position, chatIds: [] } })
  })
}

export async function DELETE(req: NextRequest) {
  return handleRoute(async () => {
    const user = await requireUser(req)
    const id = new URL(req.url).searchParams.get("id")
    if (!id) throw new ApiError(400, "Missing id")
    await prisma.folder.deleteMany({ where: { id, userId: user.id } })
    return NextResponse.json({ ok: true })
  })
}
