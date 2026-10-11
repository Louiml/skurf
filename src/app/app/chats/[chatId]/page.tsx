"use client"

import { useEffect, useLayoutEffect, useRef, useState } from "react"
import { useParams, useRouter } from "next/navigation"
import { useStore } from "@/lib/client/store"
import { chatNameSafe } from "@/lib/client/store-helpers"
import { cn, Avatar, EmptyState, Spinner } from "@/components/ui"
import { MessageBubble } from "@/components/chat/message-bubble"
import { Composer } from "@/components/chat/composer"
import { ChatInfoDialog } from "@/components/dialogs"
import { Phone, Video, Info, ArrowLeft, Lock, Timer } from "lucide-react"
import { callManager } from "@/lib/client/webrtc"

export default function ChatPage() {
  const params = useParams<{ chatId: string }>()
  const router = useRouter()
  const chatId = params.chatId
  const { me, chats, messagesByChat, loadMessages, markRead, setActiveChat, presence, typing } = useStore()
  const chat = chats.find((c) => c.id === chatId)
  const messages = messagesByChat[chatId]
  const [showInfo, setShowInfo] = useState(false)
  const [loading, setLoading] = useState(true)
  const [toast, setToast] = useState<string | null>(null)
  const bottomRef = useRef<HTMLDivElement>(null)
  const listRef = useRef<HTMLDivElement>(null)
  const wasAtBottomRef = useRef(true)

  useEffect(() => {
    setActiveChat(chatId)
    setLoading(true)
    loadMessages(chatId).finally(() => setLoading(false))
    markRead(chatId)
    return () => setActiveChat(null)
  }, [chatId, loadMessages, markRead, setActiveChat])

  useEffect(() => {
    if (!toast) return
    const t = setTimeout(() => setToast(null), 2500)
    return () => clearTimeout(t)
  }, [toast])

  useLayoutEffect(() => {
    if (wasAtBottomRef.current) {
      bottomRef.current?.scrollIntoView()
    }
  }, [messages?.length])

  const onScroll = () => {
    const el = listRef.current
    if (!el) return
    wasAtBottomRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 120
    if (el.scrollTop < 60 && messages && messages.length >= 50) {
      void loadMessages(chatId, { before: true })
    }
  }

  if (!chat) {
    return (
      <div className="flex h-full items-center justify-center">
        <EmptyState title="Chat not found" text="It may have been deleted." />
      </div>
    )
  }

  const other = chat.members.find((m) => m.userId !== me?.id)?.user
  const pres = other ? presence[other.id] : undefined
  const typers = Object.entries(typing[chatId] ?? {})
    .filter(([uid]) => uid !== me?.id)
    .map(([uid]) => chat.members.find((m) => m.userId === uid)?.user.displayName ?? "Someone")
  const name = chatNameSafe(chat, me?.id ?? null)

  return (
    <div className="flex h-full flex-col">
      <header className="flex items-center gap-2 border-b border-ink/10 bg-canvas px-3 py-2.5 md:px-4">
        <button className="rounded-full p-2 hover:bg-canvas-soft md:hidden" onClick={() => router.push("/app")}>
          <ArrowLeft className="h-5 w-5" />
        </button>
        <button className="flex min-w-0 flex-1 items-center gap-3 text-left" onClick={() => setShowInfo(true)}>
          <Avatar name={name} size={40} />
          <div className="min-w-0">
            <div className="truncate text-sm font-semibold">{name}</div>
            <div className="truncate text-xs text-body">
              {typers.length > 0 ? (
                <span className="text-positive-deep">
                  {typers.join(", ")} {typers.length === 1 ? "is" : "are"} typing…
                </span>
              ) : chat.type === "CHANNEL" ? (
                `${chat.members.length} subscribers${chat.handle ? ` · @${chat.handle}` : ""}`
              ) : chat.type === "GROUP" ? (
                `${chat.members.length} members`
              ) : chat.type === "SAVED" ? (
                "Private cloud storage"
              ) : pres?.online ? (
                <span className="text-positive-deep">online</span>
              ) : pres?.lastSeenAt ? (
                `last seen ${new Date(pres.lastSeenAt).toLocaleString()}`
              ) : (
                "offline"
              )}
            </div>
          </div>
        </button>
        {chat.disappearAfter ? (
          <span
            className="flex items-center gap-1 rounded-pill bg-primary-pale px-2 py-1 text-xs font-semibold text-positive-deep"
            title="Disappearing messages on"
          >
            <Timer className="h-3 w-3" />
            {chat.disappearAfter >= 86400
              ? `${chat.disappearAfter / 86400}d`
              : chat.disappearAfter >= 3600
                ? `${chat.disappearAfter / 3600}h`
                : chat.disappearAfter >= 60
                  ? `${chat.disappearAfter / 60}m`
                  : `${chat.disappearAfter}s`}
          </span>
        ) : null}
        {(chat.type === "DIRECT" || chat.type === "GROUP") && (
          <>
            <button className="rounded-full p-2 hover:bg-canvas-soft" title="Voice call" onClick={() => callManager.start(chat.id, "AUDIO")}>
              <Phone className="h-5 w-5" />
            </button>
            <button className="rounded-full p-2 hover:bg-canvas-soft" title="Video call" onClick={() => callManager.start(chat.id, "VIDEO")}>
              <Video className="h-5 w-5" />
            </button>
          </>
        )}
        <button className="rounded-full p-2 hover:bg-canvas-soft" title="Chat info" onClick={() => setShowInfo(true)}>
          <Info className="h-5 w-5" />
        </button>
      </header>

      <div ref={listRef} onScroll={onScroll} className="min-h-0 flex-1 overflow-y-auto bg-canvas-soft/60 px-3 py-4 md:px-8">
        {loading && (
          <div className="flex justify-center py-4">
            <Spinner className="h-5 w-5" />
          </div>
        )}
        {messages && messages.length === 0 && !loading && (
          <div className="mx-auto max-w-md py-12">
            <EmptyState
              icon={<Lock className="h-8 w-8 text-mute" />}
              title="Encrypted chat"
              text="Messages in this chat are end-to-end encrypted. Not even the server can read them."
            />
          </div>
        )}
        <div className="mx-auto flex max-w-3xl flex-col gap-0.5">
          {messages?.map((m, i) => (
            <MessageBubble
              key={m.id}
              message={m}
              prev={messages[i - 1]}
              chat={chat}
              showSender={chat.type !== "DIRECT" && (i === 0 || messages[i - 1].senderId !== m.senderId)}
            />
          ))}
          <div ref={bottomRef} className="h-2" />
        </div>
      </div>

      <Composer chat={chat} onToast={setToast} />

      <ChatInfoDialog chat={chat} open={showInfo} onClose={() => setShowInfo(false)} onToast={setToast} />
      {toast && (
        <div className="fixed bottom-24 left-1/2 z-[60] -translate-x-1/2 rounded-xl bg-ink px-4 py-2 text-sm text-canvas">{toast}</div>
      )}
    </div>
  )
}
