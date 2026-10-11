"use client"

import { useMemo, useState } from "react"
import { useStore, type Chat } from "@/lib/client/store"
import { cn, Avatar, Badge, Button } from "@/components/ui"
import { useRouter, usePathname } from "next/navigation"
import { NewChatDialog, SettingsDialog } from "@/components/dialogs"
import { Search, MessageSquarePlus, Bookmark, Megaphone, Users, Pin, Archive, FolderPlus, X } from "lucide-react"

export function chatName(chat: Chat, meId: string | null): string {
  if (chat.type === "SAVED") return "Saved messages"
  if (chat.title) return chat.title
  const other = chat.members.find((m) => m.userId !== meId)
  return other?.user.displayName ?? "Direct chat"
}

export function AppShell({ children }: { children: React.ReactNode }) {
  const router = useRouter()
  const pathname = usePathname()
  const { chats, folders, me, activeChatId, setActiveChat, typing } = useStore()
  const [showNew, setShowNew] = useState(false)
  const [showSettings, setShowSettings] = useState(false)
  const [query, setQuery] = useState("")
  const [activeFolder, setActiveFolder] = useState<string | null>(null)
  const [folderPickerFor, setFolderPickerFor] = useState<Chat | null>(null)

  const visibleChats = useMemo(() => {
    let list = [...chats]
    if (activeFolder === "unread") {
      list = list.filter((c) => (c.lastReadSeq ?? 0) < c.seqCounter)
    } else if (activeFolder === "saved") {
      list = list.filter((c) => c.type === "SAVED")
    } else if (activeFolder === "channels") {
      list = list.filter((c) => c.type === "CHANNEL")
    } else if (activeFolder === "groups") {
      list = list.filter((c) => c.type === "GROUP")
    } else if (activeFolder && activeFolder !== "all") {
      const folder = folders.find((f) => f.id === activeFolder)
      list = list.filter((c) => folder?.chatIds.includes(c.id))
    }
    if (query) {
      const q = query.toLowerCase()
      list = list.filter(
        (c) =>
          chatName(c, me?.id ?? null).toLowerCase().includes(q) ||
          (c.handle ?? "").toLowerCase().includes(q) ||
          (c.preview?.text ?? "").toLowerCase().includes(q)
      )
    }
    list.sort((a, b) => {
      if (!!a.pinned !== !!b.pinned) return a.pinned ? -1 : 1
      if (a.archived !== b.archived) return a.archived ? 1 : -1
      return new Date(b.lastMessageAt).getTime() - new Date(a.lastMessageAt).getTime()
    })
    return list
  }, [chats, folders, activeFolder, query, me?.id])

  const unread = (c: Chat) => Math.max(0, c.seqCounter - (c.lastReadSeq ?? 0))

  const tabs = [
    { id: "all", label: "All" },
    { id: "unread", label: "Unread" },
    { id: "saved", label: "Saved" },
    ...folders.map((f) => ({ id: f.id, label: `${f.emoji ?? ""} ${f.name}`.trim() })),
    { id: "groups", label: "Groups" },
    { id: "channels", label: "Channels" },
  ]

  return (
    <div className="flex h-screen overflow-hidden bg-canvas-soft">
      <aside className="flex w-full flex-col border-r border-ink/10 bg-canvas md:w-[380px] md:shrink-0" style={{ display: pathname.startsWith("/app/chats/") ? undefined : undefined }}>
        <div className={cn("flex h-full flex-col", pathname.startsWith("/app/chats/") && "hidden md:flex")}>
          <div className="flex items-center justify-between px-4 py-3">
            <span className="text-lg font-black tracking-tight">
              skurf<span className="text-positive">.</span>
            </span>
            <div className="flex items-center gap-1">
              <button className="rounded-full p-2 hover:bg-canvas-soft" title="New chat" onClick={() => setShowNew(true)}>
                <MessageSquarePlus className="h-5 w-5" />
              </button>
              <button className="rounded-full p-2 hover:bg-canvas-soft" title="Settings" onClick={() => setShowSettings(true)}>
                <Avatar name={me?.displayName ?? "me"} size={32} />
              </button>
            </div>
          </div>

          <div className="px-4 pb-2">
            <div className="flex items-center gap-2 rounded-md border border-ink/20 bg-canvas-soft px-3 py-2">
              <Search className="h-4 w-4 text-mute" />
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search chats"
                className="w-full bg-transparent text-sm outline-none placeholder:text-mute"
              />
              {query && (
                <button onClick={() => setQuery("")}>
                  <X className="h-4 w-4 text-mute" />
                </button>
              )}
            </div>
          </div>

          <div className="flex gap-2 overflow-x-auto px-4 pb-2 text-sm">
            {tabs.map((t) => (
              <button
                key={t.id}
                onClick={() => setActiveFolder(activeFolder === t.id ? null : t.id)}
                className={cn(
                  "shrink-0 rounded-pill px-3 py-1 font-semibold transition-colors",
                  activeFolder === t.id ? "bg-ink text-primary" : "bg-canvas-soft text-body hover:bg-primary-pale"
                )}
              >
                {t.label}
              </button>
            ))}
            <button
              onClick={() => setShowSettings(true)}
              className="shrink-0 rounded-pill bg-canvas-soft p-1.5 text-body hover:bg-primary-pale"
              title="New folder"
            >
              <FolderPlus className="h-4 w-4" />
            </button>
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-4">
            {visibleChats.length === 0 && (
              <p className="px-4 py-8 text-center text-sm text-mute">Nothing here yet.</p>
            )}
            {visibleChats.map((c) => {
              const name = chatName(c, me?.id ?? null)
              const unreadCount = unread(c)
              const typers = Object.keys(typing[c.id] ?? {})
              const preview = typers.length > 0 ? "typing…" : c.preview?.text ?? (c.type === "CHANNEL" ? "Channel" : c.type === "SAVED" ? "Your private cloud storage" : "Say hi 👋")
              return (
                <button
                  key={c.id}
                  onClick={() => {
                    setActiveChat(c.id)
                    router.push(`/app/chats/${c.id}`)
                  }}
                  className={cn(
                    "group mb-0.5 flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left transition-colors",
                    activeChatId === c.id ? "bg-primary-pale" : "hover:bg-canvas-soft"
                  )}
                >
                  <div className="relative">
                    <Avatar name={name} size={44} />
                    {c.type === "CHANNEL" && (
                      <span className="absolute -bottom-1 -right-1 rounded-full bg-ink p-1 text-primary">
                        <Megaphone className="h-3 w-3" />
                      </span>
                    )}
                    {c.type === "GROUP" && (
                      <span className="absolute -bottom-1 -right-1 rounded-full bg-ink p-1 text-primary">
                        <Users className="h-3 w-3" />
                      </span>
                    )}
                    {c.type === "SAVED" && (
                      <span className="absolute -bottom-1 -right-1 rounded-full bg-ink p-1 text-primary">
                        <Bookmark className="h-3 w-3" />
                      </span>
                    )}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center justify-between gap-2">
                      <span className="truncate text-sm font-semibold">{name}</span>
                      <span className="shrink-0 text-xs text-mute">
                        {new Date(c.lastMessageAt).toLocaleDateString() === new Date().toLocaleDateString()
                          ? new Date(c.lastMessageAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
                          : new Date(c.lastMessageAt).toLocaleDateString([], { month: "short", day: "numeric" })}
                      </span>
                    </div>
                    <div className="flex items-center justify-between gap-2">
                      <span className={cn("truncate text-xs", typers.length > 0 ? "text-positive-deep" : "text-body")}>
                        {preview}
                      </span>
                      <span className="flex shrink-0 items-center gap-1">
                        {c.pinned && <Pin className="h-3 w-3 text-mute" />}
                        {c.archived && <Archive className="h-3 w-3 text-mute" />}
                        {unreadCount > 0 && (
                          <Badge className="bg-ink text-primary">{unreadCount > 99 ? "99+" : unreadCount}</Badge>
                        )}
                        {c.disappearAfter ? (
                          <span className="text-[10px] text-mute" title={`Disappearing: ${c.disappearAfter}s`}>
                            ⏱
                          </span>
                        ) : null}
                      </span>
                    </div>
                  </div>
                </button>
              )
            })}
          </div>
        </div>
      </aside>

      <main className={cn("min-w-0 flex-1 bg-canvas", !pathname.startsWith("/app/chats/") && "hidden md:block")}>
        {children}
      </main>

      <NewChatDialog open={showNew} onClose={() => setShowNew(false)} />
      <SettingsDialog
        open={showSettings}
        onClose={() => setShowSettings(false)}
        folderPickerChat={folderPickerFor}
        onFolderPickerClose={() => setFolderPickerFor(null)}
      />
    </div>
  )
}
