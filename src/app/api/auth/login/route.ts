import { NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/db"
import { createSession, handleRoute, setSessionCookie } from "@/lib/auth/session"
import { verifyPassword } from "@/lib/auth/password"
import { loginSchema } from "@/lib/validations"

export async function POST(req: NextRequest) {
  return handleRoute(async () => {
    const input = loginSchema.parse(await req.json())
    const user = await prisma.user.findUnique({ where: { username: input.username } })
    if (!user?.passwordHash || !(await verifyPassword(input.password, user.passwordHash))) {
      return NextResponse.json({ error: "Invalid credentials" }, { status: 401 })
    }
    const { token } = await createSession(user.id)
    await setSessionCookie(token)
    return NextResponse.json({
      user: { id: user.id, username: user.username, displayName: user.displayName },
    })
  })
}
