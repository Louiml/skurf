import { NextRequest, NextResponse } from "next/server"
import { handleRoute, clearSessionCookie } from "@/lib/auth/session"

export async function POST(_req: NextRequest) {
  return handleRoute(async () => {
    await clearSessionCookie()
    return NextResponse.json({ ok: true })
  })
}
