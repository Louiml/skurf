"use client"

import type { Chat } from "./store"

export function chatNameSafe(chat: Chat, meId: string | null): string {
  if (chat.type === "SAVED") return "Saved messages"
  if (chat.title) return chat.title
  const other = chat.members.find((m) => m.userId !== meId)
  return other?.user.displayName ?? "Direct chat"
}

export function otherMember(chat: Chat, meId: string | null) {
  return chat.members.find((m) => m.userId !== meId)
}

export const DISAPPEAR_OPTIONS: Array<{ label: string; seconds: number | null }> = [
  { label: "Off", seconds: null },
  { label: "5 seconds", seconds: 5 },
  { label: "30 seconds", seconds: 30 },
  { label: "1 minute", seconds: 60 },
  { label: "1 hour", seconds: 3600 },
  { label: "1 day", seconds: 86400 },
  { label: "1 week", seconds: 604800 },
]

export const QUICK_REACTIONS = ["👍", "❤️", "😂", "😮", "😢", "🙏"]

export function formatTime(iso: string) {
  return new Date(iso).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
}

export function formatDay(iso: string) {
  const d = new Date(iso)
  const today = new Date()
  const yesterday = new Date(Date.now() - 86400000)
  if (d.toDateString() === today.toDateString()) return "Today"
  if (d.toDateString() === yesterday.toDateString()) return "Yesterday"
  return d.toLocaleDateString([], { weekday: "short", month: "short", day: "numeric" })
}
