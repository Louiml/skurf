"use client"

import { create } from "zustand"
import type { ChatPayload } from "@/lib/crypto/protocol"
import { GET, POST, PATCH, PUT, DELETE } from "./api"
import { deviceId } from "./api"
import { connectSocket, getSocket, type SkurfSocket } from "./socket"
import * as e2ee from "./e2ee"
import { db, getMeta, setMeta } from "./dexie"
import type { ServerToClientEvents } from "@/lib/socket/events"

export interface Member {
  userId: string
  role: "OWNER" | "ADMIN" | "MEMBER" | "SUBSCRIBER"
  lastReadSeq: number
  user: { id: string; username: string; displayName: string; identityKey: string; lastSeenAt?: string | null; avatarMediaId?: string | null }
}

export interface Chat {
  id: string
  type: "DIRECT" | "GROUP" | "CHANNEL" | "SAVED"
  title?: string | null
  description?: string | null
  handle?: string | null
  isPublic?: boolean
  disappearAfter?: number | null
  lastMessageAt: string
  role: "OWNER" | "ADMIN" | "MEMBER" | "SUBSCRIBER"
  lastReadSeq: number
  pinned: boolean
  archived: boolean
  seqCounter: number
  members: Member[]
  preview?: { text: string; at: string } | null
  folderIds?: string[]
}

export interface Message {
  id: string
  chatId: string
  senderId: string
  type: string
  seq: number
  createdAt: string
  editedAt?: string | null
  expiresAt?: string | null
  replyToId?: string | null
  replyPreview?: { senderId: string; text: string } | null
  forwarded?: boolean
  state: "pending" | "sent" | "delivered" | "read"
  payload: ChatPayload | null
  reactions: Array<{ userId: string; emoji: string }>
  poll?: { allowMultiple: boolean; anonymous: boolean; closed: boolean; counts: Array<{ optionIndex: number; count: number }>; totalVoters: number } | null
  deletedForEveryone?: boolean
  error?: string | null
}

export interface Me {
  id: string
  username: string
  displayName: string
  bio?: string | null
  identityKey: string
  lastSeenVisibility: "EVERYONE" | "CONTACTS" | "NONE"
  readReceiptsEnabled: boolean
}

export interface Folder {
  id: string
  name: string
  emoji?: string | null
  position: number
  chatIds: string[]
}

interface Store {
  ready: boolean
  me: Me | null
  savedChatId: string | null
  chats: Chat[]
  folders: Folder[]
  messagesByChat: Record<string, Message[]>
  presence: Record<string, { online: boolean; lastSeenAt?: string | null }>
  typing: Record<string, Record<string, number>>
  activeChatId: string | null
  socket: SkurfSocket | null
  locked: boolean
  hasPasscode: boolean
  activeReplyTo: Message | null
  setActiveReply: (m: Message | null) => void
  init: () => Promise<void>
  setActiveChat: (chatId: string | null) => void
  loadMessages: (chatId: string, opts?: { before?: boolean }) => Promise<void>
  sendMessage: (chatId: string, payload: ChatPayload, opts?: { replyToId?: string; forwardedFrom?: { chatId: string; userId: string } }) => Promise<void>
  markRead: (chatId: string) => Promise<void>
  toggleReaction: (messageId: string, emoji: string) => Promise<void>
  editMessage: (messageId: string, chatId: string, newText: string) => Promise<void>
  deleteMessage: (messageId: string, chatId: string, forEveryone: boolean) => Promise<void>
  forwardMessage: (message: Message, targetChatIds: string[]) => Promise<void>
  createDirect: (username: string) => Promise<string>
  createGroup: (title: string, usernames: string[], description?: string) => Promise<string>
  createChannel: (title: string, handle: string, description?: string) => Promise<string>
  addMembers: (chatId: string, usernames: string[]) => Promise<void>
  leaveChat: (chatId: string) => Promise<void>
  setDisappearing: (chatId: string, seconds: number | null) => Promise<void>
  saveDraft: (chatId: string, text: string) => Promise<void>
  loadDraft: (chatId: string) => Promise<string | null>
  createFolder: (name: string, emoji?: string) => Promise<void>
  deleteFolder: (folderId: string) => Promise<void>
  assignFolderChats: (folderId: string, chatIds: string[]) => Promise<void>
  vote: (messageId: string, optionIndex: number) => Promise<void>
  setPasscode: (has: boolean) => void
  setLocked: (locked: boolean) => void
  refreshChats: () => Promise<void>
}

function payloadPreview(p: ChatPayload | null): string {
  if (!p) return "🔒 Encrypted message"
  switch (p.t) {
    case "text": return p.text ?? ""
    case "media": return "📷 Photo"
    case "file": return `📎 ${p.fileName ?? "File"}`
    case "voice": return "🎙 Voice message"
    case "location": return "📍 Location"
    case "poll": return `📊 ${p.question ?? "Poll"}`
    case "call": return `📞 Call`
    default: return "Message"
  }
}

export const useStore = create<Store>((set, get) => ({
  ready: false,
  me: null,
  savedChatId: null,
  chats: [],
  folders: [],
  messagesByChat: {},
  presence: {},
  typing: {},
  activeChatId: null,
  socket: null,
  locked: false,
  hasPasscode: false,
  activeReplyTo: null,

  setActiveReply(m) {
    set({ activeReplyTo: m })
  },

  setPasscode: (has) => set({ hasPasscode: has }),
  setLocked: (locked) => set({ locked }),

  async init() {
    try {
      const meRes = await GET<{ user: Me; devices: { id: string }[]; folders: { id: string; name: string; emoji: string | null; position: number }[]; savedChatId: string | null }>("/api/me")
      setMeta("userId", meRes.user.id)
      localStorage.setItem("skurf:userId", meRes.user.id)
      const hasDevice = await e2ee.hasLocalDevice()
      if (!hasDevice) {
        await e2ee.initDevice(`${navigator.platform || "Web"} browser`, "web")
      } else {
        await e2ee.replenishPreKeys()
      }
      const socket = await connectSocket()
      bindSocket(socket, set, get)
      set({ me: meRes.user, savedChatId: meRes.savedChatId, socket, ready: true })
      await get().refreshChats()
      const pending = await GET<{ envelopes: Array<{ id: string; messageId: string | null; type: string; chatId: string | null; fromUserId: string; fromDevice: string; payload: string }> }>("/api/control/pending")
      const ids: string[] = []
      for (const env of pending.envelopes) {
        await processEnvelope(env.id, env.messageId, env.type, env.chatId, env.fromUserId, env.fromDevice, env.payload, set, get)
        ids.push(env.id)
      }
      if (ids.length > 0) socket.emit("receipt:delivered", { envelopeIds: ids })
      const passcode = await db.passcode.get("main")
      set({ hasPasscode: !!passcode, locked: !!passcode })
    } catch (err) {
      console.error("init failed", err)
      throw err
    }
  },

  async refreshChats() {
    const res = await GET<{ chats: Chat[] }>("/api/chats")
    const folderRes = await GET<{ folders: Folder[] }>("/api/folders")
    const existing = get().chats
    const chats = res.chats.map((c) => ({
      ...c,
      preview: existing.find((e) => e.id === c.id)?.preview ?? null,
      folderIds: folderRes.folders.filter((f) => f.chatIds.includes(c.id)).map((f) => f.id),
    }))
    set({ chats, folders: folderRes.folders })
    const userIds = new Set<string>()
    for (const c of chats) {
      if (c.type === "DIRECT" || c.type === "SAVED") c.members.forEach((m) => m.userId !== get().me?.id && userIds.add(m.userId))
    }
    if (userIds.size > 0) {
      const pres = await POST<{ presence: Array<{ userId: string; online: boolean; lastSeenAt: string | null }> }>("/api/presence", { userIds: [...userIds] })
      const presence: Record<string, { online: boolean; lastSeenAt?: string | null }> = {}
      for (const p of pres.presence) presence[p.userId] = { online: p.online, lastSeenAt: p.lastSeenAt }
      set((s) => ({ presence: { ...s.presence, ...presence } }))
    }
  },

  setActiveChat(chatId) {
    set({ activeChatId: chatId })
  },

  async loadMessages(chatId, opts) {
    const msgs = get().messagesByChat[chatId] ?? []
    const query = opts?.before && msgs.length > 0 ? `?beforeSeq=${msgs[0].seq}` : msgs.length > 0 ? `?afterSeq=${msgs[msgs.length - 1].seq}` : ""
    const res = await GET<{
      messages: Array<{
        id: string; chatId: string; senderId: string; senderDeviceId: string; type: string; seq: number
        body: string | null; meta: string | null; replyTo: { id: string; senderId: string; type: string; seq: number } | null
        forwardedFromChat: string | null; forwardedFromUser: string | null
        editedAt: string | null; deletedForEveryone: boolean; expiresAt: string | null; createdAt: string
        reactions: Array<{ userId: string; emoji: string }>
        receipts: Array<{ userId: string; delivered: boolean; read: boolean }>
        poll: { allowMultiple: boolean; anonymous: boolean; closed: boolean } | null
        envelope: { id: string; payload: string } | null
      }>
      pollCounts: Array<{ messageId: string; optionIndex: number; count: number }>
      lastReadSeq: number
    }>(`/api/chats/${chatId}/messages${query}`)

    const chat = get().chats.find((c) => c.id === chatId)
    const out: Message[] = []
    const consumedIds: string[] = []
    for (const m of res.messages) {
      consumedIds.push(m.envelope?.id ?? "")
      let payload: ChatPayload | null = null
      if (m.deletedForEveryone) {
        out.push(decorated(m, null, get, res.pollCounts))
        continue
      }
      if (m.envelope) {
        try {
          payload = (await e2ee.decryptFromDevice(m.senderId, m.senderDeviceId, m.envelope.payload)) as ChatPayload
        } catch {
          payload = null
        }
      } else if (m.body && (chat?.type === "GROUP" || chat?.type === "SAVED")) {
        try {
          payload = await e2ee.decryptGroupMessage(chatId, m.meta, m.body)
        } catch {
          payload = null
        }
      } else if (m.body && chat?.type === "CHANNEL") {
        try {
          payload = JSON.parse(m.body) as ChatPayload
        } catch {
          payload = null
        }
      }
      const msg = decorated(m, payload, get, res.pollCounts)
      if (m.replyTo) {
        const parent = out.find((x) => x.id === m.replyTo!.id) ?? get().messagesByChat[chatId]?.find((x) => x.id === m.replyTo!.id)
        msg.replyPreview = parent ? { senderId: m.replyTo.senderId, text: payloadPreview(parent.payload) } : null
        msg.replyToId = m.replyTo.id
      }
      out.push(msg)
      if (payload) {
        await db.messages.put({ id: m.id, chatId, senderId: m.senderId, type: m.type, seq: m.seq, createdAt: m.createdAt, editedAt: m.editedAt, expiresAt: m.expiresAt, payloadJson: JSON.stringify(payload), epoch: m.meta ? (JSON.parse(m.meta).e ?? null) : null })
      }
    }
    if (m_exists(consumedIds)) {
      get().socket?.emit("receipt:delivered", { envelopeIds: consumedIds.filter(Boolean) })
    }
    set((s) => {
      if (opts?.before) {
        const merged = [...out, ...(s.messagesByChat[chatId] ?? [])]
        return { messagesByChat: { ...s.messagesByChat, [chatId]: dedupe(merged) } }
      }
      const merged = [...(s.messagesByChat[chatId] ?? []), ...out]
      return { messagesByChat: { ...s.messagesByChat, [chatId]: dedupe(merged) } }
    })
    void get().markRead(chatId)
  },

  async markRead(chatId) {
    const msgs = get().messagesByChat[chatId] ?? []
    if (msgs.length === 0) return
    const me = get().me
    const maxSeq = Math.max(...msgs.map((m) => m.seq))
    const unread = msgs.some((m) => m.senderId !== me?.id && m.seq > (get().chats.find((c) => c.id === chatId)?.lastReadSeq ?? 0))
    get().socket?.emit("receipt:read", { chatId, upToSeq: maxSeq })
    if (unread) {
      set((s) => ({
        chats: s.chats.map((c) => (c.id === chatId ? { ...c, lastReadSeq: maxSeq } : c)),
      }))
    }
  },

  async sendMessage(chatId, payload, opts) {
    const me = get().me
    if (!me) return
    const chat = get().chats.find((c) => c.id === chatId)
    if (!chat) return
    const tempId = `temp-${Date.now()}-${Math.random().toString(36).slice(2)}`
    const optimistic: Message = {
      id: tempId,
      chatId,
      senderId: me.id,
      type: payload.t.toUpperCase(),
      seq: -1,
      createdAt: new Date().toISOString(),
      replyToId: opts?.replyToId,
      forwarded: !!opts?.forwardedFrom,
      state: "pending",
      payload,
      reactions: [],
      poll: payload.t === "poll" ? { allowMultiple: !!payload.allowMultiple, anonymous: !!payload.anonymous, closed: false, counts: [], totalVoters: 0 } : null,
    }
    set((s) => ({ messagesByChat: { ...s.messagesByChat, [chatId]: [...(s.messagesByChat[chatId] ?? []), optimistic] } }))

    try {
      let body: string | undefined
      let meta: string | undefined
      let envelopes: Array<{ toUserId: string; toDeviceId: string; payload: string }> | undefined
      let poll: { allowMultiple: boolean; anonymous: boolean; optionCount: number } | undefined

      if (chat.type === "CHANNEL") {
        body = JSON.stringify(payload)
      } else if (chat.type === "GROUP") {
        const res = await e2ee.encryptGroupMessage(chatId, payload)
        if (!res) throw new Error("No group key — waiting for key distribution")
        body = res.body
        meta = res.meta
      } else {
        const targets: Array<{ userId: string; deviceId: string }> = []
        for (const member of chat.members) {
          const { devices } = await e2ee.fetchBundle(member.userId)
          for (const d of devices) targets.push({ userId: member.userId, deviceId: d.deviceId })
        }
        envelopes = []
        for (const t of targets) {
          if (t.userId === me.id && t.deviceId === deviceId()) continue
          envelopes.push({ toUserId: t.userId, toDeviceId: t.deviceId, payload: await e2ee.encryptForDevice(t.userId, t.deviceId, payload) })
        }
      }
      if (payload.t === "poll") {
        poll = { allowMultiple: !!payload.allowMultiple, anonymous: !!payload.anonymous, optionCount: payload.options?.length ?? 0 }
      }

      const res = await new Promise<{ ok: boolean; error?: string; message?: { id: string; seq: number; createdAt: string; expiresAt?: string } }>((resolve) => {
        get().socket?.emit("message:send", {
          chatId,
          type: payload.t.toUpperCase(),
          body,
          meta,
          replyToId: opts?.replyToId,
          forwardedFromChat: opts?.forwardedFrom?.chatId,
          forwardedFromUser: opts?.forwardedFrom?.userId,
          envelopes,
          poll,
        }, (r) => resolve(r))
      })
      if (!res.ok || !res.message) throw new Error(res.error ?? "Send failed")
      const sent = res.message
      set((s) => ({
        messagesByChat: {
          ...s.messagesByChat,
          [chatId]: (s.messagesByChat[chatId] ?? []).map((m) =>
            m.id === tempId ? { ...m, id: sent.id, seq: sent.seq, createdAt: sent.createdAt, expiresAt: sent.expiresAt, state: "sent" } : m
          ),
        },
        chats: s.chats.map((c) => (c.id === chatId ? { ...c, preview: { text: payloadPreview(payload), at: new Date().toISOString() }, lastMessageAt: new Date().toISOString() } : c)),
      }))
      if (payload.t === "poll") {
        await db.messages.put({ id: sent.id, chatId, senderId: me.id, type: "POLL", seq: sent.seq, createdAt: sent.createdAt, payloadJson: JSON.stringify(payload), expiresAt: sent.expiresAt })
      }
    } catch (err) {
      set((s) => ({
        messagesByChat: {
          ...s.messagesByChat,
          [chatId]: (s.messagesByChat[chatId] ?? []).map((m) => (m.id === tempId ? { ...m, state: "sent", error: (err as Error).message } : m)),
        },
      }))
    }
  },

  async toggleReaction(messageId, emoji) {
    const found = findMessage(get, messageId)
    if (!found) return
    const mine = found.msg.reactions.find((r) => r.userId === get().me?.id && r.emoji === emoji)
    get().socket?.emit("reaction:toggle", { messageId, emoji, on: !mine })
    set((s) => {
      const list = s.messagesByChat[found.chatId] ?? []
      return {
        messagesByChat: {
          ...s.messagesByChat,
          [found.chatId]: list.map((m) => {
            if (m.id !== messageId) return m
            const without = m.reactions.filter((r) => !(r.userId === s.me?.id && r.emoji === emoji))
            return { ...m, reactions: mine ? without : [...without, { userId: s.me!.id, emoji }] }
          }),
        },
      }
    })
  },

  async editMessage(messageId, chatId, newText) {
    const msg = get().messagesByChat[chatId]?.find((m) => m.id === messageId)
    if (!msg?.payload) return
    const payload: ChatPayload = { ...msg.payload, t: "text", text: newText }
    const chat = get().chats.find((c) => c.id === chatId)
    if (!chat) return
    let body: string | undefined
    let envelopes: Array<{ toUserId: string; toDeviceId: string; payload: string }> | undefined
    if (chat.type === "CHANNEL") {
      body = JSON.stringify(payload)
    } else if (chat.type === "GROUP") {
      const res = await e2ee.encryptGroupMessage(chatId, payload)
      body = res?.body
    } else {
      envelopes = []
      for (const member of chat.members) {
        const { devices } = await e2ee.fetchBundle(member.userId)
        for (const d of devices) {
          if (member.userId === get().me?.id && d.deviceId === deviceId()) continue
          envelopes.push({ toUserId: member.userId, toDeviceId: d.deviceId, payload: await e2ee.encryptForDevice(member.userId, d.deviceId, payload) })
        }
      }
    }
    await new Promise<void>((resolve) => {
      get().socket?.emit("message:edit", { messageId, body, envelopes }, () => resolve())
    })
    set((s) => ({
      messagesByChat: {
        ...s.messagesByChat,
        [chatId]: (s.messagesByChat[chatId] ?? []).map((m) => (m.id === messageId ? { ...m, payload, editedAt: new Date().toISOString() } : m)),
      },
    }))
  },

  async deleteMessage(messageId, chatId, forEveryone) {
    get().socket?.emit("message:delete", { messageId, forEveryone })
    set((s) => ({
      messagesByChat: {
        ...s.messagesByChat,
        [chatId]: (s.messagesByChat[chatId] ?? []).map((m) =>
          m.id === messageId ? (forEveryone ? { ...m, deletedForEveryone: true, payload: null } : m) : m
        ),
      },
      chats: s.chats,
    }))
    if (!forEveryone) {
      set((s) => ({ chats: s.chats }))
    }
  },

  async forwardMessage(message, targetChatIds) {
    for (const chatId of targetChatIds) {
      const me = get().me
      await get().sendMessage(chatId, message.payload!, { forwardedFrom: { chatId: message.chatId, userId: message.senderId === me?.id ? me.id : message.senderId } })
    }
  },

  async createDirect(username) {
    const res = await POST<{ chatId: string; existing: boolean }>("/api/chats", { type: "DIRECT", memberUsernames: [username] })
    if (!res.existing) await get().refreshChats()
    return res.chatId
  },

  async createGroup(title, usernames, description) {
    const res = await POST<{ chatId: string }>("/api/chats", { type: "GROUP", title, memberUsernames: usernames, description })
    await get().refreshChats()
    const chat = get().chats.find((c) => c.id === res.chatId)
    const { epoch, seed } = await e2ee.createEpoch(res.chatId)
    await e2ee.distributeEpoch(res.chatId, epoch, seed, chat?.members.map((m) => m.userId) ?? [])
    return res.chatId
  },

  async createChannel(title, handle, description) {
    const res = await POST<{ chatId: string }>("/api/chats", { type: "CHANNEL", title, handle, description, isPublic: true })
    await get().refreshChats()
    return res.chatId
  },

  async addMembers(chatId, usernames) {
    await PATCH(`/api/chats/${chatId}?action=members`, { usernames })
    const res = await GET<{ members: Member[] }>(`/api/chats/${chatId}`)
    const before = new Set(get().chats.find((c) => c.id === chatId)?.members.map((m) => m.userId) ?? [])
    const all = [...new Set([...res.members.map((m) => m.userId)])]
    const chat = get().chats.find((c) => c.id === chatId)
    if (chat && (chat.type === "GROUP" || chat.type === "SAVED")) {
      const { epoch, seed } = await e2ee.createEpoch(chatId)
      await e2ee.distributeEpoch(chatId, epoch, seed, all)
    }
    void before
    await get().refreshChats()
  },

  async leaveChat(chatId) {
    await PATCH(`/api/chats/${chatId}?action=leave`, {})
    set((s) => ({ chats: s.chats.filter((c) => c.id !== chatId), messagesByChat: Object.fromEntries(Object.entries(s.messagesByChat).filter(([k]) => k !== chatId)) }))
  },

  async setDisappearing(chatId, seconds) {
    await PATCH(`/api/chats/${chatId}`, { disappearAfter: seconds })
    set((s) => ({ chats: s.chats.map((c) => (c.id === chatId ? { ...c, disappearAfter: seconds } : c)) }))
  },

  async saveDraft(chatId, text) {
    if (!text.trim()) {
      await DELETE(`/api/chats/${chatId}/draft`)
      return
    }
    const sealed = JSON.stringify({ t: "draft", text })
    await PUT(`/api/chats/${chatId}/draft`, { content: sealed })
  },

  async loadDraft(chatId) {
    try {
      const res = await GET<{ draft: string | null }>(`/api/chats/${chatId}/draft`)
      if (!res.draft) return null
      const parsed = JSON.parse(res.draft) as { t?: string; text?: string }
      return parsed.t === "draft" ? (parsed.text ?? null) : null
    } catch {
      return null
    }
  },

  async createFolder(name, emoji) {
    await POST("/api/folders", { name, emoji, position: get().folders.length })
    const res = await GET<{ folders: Folder[] }>("/api/folders")
    set({ folders: res.folders })
  },

  async deleteFolder(folderId) {
    await DELETE(`/api/folders?id=${folderId}`)
    set((s) => ({ folders: s.folders.filter((f) => f.id !== folderId) }))
  },

  async assignFolderChats(folderId, chatIds) {
    await PUT(`/api/folders/${folderId}/chats`, { chatIds })
    set((s) => ({
      folders: s.folders.map((f) => (f.id === folderId ? { ...f, chatIds } : f)),
      chats: s.chats.map((c) => ({
        ...c,
        folderIds: chatIds.includes(c.id) ? [...new Set([...(c.folderIds ?? []), folderId])] : (c.folderIds ?? []).filter((id) => id !== folderId),
      })),
    }))
  },

  async vote(messageId, optionIndex) {
    await POST(`/api/messages/${messageId}/vote`, { optionIndex })
  },
}))

function m_exists(ids: string[]) {
  return ids.filter(Boolean).length > 0
}

function dedupe(list: Message[]) {
  const map = new Map<string, Message>()
  for (const m of list) map.set(m.id, m)
  return [...map.values()].sort((a, b) => (a.seq === -1 ? 1 : b.seq === -1 ? -1 : a.seq - b.seq))
}

function findMessage(get: () => Store, messageId: string): { chatId: string; msg: Message } | null {
  for (const [chatId, list] of Object.entries(get().messagesByChat)) {
    const msg = list.find((m) => m.id === messageId)
    if (msg) return { chatId, msg }
  }
  return null
}

type RawMessage = Parameters<ReturnType<typeof makeDecorator>>[0]
function makeDecorator(get: () => Store) {
  return (m: any, payload: ChatPayload | null, pollCounts: Array<{ messageId: string; optionIndex: number; count: number }>): Message => {
    const me = get().me
    const isMine = m.senderId === me?.id
    const receipts = m.receipts as Array<{ userId: string; delivered: boolean; read: boolean }>
    const others = (receipts ?? []).filter((r) => r.userId !== me?.id)
    const state: Message["state"] = !isMine
      ? "sent"
      : others.length === 0
        ? "sent"
        : others.every((r) => r.read)
          ? "read"
          : others.some((r) => r.delivered)
            ? "delivered"
            : "sent"
    const counts = pollCounts.filter((p) => p.messageId === m.id).map((p) => ({ optionIndex: p.optionIndex, count: p.count }))
    return {
      id: m.id,
      chatId: m.chatId,
      senderId: m.senderId,
      type: m.type,
      seq: m.seq,
      createdAt: m.createdAt,
      editedAt: m.editedAt,
      expiresAt: m.expiresAt,
      replyToId: m.replyToId,
      forwarded: !!m.forwardedFromChat,
      state,
      payload,
      reactions: m.reactions ?? [],
      deletedForEveryone: m.deletedForEveryone,
      poll: m.poll ? { ...m.poll, counts, totalVoters: 0 } : null,
    }
  }
}

function decorated(m: any, payload: ChatPayload | null, get: () => Store, pollCounts: Array<{ messageId: string; optionIndex: number; count: number }>): Message {
  return makeDecorator(get)(m, payload, pollCounts)
}

async function processEnvelope(
  envelopeId: string,
  messageId: string | null,
  type: string,
  chatId: string | null,
  fromUserId: string,
  fromDevice: string,
  payloadJson: string,
  set: (fn: (s: Store) => Partial<Store>) => void,
  get: () => Store
): Promise<ChatPayload | Record<string, unknown> | null> {
  try {
    const payload = await e2ee.decryptFromDevice(fromUserId, fromDevice, payloadJson) as ChatPayload
    if (type === "EPOCH" && payload && (payload as any).t === "epoch") {
      const e = payload as any
      await e2ee.storeEpoch(e.chatId, e.epoch, fromB64any(e.seed))
      return payload
    }
    if (type === "MESSAGE" && messageId && chatId) {
      const raw = { id: messageId, chatId, senderId: fromUserId, senderDeviceId: fromDevice, type: payload.t.toUpperCase(), seq: 0, createdAt: new Date().toISOString(), reactions: [], receipts: [] }
      const msg = decorated({ ...raw, createdAt: new Date().toISOString() }, payload, get, [])
      set((s) => ({
        messagesByChat: {
          ...s.messagesByChat,
          [chatId]: dedupe([...(s.messagesByChat[chatId] ?? []), { ...msg, seq: (s.messagesByChat[chatId]?.length ?? 0) + 1000 }]),
        },
        chats: s.chats.map((c) => (c.id === chatId ? { ...c, preview: { text: payloadPreview(payload), at: new Date().toISOString() }, lastMessageAt: new Date().toISOString() } : c)),
      }))
    }
    return payload
  } catch (err) {
    console.error("envelope processing failed", err)
    return null
  }
}

function fromB64any(s: string): Uint8Array {
  const bin = atob(s)
  const out = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i)
  return out
}

function bindSocket(socket: SkurfSocket, set: any, get: () => Store) {
  const on = <K extends keyof ServerToClientEvents>(event: K, handler: ServerToClientEvents[K]) => {
    socket.on(event, handler as any)
  }

  setInterval(() => socket.emit("presence:heartbeat"), 25_000)

  on("envelope:new", (data) => {
    void (async () => {
      await processEnvelope(data.envelopeId, data.messageId ?? null, data.type, data.chatId ?? null, data.fromUserId, data.fromDevice, data.payload, set, get)
      if (data.type === "MESSAGE" && data.envelopeId) {
        socket.emit("receipt:delivered", { envelopeIds: [data.envelopeId] })
      }
      if (data.type === "EPOCH") {
        const chatId = data.chatId
        const active = get().activeChatId
        if (chatId && active) await get().loadMessages(chatId)
      }
    })()
  })

  on("message:new", (data) => {
    void (async () => {
      const chat = get().chats.find((c) => c.id === data.chatId)
      if (!chat) {
        await get().refreshChats()
      }
      if (chat && (chat.type === "GROUP" || chat.type === "SAVED") && data.body) {
        let payload: ChatPayload | null = null
        try {
          payload = await e2ee.decryptGroupMessage(data.chatId, data.meta ?? null, data.body!)
        } catch {
          payload = null
        }
        if (!payload && data.chatId) {
          socket.emit("group:epoch-missing", { chatId: data.chatId, epoch: data.meta ? JSON.parse(data.meta).e : 0 })
          set((s: any) => ({
            messagesByChat: { ...s.messagesByChat, [data.chatId]: dedupe([...(s.messagesByChat[data.chatId] ?? []), { id: data.id, chatId: data.chatId, senderId: data.senderId, type: data.type, seq: data.seq, createdAt: data.createdAt, expiresAt: data.expiresAt, state: "sent", payload: null, reactions: [] }]) },
          }))
          return
        }
        const raw = { ...data, reactions: [], receipts: [] }
        const msg = decorated(raw, payload, get, [])
        set((s: any) => ({
          messagesByChat: { ...s.messagesByChat, [data.chatId]: dedupe([...(s.messagesByChat[data.chatId] ?? []), msg]) },
          chats: s.chats.map((c: any) => (c.id === data.chatId ? { ...c, preview: { text: payloadPreview(payload), at: data.createdAt }, lastMessageAt: data.createdAt } : c)),
        }))
      } else if (chat?.type === "CHANNEL" && data.body) {
        let payload: ChatPayload | null = null
        try {
          payload = JSON.parse(data.body!) as ChatPayload
        } catch {
          payload = null
        }
        const raw = { ...data, reactions: [], receipts: [] }
        const msg = decorated(raw, payload, get, [])
        set((s: any) => ({
          messagesByChat: { ...s.messagesByChat, [data.chatId]: dedupe([...(s.messagesByChat[data.chatId] ?? []), msg]) },
          chats: s.chats.map((c: any) => (c.id === data.chatId ? { ...c, preview: { text: payloadPreview(payload), at: data.createdAt }, lastMessageAt: data.createdAt } : c)),
        }))
      }
      const active = get().activeChatId
      if (active === data.chatId) {
        await get().markRead(data.chatId)
      }
    })()
  })

  on("message:edited", (data) => {
    void (async () => {
      const active = get().activeChatId
      if (active === data.chatId) await get().loadMessages(data.chatId)
    })()
  })

  on("message:deleted", (data) => {
    set((s: any) => ({
      messagesByChat: {
        ...s.messagesByChat,
        [data.chatId]: (s.messagesByChat[data.chatId] ?? []).map((m: Message) =>
          m.id === data.messageId ? (data.forEveryone ? { ...m, deletedForEveryone: true, payload: null } : m) : m
        ),
      },
    }))
    if (!data.forEveryone) {
      set((s: any) => ({
        messagesByChat: {
          ...s.messagesByChat,
          [data.chatId]: (s.messagesByChat[data.chatId] ?? []).filter((m: Message) => m.id !== data.messageId),
        },
      }))
    }
  })

  on("receipt:update", (data) => {
    const me = get().me
    set((s: any) => {
      const lists = { ...s.messagesByChat }
      for (const [chatId, rawList] of Object.entries(lists)) {
        const list = rawList as Message[]
        if (data.messageIds) {
          lists[chatId] = list.map((m: Message) =>
            data.messageIds!.includes(m.id) && m.senderId === me?.id
              ? { ...m, state: data.state === "read" ? "read" : m.state === "read" ? "read" : "delivered" }
              : m
          )
        } else if (data.upToSeq !== undefined && data.chatId === chatId) {
          lists[chatId] = list.map((m: Message) =>
            m.senderId === me?.id && m.seq <= data.upToSeq! && m.senderId !== data.userId ? { ...m, state: "read" } : m
          )
        }
      }
      return { messagesByChat: lists }
    })
  })

  on("reaction:update", (data) => {
    set((s: any) => ({
      messagesByChat: {
        ...s.messagesByChat,
        [data.chatId]: (s.messagesByChat[data.chatId] ?? []).map((m: Message) => {
          if (m.id !== data.messageId) return m
          const without = m.reactions.filter((r) => !(r.userId === data.userId && r.emoji === data.emoji))
          return { ...m, reactions: data.on ? [...without, { userId: data.userId, emoji: data.emoji }] : without }
        }),
      },
    }))
  })

  on("typing:update", (data) => {
    if (!data.isTyping) {
      set((s: any) => {
        const t = { ...s.typing }
        if (t[data.chatId]) {
          delete t[data.chatId][data.userId]
          if (Object.keys(t[data.chatId]).length === 0) delete t[data.chatId]
        }
        return { typing: t }
      })
      return
    }
    set((s: any) => ({ typing: { ...s.typing, [data.chatId]: { ...(s.typing[data.chatId] ?? {}), [data.userId]: Date.now() } } }))
    setTimeout(() => {
      set((s: any) => {
        const t = { ...s.typing }
        if (t[data.chatId]?.[data.userId] && Date.now() - t[data.chatId][data.userId] > 4500) {
          delete t[data.chatId][data.userId]
        }
        return { typing: t }
      })
    }, 5000)
  })

  on("presence:update", (data) => {
    set((s: any) => ({ presence: { ...s.presence, [data.userId]: { online: data.online, lastSeenAt: data.lastSeenAt ?? s.presence[data.userId]?.lastSeenAt ?? null } } }))
  })

  on("chat:new", (data) => {
    void get().refreshChats()
  })

  on("chat:members-changed", (data) => {
    void (async () => {
      await get().refreshChats()
      if (data.epochBump) {
        const chat = get().chats.find((c) => c.id === data.chatId)
        if (chat && (chat.type === "GROUP" || chat.type === "SAVED") && addedByUs(get, data)) {
          const { epoch, seed } = await e2ee.createEpoch(data.chatId)
          await e2ee.distributeEpoch(data.chatId, epoch, seed, chat.members.map((m) => m.userId))
        }
      }
    })()
  })

  on("group:epoch-request", (data) => {
    void (async () => {
      const epoch = await e2ee.getLatestEpoch(data.chatId)
      if (epoch && epoch.epoch >= data.epoch) {
        try {
          const payloadJson = await e2ee.encryptForDevice(data.fromUserId, data.fromDevice, { t: "epoch", chatId: data.chatId, epoch: epoch.epoch, seed: b64from(seedBytes(epoch.seed)) })
          await POST("/api/control/send", { toUserId: data.fromUserId, toDeviceId: data.fromDevice, payload: payloadJson, type: "EPOCH", chatId: data.chatId })
        } catch {}
      }
    })()
  })

  on("poll:update", (data) => {
    set((s: any) => ({
      messagesByChat: {
        ...s.messagesByChat,
        ...Object.fromEntries(
          Object.entries(s.messagesByChat).map(([chatId, list]) => [
            chatId,
            (list as Message[]).map((m) =>
              m.id === data.messageId && m.poll
                ? { ...m, poll: { ...m.poll, counts: data.counts, totalVoters: data.totalVoters } }
                : m
            ),
          ])
        ),
      },
    }))
  })}

function addedByUs(get: () => Store, data: { added: string[]; removed: string[] }): boolean {
  return data.added.length > 0
}

function b64from(bytes: Uint8Array): string {
  let s = ""
  for (const b of bytes) s += String.fromCharCode(b)
  return btoa(s)
}

function seedBytes(seed: Uint8Array): Uint8Array {
  return seed
}
