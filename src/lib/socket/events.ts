export type EnvelopeType = "MESSAGE" | "CONTROL" | "EPOCH"

export interface ServerToClientEvents {
  "message:new": (data: MessageNewEvent) => void
  "message:edited": (data: { messageId: string; chatId: string; editedAt: string; body?: string; meta?: string }) => void
  "message:deleted": (data: { messageId: string; chatId: string; forEveryone: boolean }) => void
  "envelope:new": (data: { envelopeId: string; messageId?: string | null; type: EnvelopeType; chatId?: string; fromUserId: string; fromDevice: string; payload: string }) => void
  "receipt:update": (data: { chatId: string; userId: string; upToSeq?: number; messageIds?: string[]; state: "delivered" | "read" }) => void
  "reaction:update": (data: { messageId: string; chatId: string; userId: string; emoji: string; on: boolean }) => void
  "typing:update": (data: { chatId: string; userId: string; isTyping: boolean }) => void
  "presence:update": (data: { userId: string; online: boolean; lastSeenAt?: string }) => void
  "chat:new": (data: { chatId: string }) => void
  "chat:members-changed": (data: { chatId: string; added: string[]; removed: string[]; epochBump?: boolean }) => void
  "webrtc:signal": (data: { callId: string; fromUserId: string; fromDevice: string; toDevice: string; signal: unknown }) => void
  "call:ring": (data: { callId: string; chatId: string; kind: "AUDIO" | "VIDEO"; fromUserId: string; fromName: string }) => void
  "call:accepted": (data: { callId: string; userId: string }) => void
  "call:declined": (data: { callId: string; userId: string }) => void
  "call:ended": (data: { callId: string }) => void
  "call:participants": (data: { callId: string; participants: string[] }) => void
  "group:epoch-request": (data: { chatId: string; epoch: number; fromUserId: string; fromDevice: string }) => void
  "device:linked": (data: { deviceId: string; name: string }) => void
  "poll:update": (data: { messageId: string; counts: Array<{ optionIndex: number; count: number }>; totalVoters: number }) => void
}

export interface ClientToServerEvents {
  "message:send": (
    data: {
      chatId: string
      type: string
      body?: string
      meta?: string
      replyToId?: string
      forwardedFromChat?: string
      forwardedFromUser?: string
      expiresAfter?: number
      envelopes?: Array<{ toUserId: string; toDeviceId: string; payload: string }>
      poll?: { allowMultiple: boolean; anonymous: boolean; optionCount: number }
    },
    ack: (res: { ok: boolean; error?: string; message?: { id: string; seq: number; createdAt: string; expiresAt?: string } }) => void
  ) => void
  "receipt:delivered": (data: { envelopeIds: string[] }) => void
  "receipt:read": (data: { chatId: string; upToSeq: number }) => void
  "typing:update": (data: { chatId: string; isTyping: boolean }) => void
  "reaction:toggle": (data: { messageId: string; emoji: string; on: boolean }) => void
  "message:edit": (
    data: { messageId: string; body?: string; envelopes?: Array<{ toUserId: string; toDeviceId: string; payload: string }> },
    ack: (res: { ok: boolean; error?: string }) => void
  ) => void
  "message:delete": (data: { messageId: string; forEveryone: boolean }) => void
  "webrtc:signal": (data: { callId: string; toUserId: string; toDevice?: string; signal: unknown }) => void
  "call:ring": (data: { chatId: string; kind: "AUDIO" | "VIDEO" }, ack: (res: { ok: boolean; callId?: string; error?: string }) => void) => void
  "call:accept": (data: { callId: string }) => void
  "call:decline": (data: { callId: string }) => void
  "call:end": (data: { callId: string }) => void
  "control:send": (data: { toUserId: string; toDeviceId: string; payload: string; type: EnvelopeType; chatId?: string }) => void
  "group:epoch-missing": (data: { chatId: string; epoch: number }) => void
  "presence:heartbeat": () => void
}

export interface MessageNewEvent {
  id: string
  chatId: string
  senderId: string
  senderDeviceId: string
  type: string
  seq: number
  body?: string | null
  meta?: string | null
  replyToId?: string | null
  forwardedFromChat?: string | null
  forwardedFromUser?: string | null
  createdAt: string
  expiresAt?: string | null
}

export interface SocketData {
  userId: string
  deviceId: string
}
