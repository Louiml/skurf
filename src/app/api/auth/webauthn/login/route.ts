import { NextRequest, NextResponse } from "next/server"
import { createSession, handleRoute, requireUser, setSessionCookie } from "@/lib/auth/session"
import { createWebauthnAuthOptions, verifyWebauthnAuth } from "@/lib/auth/webauthn"
import { usernameSchema } from "@/lib/validations"

export async function POST(req: NextRequest) {
  return handleRoute(async () => {
    const { username, response } = await req.json().then((b) => ({
      username: usernameSchema.parse(b.username),
      response: b.response,
    }))
    const user = await verifyWebauthnAuth(username, response)
    if (!user) return NextResponse.json({ error: "Passkey verification failed" }, { status: 401 })
    const { token } = await createSession(user.id)
    await setSessionCookie(token)
    return NextResponse.json({ user: { id: user.id, username: user.username, displayName: user.displayName } })
  })
}

export async function GET(req: NextRequest) {
  return handleRoute(async () => {
    const url = new URL(req.url)
    const username = usernameSchema.parse(url.searchParams.get("username") ?? "")
    const options = await createWebauthnAuthOptions(username)
    return NextResponse.json(options)
  })
}

export const dynamic = "force-dynamic"
