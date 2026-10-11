import { z } from "zod"
import { prisma } from "./db"
import { ApiError, getSessionUser } from "./auth/session"
import { NextRequest } from "next/server"

export const usernameSchema = z
  .string()
  .min(3)
  .max(24)
  .regex(/^[a-z0-9_]+$/, "lowercase letters, numbers, underscore only")
export const passwordSchema = z.string().min(8).max(128)
export const b64 = z.string().min(1).max(65536)

export const registerSchema = z.object({
  username: usernameSchema,
  displayName: z.string().min(1).max(64),
  password: passwordSchema.optional(),
})

export const loginSchema = z.object({
  username: usernameSchema,
  password: passwordSchema,
})

export const deviceRegistrationSchema = z.object({
  name: z.string().min(1).max(64),
  platform: z.enum(["web", "ios", "android", "desktop"]),
  identityKey: b64,
  signingKey: b64,
  registrationId: z.number().int().min(0),
  signedPreKeyId: z.number().int().min(0),
  signedPreKey: b64,
  signedPreKeySig: b64,
  oneTimePreKeys: z.array(z.object({ keyId: z.number().int().min(0), publicKey: b64 })).max(200),
})

export const preKeysUploadSchema = z.object({
  oneTimePreKeys: z.array(z.object({ keyId: z.number().int().min(0), publicKey: b64 })).max(200),
})

export const createChatSchema = z
  .object({
    type: z.enum(["DIRECT", "GROUP", "CHANNEL"]),
    memberUsernames: z.array(usernameSchema).max(256).default([]),
    title: z.string().min(1).max(80).optional(),
    description: z.string().max(512).optional(),
    isPublic: z.boolean().default(false),
    handle: z
      .string()
      .min(3)
      .max(32)
      .regex(/^[a-z0-9_]+$/)
      .optional(),
  })
  .refine((v) => v.type !== "GROUP" || (v.title !== undefined), { message: "Group needs a title" })
  .refine((v) => v.type !== "CHANNEL" || (v.title !== undefined && v.handle !== undefined), {
    message: "Channel needs title and handle",
  })

export const updateChatSchema = z.object({
  title: z.string().min(1).max(80).optional(),
  description: z.string().max(512).optional(),
  disappearAfter: z.number().int().min(0).max(604800).nullable().optional(),
  inviteCode: z.string().min(6).max(64).optional(),
  isPublic: z.boolean().optional(),
})

export const addMembersSchema = z.object({
  usernames: z.array(usernameSchema).min(1).max(100),
})

export const updateMemberSchema = z.object({
  role: z.enum(["OWNER", "ADMIN", "MEMBER", "SUBSCRIBER"]).optional(),
  pinned: z.boolean().optional(),
  archived: z.boolean().optional(),
  mutedUntil: z.number().int().nullable().optional(),
})

export const messageEditSchema = z.object({
  body: b64.optional(),
  envelopes: z
    .array(z.object({ toUserId: z.string(), toDeviceId: z.string(), payload: b64 }))
    .max(64)
    .optional(),
  meta: z.string().max(8192).optional(),
})

export const reactionSchema = z.object({
  emoji: z.string().min(1).max(16),
})

export const voteSchema = z.object({
  optionIndex: z.number().int().min(0).max(63),
})

export const draftSchema = z.object({
  content: b64,
})

export const folderSchema = z.object({
  name: z.string().min(1).max(32),
  emoji: z.string().max(8).optional(),
  position: z.number().int().default(0),
})

export const folderChatsSchema = z.object({
  chatIds: z.array(z.string()).max(500),
})

export const linkTokenSchema = z.object({})

export const deviceLinkSchema = z.object({
  token: z.string().min(16).max(256),
  device: deviceRegistrationSchema,
})

export const privacySchema = z.object({
  displayName: z.string().min(1).max(64).optional(),
  bio: z.string().max(200).optional(),
  lastSeenVisibility: z.enum(["EVERYONE", "CONTACTS", "NONE"]).optional(),
  readReceiptsEnabled: z.boolean().optional(),
})

export const mediaMetaSchema = z.object({
  kind: z.enum(["image", "video", "audio", "voice", "document"]),
  mime: z.string().max(128),
  width: z.number().int().optional(),
  height: z.number().int().optional(),
  durationMs: z.number().int().optional(),
  waveform: z.string().max(8192).optional(),
})

export async function requireMembership(chatId: string, userId: string) {
  const member = await prisma.chatMember.findUnique({
    where: { chatId_userId: { chatId, userId } },
    include: { chat: true },
  })
  if (!member) throw new ApiError(403, "Not a member of this chat")
  return member
}

export async function requireAdmin(chatId: string, userId: string) {
  const member = await requireMembership(chatId, userId)
  if (member.role !== "OWNER" && member.role !== "ADMIN")
    throw new ApiError(403, "Admin role required")
  return member
}

export async function userFromCookie(req: NextRequest) {
  const user = await getSessionUser(req)
  if (!user) throw new ApiError(401, "Unauthorized")
  return user
}
