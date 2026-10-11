"use client"

import { useState, memo } from "react"
import ReactMarkdown from "react-markdown"
import remarkGfm from "remark-gfm"
import rehypeHighlight from "rehype-highlight"
import { useStore, type Chat, type Message } from "@/lib/client/store"
import { cn, Avatar } from "@/components/ui"
import { QUICK_REACTIONS, formatDay, formatTime } from "@/lib/client/store-helpers"
import { VoiceNote, MediaRenderer, PollRenderer, LocationRenderer } from "@/components/chat/renderers"
import { Check, CheckCheck, Reply, Forward, Pencil, Trash2, Smile, MoreVertical, ChevronDown, Lock } from "lucide-react"

function Ticks({ state }: { state: Message["state"] }) {
  if (state === "pending") return <span className="text-[10px] text-mute">⏳</span>
  if (state === "sent") return <Check className="h-3.5 w-3.5 text-mute" />
  if (state === "delivered") return <CheckCheck className="h-3.5 w-3.5 text-mute" />
  return <CheckCheck className="h-3.5 w-3.5 text-[#38c8ff]" />
}

function ReactionChips({ message, onToggle }: { message: Message; onToggle: (emoji: string) => void }) {
  if (message.reactions.length === 0) return null
  const grouped = new Map<string, string[]>()
  for (const r of message.reactions) {
    grouped.set(r.emoji, [...(grouped.get(r.emoji) ?? []), r.userId])
  }
  const me = useStore.getState().me?.id
  return (
    <div className="mt-1 flex flex-wrap gap-1">
      {[...grouped.entries()].map(([emoji, users]) => (
        <button
          key={emoji}
          onClick={() => onToggle(emoji)}
          className={cn(
            "flex items-center gap-0.5 rounded-pill px-2 py-0.5 text-xs transition-colors",
            users.includes(me!) ? "bg-primary-pale text-positive-deep" : "bg-canvas-soft/80 text-body hover:bg-canvas-soft"
          )}
        >
          {emoji} {users.length > 1 && <span>{users.length}</span>}
        </button>
      ))}
    </div>
  )
}

export const MessageBubble = memo(function MessageBubble({
  message,
  prev,
  chat,
  showSender,
}: {
  message: Message
  prev?: Message
  chat: Chat
  showSender: boolean
}) {
  const { me, toggleReaction, deleteMessage, setActiveReply, activeReplyTo, forwardMessage, editMessage } = useStore() as any
  const [menuOpen, setMenuOpen] = useState(false)
  const [showReactions, setShowReactions] = useState(false)
  const [editing, setEditing] = useState(false)
  const [editText, setEditText] = useState("")
  const [forwardOpen, setForwardOpen] = useState(false)
  const mine = message.senderId === me?.id
  const p = message.payload
  const sender = chat.members.find((m) => m.userId === message.senderId)?.user
  const newDay = !prev || new Date(prev.createdAt).toDateString() !== new Date(message.createdAt).toDateString()

  if (message.deletedForEveryone) {
    return (
      <>
        {newDay && <DayDivider iso={message.createdAt} />}
        <div className="my-1 flex justify-center">
          <span className="rounded-pill bg-canvas-soft px-3 py-0.5 text-xs italic text-mute">Message deleted</span>
        </div>
      </>
    )
  }

  const bubbleColor = mine ? "bg-primary-pale" : "bg-canvas"
  const disappearing = !!message.expiresAt && new Date(message.expiresAt).getTime() > Date.now()

  return (
    <>
      {newDay && <DayDivider iso={message.createdAt} />}
      <div className={cn("group relative flex gap-2 px-1 py-0.5", mine ? "flex-row-reverse" : "flex-row")}>
        {chat.type !== "DIRECT" && (
          <div className="w-8 shrink-0 self-end">
            {showSender && !mine && <Avatar name={sender?.displayName ?? "?"} size={32} />}
          </div>
        )}
        <div className={cn("relative max-w-[85%] md:max-w-[70%]", mine ? "items-end" : "items-start")}>
          {showSender && !mine && chat.type !== "DIRECT" && (
            <div className="px-3 pt-1 text-xs font-semibold text-positive-deep">{sender?.displayName ?? "Unknown"}</div>
          )}
          <div className={cn("rounded-lg px-3 py-2 text-[15px] shadow-sm", bubbleColor)}>
            {message.replyPreview && (
              <div className="mb-1 rounded-md border-l-[3px] border-positive bg-canvas-soft/70 px-2 py-1 text-xs">
                <div className="font-semibold text-ink">
                  {message.replyPreview.senderId === me?.id
                    ? "You"
                    : chat.members.find((m) => m.userId === message.replyPreview!.senderId)?.user.displayName ?? "?"}
                </div>
                <div className="truncate text-body">{message.replyPreview.text}</div>
              </div>
            )}
            {message.forwarded && (
              <div className="mb-1 flex items-center gap-1 text-xs italic text-mute">
                <Forward className="h-3 w-3" /> forwarded
              </div>
            )}

            {!p && (
              <div className="flex items-center gap-2 text-sm italic text-mute">
                <Lock className="h-3 w-3" /> Encrypted message — waiting for keys on this device
              </div>
            )}

            {p?.t === "text" && !editing && (
              <div className="markdown-body">
                <ReactMarkdown remarkPlugins={[remarkGfm]} rehypePlugins={[rehypeHighlight]} disallowedElements={["img"]}>
                  {p.text ?? ""}
                </ReactMarkdown>
              </div>
            )}

            {editing && (
              <div className="flex flex-col gap-1">
                <input
                  className="w-full rounded-md border border-ink/30 bg-canvas px-2 py-1 text-sm outline-none"
                  value={editText}
                  onChange={(e) => setEditText(e.target.value)}
                  autoFocus
                />
                <div className="flex gap-2 text-xs">
                  <button className="font-semibold text-positive-deep" onClick={() => { editMessage(message.id, chat.id, editText); setEditing(false) }}>
                    Save
                  </button>
                  <button className="text-mute" onClick={() => setEditing(false)}>
                    Cancel
                  </button>
                </div>
              </div>
            )}

            {p?.t === "media" && <MediaRenderer payload={p} />}
            {p?.t === "voice" && <VoiceNote payload={p} />}
            {p?.t === "location" && <LocationRenderer payload={p} />}
            {p?.t === "poll" && (
              <PollRenderer message={message} payload={p} onVote={(i) => useStore.getState().vote(message.id, i)} />
            )}
            {p?.t === "file" && (
              <a href={`/api/media/${p.mediaId}`} download={p.fileName} className="flex items-center gap-3 rounded-md bg-canvas-soft/70 p-2 text-sm hover:bg-canvas-soft">
                <span className="rounded-full bg-ink p-2 text-primary">📄</span>
                <span>
                  <span className="block font-semibold">{p.fileName}</span>
                  <span className="text-xs text-mute">{((p.size ?? 0) / 1024).toFixed(0)} KB</span>
                </span>
              </a>
            )}
            {p?.t === "call" && (
              <div className="flex items-center gap-2 text-sm italic">
                📞 {p.callKind === "video" ? "Video" : "Voice"} call — {p.callState}
              </div>
            )}

            <div className={cn("mt-0.5 flex items-center justify-end gap-1 text-[11px] text-mute", mine && "text-ink/60")}>
              {disappearing && <span title="Disappearing message">⏱</span>}
              {message.editedAt && <span className="italic">edited</span>}
              <span>{formatTime(message.createdAt)}</span>
              {mine && <Ticks state={message.state} />}
            </div>
          </div>

          <ReactionChips message={message} onToggle={(emoji) => toggleReaction(message.id, emoji)} />

          {showReactions && (
            <div className={cn("absolute z-10 mt-1 flex gap-1 rounded-pill bg-ink px-2 py-1", mine ? "right-0" : "left-0")}>
              {QUICK_REACTIONS.map((r) => (
                <button
                  key={r}
                  className="rounded-full p-1 text-lg transition-transform hover:scale-125"
                  onClick={() => {
                    toggleReaction(message.id, r)
                    setShowReactions(false)
                  }}
                >
                  {r}
                </button>
              ))}
            </div>
          )}

          <div className={cn("absolute -top-2 z-10 flex gap-0.5 rounded-pill border border-ink/10 bg-canvas p-0.5 opacity-0 shadow-md transition-opacity group-hover:opacity-100", mine ? "left-0 -translate-x-full" : "right-0 translate-x-full")}>
            <button className="rounded-full p-1.5 hover:bg-canvas-soft" title="React" onClick={() => setShowReactions((v) => !v)}>
              <Smile className="h-4 w-4" />
            </button>
            <button className="rounded-full p-1.5 hover:bg-canvas-soft" title="Reply" onClick={() => setActiveReply(message)}>
              <Reply className="h-4 w-4" />
            </button>
            {mine && p?.t === "text" && !editing && (
              <button
                className="rounded-full p-1.5 hover:bg-canvas-soft"
                title="Edit"
                onClick={() => {
                  setEditText(p.text ?? "")
                  setEditing(true)
                }}
              >
                <Pencil className="h-4 w-4" />
              </button>
            )}
            <button className="rounded-full p-1.5 hover:bg-canvas-soft" title="Forward" onClick={() => setForwardOpen(true)}>
              <Forward className="h-4 w-4" />
            </button>
            <button
              className="rounded-full p-1.5 text-negative hover:bg-negative-bg/10"
              title="Delete"
              onClick={() => {
                if (confirm(mine ? "Delete for everyone?" : "Delete for me?")) deleteMessage(message.id, chat.id, mine)
              }}
            >
              <Trash2 className="h-4 w-4" />
            </button>
          </div>

          {forwardOpen && (
            <ForwardPicker
              chat={chat}
              onPick={async (targets) => {
                await forwardMessage(message, targets)
                setForwardOpen(false)
              }}
              onClose={() => setForwardOpen(false)}
            />
          )}
        </div>
      </div>
    </>
  )
})

function DayDivider({ iso }: { iso: string }) {
  return (
    <div className="my-3 flex justify-center">
      <span className="rounded-pill bg-canvas-soft px-3 py-0.5 text-xs font-semibold text-body">{formatDay(iso)}</span>
    </div>
  )
}

function ForwardPicker({ chat, onPick, onClose }: { chat: Chat; onPick: (ids: string[]) => void; onClose: () => void }) {
  const { chats, me } = useStore()
  const [selected, setSelected] = useState<string[]>([])
  const forwardable = chats.filter((c) => c.id !== chat.id && c.type !== "SAVED" ? true : c.type === "SAVED")
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-6" onClick={onClose}>
      <div className="max-h-[70vh] w-full max-w-sm overflow-y-auto rounded-2xl bg-canvas p-4" onClick={(e) => e.stopPropagation()}>
        <h3 className="mb-3 text-lg font-semibold">Forward to…</h3>
        {forwardable.map((c) => {
          const other = c.members.find((m) => m.userId !== me?.id)
          const name = c.type === "SAVED" ? "Saved messages" : c.title ?? other?.user.displayName ?? "Chat"
          return (
            <label key={c.id} className="flex cursor-pointer items-center gap-3 rounded-lg px-2 py-2 hover:bg-canvas-soft">
              <input
                type="checkbox"
                checked={selected.includes(c.id)}
                onChange={(e) => setSelected((s) => (e.target.checked ? [...s, c.id] : s.filter((x) => x !== c.id)))}
              />
              <Avatar name={name} size={32} />
              <span className="text-sm font-semibold">{name}</span>
            </label>
          )
        })}
        <button
          className="mt-3 w-full rounded-xl bg-primary px-4 py-2 font-semibold text-on-primary disabled:opacity-50"
          disabled={selected.length === 0}
          onClick={() => onPick(selected)}
        >
          Forward ({selected.length})
        </button>
      </div>
    </div>
  )
}
