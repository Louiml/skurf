import { NextRequest, NextResponse } from "next/server"
import { handleRoute, requireUser } from "@/lib/auth/session"
import { getEnv } from "@/lib/env"

export async function GET(req: NextRequest) {
  return handleRoute(async () => {
    await requireUser(req)
    const env = getEnv()
    const iceServers: Array<{ urls: string; username?: string; credential?: string }> = [
      { urls: env.STUN_URL },
    ]
    if (env.TURN_URL) {
      iceServers.push({ urls: env.TURN_URL, username: env.TURN_USERNAME, credential: env.TURN_CREDENTIAL })
    }
    return NextResponse.json({ iceServers })
  })
}
