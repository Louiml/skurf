import { NextRequest, NextResponse } from "next/server"
import { handleRoute, requireUser } from "@/lib/auth/session"
import { createWebauthnRegistrationOptions, verifyWebauthnRegistration } from "@/lib/auth/webauthn"
import { prisma } from "@/lib/db"

export async function POST(req: NextRequest) {
  return handleRoute(async () => {
    const user = await requireUser(req)
    const body = await req.json()
    if (body?.start) {
      const options = await createWebauthnRegistrationOptions(user.id, user.username, user.displayName)
      return NextResponse.json(options)
    }
    const credential = await verifyWebauthnRegistration(user.id, body.response)
    if (!credential) return NextResponse.json({ error: "Registration failed" }, { status: 400 })
    return NextResponse.json({ ok: true, credentialId: credential.id })
  })
}

export async function GET(req: NextRequest) {
  return handleRoute(async () => {
    const user = await requireUser(req)
    const creds = await prisma.webAuthnCredential.findMany({
      where: { userId: user.id },
      select: { id: true, createdAt: true, transports: true },
    })
    return NextResponse.json({ credentials: creds })
  })
}
