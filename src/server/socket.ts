import { Server, Socket } from "socket.io"
import { createAdapter } from "@socket.io/redis-adapter"
import { prisma } from "../lib/db"
import { verifySessionToken } from "../lib/auth/jwt"
import { getRedis, getRedisSub, markOnline, markSocketOffline } from "../lib/redis"
import type { ClientToServerEvents, ServerToClientEvents, SocketData } from "../lib/socket/events"
import { setIO } from "../lib/socket/io"

export type SkurfServer = Server<ClientToServerEvents, ServerToClientEvents, never, SocketData>
export type SkurfSocket = Socket<ClientToServerEvents, ServerToClientEvents, never, SocketData>

export function setupSocketIO(io: SkurfServer) {
  setIO(io)
  const pub = getRedis()
  const sub = getRedisSub()
  io.adapter(createAdapter(pub, sub))

function parseCookie(header: string | undefined, name: string): string | undefined {
  if (!header) return undefined
  for (const part of header.split(";")) {
    const [k, ...v] = part.trim().split("=")
    if (k === name) return v.join("=")
  }
  return undefined
}

io.use(async (socket, next) => {
  try {
    const token = (socket.handshake.auth?.token as string | undefined) ?? parseCookie(socket.handshake.headers.cookie, "skurf_session")
    const deviceId = socket.handshake.auth?.deviceId as string | undefined
    if (!token || !deviceId) return next(new Error("Unauthorized"))
    const claims = await verifySessionToken(token)
      if (!claims) return next(new Error("Unauthorized"))
      const session = await prisma.authSession.findUnique({ where: { id: claims.sid } })
      if (!session || session.expiresAt < new Date()) return next(new Error("Unauthorized"))
      const device = await prisma.device.findFirst({ where: { id: deviceId, userId: claims.sub, revokedAt: null } })
      if (!device) return next(new Error("Unknown device"))
      socket.data.userId = claims.sub
      socket.data.deviceId = deviceId
      next()
    } catch {
      next(new Error("Unauthorized"))
    }
  })

  io.on("connection", (socket) => {
    const ready = prepareConnection(io, socket)
    ready.catch((err) => {
      console.error("[socket] connection setup failed:", err)
      socket.disconnect(true)
    })
    registerHandlers(io, socket, ready)
  })
}

async function prepareConnection(io: SkurfServer, socket: SkurfSocket) {
  const { userId, deviceId } = socket.data
  await socket.join(`u:${userId}`)
  await socket.join(`d:${deviceId}`)
  const memberships = await prisma.chatMember.findMany({ where: { userId }, select: { chatId: true } })
  for (const m of memberships) await socket.join(`c:${m.chatId}`)

  await markOnline(userId, socket.id)
  await prisma.device.update({ where: { id: deviceId }, data: { lastActiveAt: new Date() } }).catch(() => {})
  broadcastPresence(io, userId, true)
}

function registerHandlers(io: SkurfServer, socket: SkurfSocket, ready: Promise<void>) {
  const { userId, deviceId } = socket.data

  const gate = (fn: () => void) => {
    void (async () => {
      try {
        await ready
        fn()
      } catch {
        // connection setup failed and socket was disconnected
      }
    })()
  }

  socket.on("presence:heartbeat", () => {
    gate(() => void markOnline(userId, socket.id))
  })

  socket.on("message:send", (data, ack) => {
    gate(() => void handleMessageSend(io, socket, data, ack))
  })

  socket.on("receipt:delivered", (data) => {
    gate(() => void handleDelivered(io, socket, data.envelopeIds ?? []))
  })

  socket.on("receipt:read", (data) => {
    gate(() => void handleRead(io, socket, data))
  })

  socket.on("typing:update", (data) => {
    gate(() => {
      if (typeof data.chatId !== "string") return
      socket.to(`c:${data.chatId}`).emit("typing:update", {
        chatId: data.chatId,
        userId,
        isTyping: !!data.isTyping,
      })
    })
  })

  socket.on("reaction:toggle", (data) => {
    gate(() => void handleReaction(io, socket, data))
  })

  socket.on("message:edit", (data, ack) => {
    gate(() => void handleEdit(io, socket, data, ack))
  })

  socket.on("message:delete", (data) => {
    gate(() => void handleDelete(io, socket, data))
  })

  socket.on("webrtc:signal", (data) => {
    gate(() => {
      if (!data || typeof data.callId !== "string" || typeof data.toUserId !== "string") return
      io.to(`u:${data.toUserId}`).emit("webrtc:signal", {
        callId: data.callId,
        fromUserId: userId,
        fromDevice: deviceId,
        toDevice: data.toDevice ?? "",
        signal: data.signal,
      })
    })
  })

  socket.on("call:ring", (data, ack) => {
    gate(() => void handleCallRing(io, socket, data, ack))
  })

  socket.on("call:accept", (data) => {
    gate(() => void handleCallAccept(io, socket, data))
  })

  socket.on("call:decline", (data) => {
    gate(() => void handleCallState(io, data?.callId, "DECLINED"))
  })

  socket.on("call:end", (data) => {
    gate(() => void handleCallState(io, data?.callId, "ENDED"))
  })

  socket.on("control:send", (data) => {
    gate(() => void handleControlSend(io, socket, data))
  })

  socket.on("group:epoch-missing", (data) => {
    gate(() => {
      if (typeof data?.chatId !== "string" || typeof data.epoch !== "number") return
      socket.to(`c:${data.chatId}`).emit("group:epoch-request", {
        chatId: data.chatId,
        epoch: data.epoch,
        fromUserId: userId,
        fromDevice: deviceId,
      })
    })
  })

  socket.on("disconnect", () => {
    void (async () => {
      try {
        await ready
      } catch {
        return
      }
      const lastSocket = await markSocketOffline(userId, socket.id)
      if (lastSocket) {
        const lastSeenAt = new Date()
        await prisma.user.update({ where: { id: userId }, data: { lastSeenAt } }).catch(() => {})
        broadcastPresence(io, userId, false, lastSeenAt.toISOString())
      }
    })()
  })
}

function broadcastPresence(io: SkurfServer, userId: string, online: boolean, lastSeenAt?: string) {
  void (async () => {
    const memberships = await prisma.chatMember.findMany({ where: { userId }, select: { chatId: true } })
    const seen = new Set<string>()
    for (const m of memberships) {
      if (seen.has(m.chatId)) continue
      seen.add(m.chatId)
      io.to(`c:${m.chatId}`).emit("presence:update", { userId, online, lastSeenAt })
    }
  })()
}

async function handleMessageSend(
  io: SkurfServer,
  socket: SkurfSocket,
  data: Parameters<ClientToServerEvents["message:send"]>[0],
  ack: Parameters<ClientToServerEvents["message:send"]>[1]
) {
  try {
    const { userId, deviceId } = socket.data
    if (!data || typeof data.chatId !== "string" || typeof data.type !== "string") {
      return ack({ ok: false, error: "Invalid payload" })
    }
    const member = await prisma.chatMember.findUnique({
      where: { chatId_userId: { chatId: data.chatId, userId } },
      include: { chat: true },
    })
    if (!member) return ack({ ok: false, error: "Not a member" })
    if (member.chat.type === "CHANNEL" && member.role !== "OWNER" && member.role !== "ADMIN") {
      return ack({ ok: false, error: "Only admins can post in channels" })
    }
    const isE2EE = member.chat.type !== "CHANNEL"
    if (isE2EE && member.chat.type !== "GROUP" && member.chat.type !== "SAVED" && !Array.isArray(data.envelopes)) {
      return ack({ ok: false, error: "Missing envelopes" })
    }
    if (member.chat.type === "GROUP" && typeof data.body !== "string") {
      return ack({ ok: false, error: "Missing group ciphertext" })
    }
    if (member.chat.type === "CHANNEL" && typeof data.body !== "string") {
      return ack({ ok: false, error: "Missing body" })
    }
    const members = await prisma.chatMember.findMany({
      where: { chatId: data.chatId },
      select: { userId: true },
    })
    const memberIds = new Set(members.map((m) => m.userId))

    let createdEnvelopes: { id: string; toUserId: string; toDeviceId: string; payload: string }[] = []

    const message = await prisma.$transaction(async (tx) => {
      const chat = await tx.chat.findUnique({ where: { id: data.chatId } })
      if (!chat) throw new Error("Chat not found")
      const seq = chat.seqCounter + 1
      const disappearAfter = data.expiresAfter ?? chat.disappearAfter ?? null
      const expiresAt = disappearAfter ? new Date(Date.now() + disappearAfter * 1000) : null
      const created = await tx.message.create({
        data: {
          chatId: data.chatId,
          senderId: userId,
          senderDeviceId: deviceId,
          type: data.type as any,
          seq,
          body: isE2EE && member.chat.type !== "GROUP" ? null : (data.body ?? null),
          meta: typeof data.meta === "string" ? data.meta : null,
          replyToId: typeof data.replyToId === "string" ? data.replyToId : null,
          forwardedFromChat: typeof data.forwardedFromChat === "string" ? data.forwardedFromChat : null,
          forwardedFromUser: typeof data.forwardedFromUser === "string" ? data.forwardedFromUser : null,
          expiresAt,
        },
      })
      await tx.chat.update({
        where: { id: data.chatId },
        data: { seqCounter: seq, lastMessageAt: created.createdAt },
      })
      createdEnvelopes = []
      if (data.envelopes?.length) {
        for (const env of data.envelopes) {
          if (env.toUserId !== userId && !memberIds.has(env.toUserId)) continue
          if (env.toUserId === userId && env.toDeviceId === deviceId) continue
          const row = await tx.envelope.create({
            data: {
              type: "MESSAGE",
              chatId: data.chatId,
              messageId: created.id,
              fromUserId: userId,
              fromDevice: deviceId,
              toUserId: env.toUserId,
              toDeviceId: env.toDeviceId,
              payload: env.payload,
            },
          })
          createdEnvelopes.push({ id: row.id, toUserId: env.toUserId, toDeviceId: env.toDeviceId, payload: env.payload })
        }
      }
      if (data.type === "POLL") {
        await tx.poll.create({
          data: {
            messageId: created.id,
            chatId: data.chatId,
            allowMultiple: !!data.poll?.allowMultiple,
            anonymous: !!data.poll?.anonymous,
          },
        })
      }
      return created
    })

    io.to(`c:${data.chatId}`).emit("message:new", {
      id: message.id,
      chatId: message.chatId,
      senderId: message.senderId,
      senderDeviceId: message.senderDeviceId,
      type: message.type,
      seq: message.seq,
      body: message.body,
      meta: message.meta,
      replyToId: message.replyToId,
      forwardedFromChat: message.forwardedFromChat,
      forwardedFromUser: message.forwardedFromUser,
      createdAt: message.createdAt.toISOString(),
      expiresAt: message.expiresAt?.toISOString() ?? null,
    })

    for (const env of createdEnvelopes) {
      io.to(`d:${env.toDeviceId}`).emit("envelope:new", {
        envelopeId: env.id,
        messageId: message.id,
        type: "MESSAGE",
        chatId: data.chatId,
        fromUserId: userId,
        fromDevice: deviceId,
        payload: env.payload,
      })
    }

    ack({
      ok: true,
      message: {
        id: message.id,
        seq: message.seq,
        createdAt: message.createdAt.toISOString(),
        expiresAt: message.expiresAt?.toISOString(),
      },
    })
  } catch (err) {
    console.error("[socket message:send]", err)
    ack({ ok: false, error: "Send failed" })
  }
}

async function handleDelivered(io: SkurfServer, socket: SkurfSocket, envelopeIds: string[]) {
  try {
    const { userId, deviceId } = socket.data
    if (!Array.isArray(envelopeIds) || envelopeIds.length === 0 || envelopeIds.length > 200) return
    const envelopes = await prisma.envelope.findMany({
      where: { id: { in: envelopeIds }, toUserId: userId, toDeviceId: deviceId, consumedAt: null },
      include: { message: true },
    })
    const bySender = new Map<string, { messageIds: string[]; chatId: string }>()
    for (const env of envelopes) {
      await prisma.envelope.update({ where: { id: env.id }, data: { consumedAt: new Date() } })
      if (!env.message) continue
      await prisma.messageReceipt.upsert({
        where: { messageId_userId: { messageId: env.messageId!, userId } },
        create: { messageId: env.messageId!, userId, deliveredAt: new Date() },
        update: { deliveredAt: new Date() },
      })
      const entry = bySender.get(env.fromUserId) ?? { messageIds: [], chatId: env.chatId ?? "" }
      if (env.messageId) entry.messageIds.push(env.messageId)
      bySender.set(env.fromUserId, entry)
    }
    for (const [sender, { messageIds, chatId }] of bySender) {
      io.to(`u:${sender}`).emit("receipt:update", {
        chatId,
        userId,
        messageIds,
        state: "delivered",
      })
    }
  } catch (err) {
    console.error("[socket receipt:delivered]", err)
  }
}

async function handleRead(io: SkurfServer, socket: SkurfSocket, data: { chatId: string; upToSeq: number }) {
  try {
    const { userId } = socket.data
    if (typeof data?.chatId !== "string" || typeof data.upToSeq !== "number") return
    const member = await prisma.chatMember.findUnique({ where: { chatId_userId: { chatId: data.chatId, userId } } })
    if (!member) return
    await prisma.chatMember.update({
      where: { id: member.id },
      data: { lastReadSeq: Math.max(member.lastReadSeq, data.upToSeq) },
    })
    const messages = await prisma.message.findMany({
      where: { chatId: data.chatId, seq: { lte: data.upToSeq }, senderId: { not: userId } },
      select: { id: true },
    })
    const now = new Date()
    await prisma.messageReceipt.updateMany({
      where: { messageId: { in: messages.map((m) => m.id) }, userId },
      data: { readAt: now },
    })
    socket.to(`c:${data.chatId}`).emit("receipt:update", {
      chatId: data.chatId,
      userId,
      upToSeq: data.upToSeq,
      state: "read",
    })
  } catch (err) {
    console.error("[socket receipt:read]", err)
  }
}

async function handleReaction(
  io: SkurfServer,
  socket: SkurfSocket,
  data: { messageId: string; emoji: string; on: boolean }
) {
  try {
    const { userId } = socket.data
    if (typeof data?.messageId !== "string" || typeof data.emoji !== "string") return
    const message = await prisma.message.findUnique({
      where: { id: data.messageId },
      include: { chat: { include: { members: { where: { userId } } } } },
    })
    if (!message || message.chat.members.length === 0) return
    if (data.on) {
      await prisma.reaction.upsert({
        where: { messageId_userId_emoji: { messageId: data.messageId, userId, emoji: data.emoji } },
        create: { messageId: data.messageId, userId, emoji: data.emoji },
        update: {},
      })
    } else {
      await prisma.reaction.deleteMany({ where: { messageId: data.messageId, userId, emoji: data.emoji } })
    }
    io.to(`c:${message.chatId}`).emit("reaction:update", {
      messageId: data.messageId,
      chatId: message.chatId,
      userId,
      emoji: data.emoji,
      on: data.on,
    })
  } catch (err) {
    console.error("[socket reaction:toggle]", err)
  }
}

async function handleEdit(
  io: SkurfServer,
  socket: SkurfSocket,
  data: Parameters<ClientToServerEvents["message:edit"]>[0],
  ack: Parameters<ClientToServerEvents["message:edit"]>[1]
) {
  try {
    const { userId, deviceId } = socket.data
    if (typeof data?.messageId !== "string") return ack({ ok: false, error: "Invalid" })
    const message = await prisma.message.findUnique({ where: { id: data.messageId } })
    if (!message || message.senderId !== userId || message.deletedForEveryone) {
      return ack({ ok: false, error: "Cannot edit" })
    }
    if (Date.now() - message.createdAt.getTime() > 15 * 60 * 1000) {
      return ack({ ok: false, error: "Edit window expired" })
    }
    const editedAt = new Date()
    if (typeof data.body === "string") {
      await prisma.message.update({ where: { id: message.id }, data: { body: data.body, editedAt } })
    } else if (Array.isArray(data.envelopes)) {
      const envelopes = data.envelopes
      await prisma.$transaction(async (tx) => {
        await tx.message.update({ where: { id: message.id }, data: { editedAt } })
        await tx.envelope.updateMany({
          where: { messageId: message.id, type: "MESSAGE", consumedAt: null },
          data: { consumedAt: new Date() },
        })
        for (const env of envelopes) {
          await tx.envelope.create({
            data: {
              type: "MESSAGE",
              chatId: message.chatId,
              messageId: message.id,
              fromUserId: userId,
              fromDevice: deviceId,
              toUserId: env.toUserId,
              toDeviceId: env.toDeviceId,
              payload: env.payload,
            },
          })
        }
      })
    } else {
      return ack({ ok: false, error: "Nothing to edit" })
    }
    io.to(`c:${message.chatId}`).emit("message:edited", {
      messageId: message.id,
      chatId: message.chatId,
      editedAt: editedAt.toISOString(),
    })
    ack({ ok: true })
  } catch (err) {
    console.error("[socket message:edit]", err)
    ack({ ok: false, error: "Edit failed" })
  }
}

async function handleDelete(
  io: SkurfServer,
  socket: SkurfSocket,
  data: { messageId: string; forEveryone: boolean }
) {
  try {
    const { userId } = socket.data
    if (typeof data?.messageId !== "string") return
    const message = await prisma.message.findUnique({ where: { id: data.messageId } })
    if (!message) return
    if (data.forEveryone) {
      if (message.senderId !== userId && !isAdminOf(userId, message.chatId)) return
      if (Date.now() - message.createdAt.getTime() > 24 * 3600 * 1000) return
      await prisma.message.update({
        where: { id: message.id },
        data: { deletedForEveryone: true, body: null, meta: null },
      })
      await prisma.envelope.deleteMany({ where: { messageId: message.id } })
      io.to(`c:${message.chatId}`).emit("message:deleted", {
        messageId: message.id,
        chatId: message.chatId,
        forEveryone: true,
      })
    } else {
      await prisma.messageDeletion.upsert({
        where: { messageId_userId: { messageId: message.id, userId } },
        create: { messageId: message.id, userId },
        update: {},
      })
      io.to(`u:${userId}`).emit("message:deleted", {
        messageId: message.id,
        chatId: message.chatId,
        forEveryone: false,
      })
    }
  } catch (err) {
    console.error("[socket message:delete]", err)
  }
}

async function isAdminOf(userId: string, chatId: string) {
  const m = await prisma.chatMember.findUnique({ where: { chatId_userId: { chatId, userId } } })
  return m?.role === "OWNER" || m?.role === "ADMIN"
}

async function handleCallRing(
  io: SkurfServer,
  socket: SkurfSocket,
  data: Parameters<ClientToServerEvents["call:ring"]>[0],
  ack: Parameters<ClientToServerEvents["call:ring"]>[1]
) {
  try {
    const { userId } = socket.data
    if (!data || typeof data.chatId !== "string") return ack({ ok: false, error: "Invalid" })
    const member = await prisma.chatMember.findUnique({
      where: { chatId_userId: { chatId: data.chatId, userId } },
      include: { user: true },
    })
    if (!member) return ack({ ok: false, error: "Not a member" })
    const call = await prisma.call.create({
      data: { chatId: data.chatId, initiatorId: userId, kind: data.kind },
    })
    const redis = getRedis()
    await redis.sadd(`call:${call.id}`, userId)
    await redis.expire(`call:${call.id}`, 3600)
    socket.to(`c:${data.chatId}`).emit("call:ring", {
      callId: call.id,
      chatId: data.chatId,
      kind: data.kind,
      fromUserId: userId,
      fromName: member.user.displayName,
    })
    ack({ ok: true, callId: call.id })
  } catch (err) {
    console.error("[socket call:ring]", err)
    ack({ ok: false, error: "Call failed" })
  }
}

async function handleCallAccept(io: SkurfServer, socket: SkurfSocket, data: { callId: string }) {
  try {
    const { userId } = socket.data
    if (typeof data?.callId !== "string") return
    const call = await prisma.call.findUnique({ where: { id: data.callId } })
    if (!call) return
    const redis = getRedis()
    await redis.sadd(`call:${call.id}`, userId)
    const participants = await redis.smembers(`call:${call.id}`)
    if (call.state === "RINGING") {
      await prisma.call.update({ where: { id: call.id }, data: { state: "ACTIVE" } })
    }
    io.to(`c:${call.chatId}`).emit("call:accepted", { callId: call.id, userId })
    io.to(`c:${call.chatId}`).emit("call:participants", { callId: call.id, participants })
  } catch (err) {
    console.error("[socket call:accept]", err)
  }
}

async function handleCallState(io: SkurfServer, callId: string | undefined, state: "DECLINED" | "ENDED") {
  try {
    if (typeof callId !== "string") return
    const call = await prisma.call.findUnique({ where: { id: callId } })
    if (!call) return
    await prisma.call.update({ where: { id: callId }, data: { state, endedAt: new Date() } })
    await getRedis().del(`call:${callId}`)
    io.to(`c:${call.chatId}`).emit(state === "ENDED" ? "call:ended" : "call:declined", { callId })
  } catch (err) {
    console.error("[socket call:state]", err)
  }
}

async function handleControlSend(
  io: SkurfServer,
  socket: SkurfSocket,
  data: Parameters<ClientToServerEvents["control:send"]>[0]
) {
  try {
    const { userId, deviceId } = socket.data
    if (!data || typeof data.toUserId !== "string" || typeof data.toDeviceId !== "string" || typeof data.payload !== "string")
      return
    const type = data.type === "EPOCH" ? "EPOCH" : data.type === "CONTROL" ? "CONTROL" : "MESSAGE"
    const env = await prisma.envelope.create({
      data: {
        type,
        chatId: typeof data.chatId === "string" ? data.chatId : null,
        fromUserId: userId,
        fromDevice: deviceId,
        toUserId: data.toUserId,
        toDeviceId: data.toDeviceId,
        payload: data.payload,
      },
    })
    io.to(`d:${data.toDeviceId}`).emit("envelope:new", {
      envelopeId: env.id,
      type,
      chatId: env.chatId ?? undefined,
      fromUserId: userId,
      fromDevice: deviceId,
      payload: env.payload,
    })
  } catch (err) {
    console.error("[socket control:send]", err)
  }
}

export async function sweepExpired(prismaClient: typeof prisma) {
  const now = new Date()
  try {
    await prismaClient.message.deleteMany({ where: { expiresAt: { lt: now } } })
    await prismaClient.envelope.deleteMany({
      where: { consumedAt: { lt: new Date(Date.now() - 7 * 24 * 3600 * 1000) } },
    })
    await prismaClient.envelope.deleteMany({ where: { type: { not: "MESSAGE" }, createdAt: { lt: new Date(Date.now() - 30 * 24 * 3600 * 1000) } } })
    await prismaClient.call.deleteMany({ where: { endedAt: { lt: new Date(Date.now() - 24 * 3600 * 1000) } } })
  } catch (err) {
    console.error("[sweeper]", err)
  }
}
