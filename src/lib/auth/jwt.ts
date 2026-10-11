import { SignJWT, jwtVerify } from "jose"
import { getEnv } from "../env"

export interface SessionClaims {
  sub: string
  sid: string
}

const secret = () => new TextEncoder().encode(getEnv().JWT_SECRET)

export async function signSessionToken(userId: string, sessionId: string) {
  return new SignJWT({ sid: sessionId })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(userId)
    .setIssuedAt()
    .setExpirationTime("30d")
    .sign(secret())
}

export async function verifySessionToken(token: string): Promise<SessionClaims | null> {
  try {
    const { payload } = await jwtVerify(token, secret())
    if (!payload.sub || typeof payload.sid !== "string") return null
    return { sub: payload.sub, sid: payload.sid }
  } catch {
    return null
  }
}
