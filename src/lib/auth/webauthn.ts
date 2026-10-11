import {
  generateAuthenticationOptions,
  generateRegistrationOptions,
  verifyAuthenticationResponse,
  verifyRegistrationResponse,
} from "@simplewebauthn/server"
import { prisma } from "../db"
import { getEnv } from "../env"

export function rp() {
  const env = getEnv()
  return { rpName: env.RP_NAME, rpID: env.RP_ID, origin: env.ORIGINS.split(",") }
}

export async function createWebauthnRegistrationOptions(userId: string, username: string, displayName: string) {
  const existing = await prisma.webAuthnCredential.findMany({ where: { userId } })
  const opts = await generateRegistrationOptions({
    rpName: rp().rpName,
    rpID: rp().rpID,
    userID: new TextEncoder().encode(userId),
    userName: username,
    userDisplayName: displayName,
    excludeCredentials: existing.map((c) => ({ id: c.id })),
    authenticatorSelection: { residentKey: "preferred", userVerification: "preferred" },
  })
  return opts
}

export async function verifyWebauthnRegistration(userId: string, response: unknown) {
  const verification = await verifyRegistrationResponse({
    response: response as any,
    expectedChallenge: () => true,
    expectedRPID: rp().rpID,
    expectedOrigin: rp().origin,
    requireUserVerification: false,
  })
  if (!verification.verified || !verification.registrationInfo) return null
  const { credentialID, credentialPublicKey, counter } = verification.registrationInfo
  return prisma.webAuthnCredential.create({
    data: {
      id: credentialID,
      userId,
      publicKey: Buffer.from(credentialPublicKey).toString("base64"),
      counter,
    },
  })
}

export async function createWebauthnAuthOptions(username: string) {
  const user = await prisma.user.findUnique({
    where: { username },
    include: { credentials: true },
  })
  if (!user || user.credentials.length === 0) throw new Error("No passkeys registered")
  return generateAuthenticationOptions({
    rpID: rp().rpID,
    allowCredentials: user.credentials.map((c) => ({ id: c.id })),
    userVerification: "preferred",
  })
}

export async function verifyWebauthnAuth(username: string, response: unknown) {
  const user = await prisma.user.findUnique({
    where: { username },
    include: { credentials: true },
  })
  if (!user) return null
  const cred = user.credentials.find((c) => c.id === (response as { id?: string })?.id)
  if (!cred) return null
  try {
    const verification = await verifyAuthenticationResponse({
      response: response as any,
      expectedChallenge: () => true,
      expectedRPID: rp().rpID,
      expectedOrigin: rp().origin,
      authenticator: {
        credentialID: cred.id,
        credentialPublicKey: new Uint8Array(Buffer.from(cred.publicKey, "base64")),
        counter: cred.counter,
      },
      requireUserVerification: false,
    })
    if (!verification.verified) return null
    await prisma.webAuthnCredential.update({
      where: { id: cred.id },
      data: { counter: verification.authenticationInfo.newCounter },
    })
    return user
  } catch {
    return null
  }
}
