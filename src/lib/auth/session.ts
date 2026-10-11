import { createHash, randomBytes } from "node:crypto"
import { cookies } from "next/headers"
import { NextRequest, NextResponse } from "next/server"
import { prisma } from "../db"
import { signSessionToken, verifySessionToken, type SessionClaims } from "./jwt"

export const SESSION_COOKIE = "skurf_session"
const SESSION_DAYS = 30

export { signSessionToken, verifySessionToken }
export type { SessionClaims }

export async function createSession(userId: string, deviceInfo?: string) {
  const id = randomBytes(16).toString("hex")
  const tokenHash = hashToken(id)
  const expiresAt = new Date(Date.now() + SESSION_DAYS * 24 * 3600 * 1000)
  const session = await prisma.authSession.create({
    data: { id, userId, tokenHash, expiresAt, deviceInfo },
  })
  const token = await signSessionToken(userId, session.id)
  return { session, token }
}

export function hashToken(raw: string) {
  return createHash("sha256").update(raw).digest("hex")
}

export async function setSessionCookie(token: string) {
  const jar = cookies()
  jar.set(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: SESSION_DAYS * 24 * 3600,
  })
}

export async function clearSessionCookie() {
  const jar = cookies()
  jar.set(SESSION_COOKIE, "", { httpOnly: true, path: "/", maxAge: 0 })
}

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string
  ) {
    super(message)
  }
}

export async function getSessionUser(req: NextRequest) {
  const token = req.cookies.get(SESSION_COOKIE)?.value
  if (!token) return null
  const claims = await verifySessionToken(token)
  if (!claims) return null
  const session = await prisma.authSession.findUnique({
    where: { id: claims.sid },
    include: { user: true },
  })
  if (!session || session.expiresAt < new Date()) return null
  return session.user
}

export async function requireUser(req: NextRequest) {
  const user = await getSessionUser(req)
  if (!user) throw new ApiError(401, "Unauthorized")
  return user
}

export function jsonError(status: number, message: string) {
  return NextResponse.json({ error: message }, { status })
}

export async function handleRoute(fn: () => Promise<NextResponse>): Promise<NextResponse> {
  try {
    return await fn()
  } catch (err) {
    if (err instanceof ApiError) return jsonError(err.status, err.message)
    if (err instanceof Error && err.name === "ZodError") return jsonError(400, "Invalid request")
    console.error("[api]", err)
    return jsonError(500, "Internal error")
  }
}

export { cookies }
