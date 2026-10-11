import { NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/db"
import { createSession, handleRoute, setSessionCookie } from "@/lib/auth/session"
import { hashPassword } from "@/lib/auth/password"
import { registerSchema } from "@/lib/validations"
import nacl from "tweetnacl"
import { toB64 } from "@/lib/crypto/protocol"

export async function POST(req: NextRequest) {
  return handleRoute(async () => {
    const input = registerSchema.parse(await req.json())
    const existing = await prisma.user.findFirst({
      where: { OR: [{ username: input.username }, ...(input.password ? [] : [])] },
    })
    if (existing) return NextResponse.json({ error: "Username taken" }, { status: 409 })
    const identity = nacl.box.keyPair()
    const signing = nacl.sign.keyPair()
    const user = await prisma.user.create({
      data: {
        username: input.username,
        displayName: input.displayName,
        passwordHash: input.password ? await hashPassword(input.password) : null,
        identityKey: toB64(identity.publicKey),
        signingKey: toB64(signing.publicKey),
      },
    })
    const saved = await prisma.chat.create({
      data: {
        type: "SAVED",
        title: "Saved Messages",
        createdById: user.id,
        members: { create: { userId: user.id, role: "OWNER" } },
      },
    })
    const { token } = await createSession(user.id)
    await setSessionCookie(token)
    return NextResponse.json({
      user: { id: user.id, username: user.username, displayName: user.displayName },
      savedChatId: saved.id,
    })
  })
}
