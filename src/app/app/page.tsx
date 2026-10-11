"use client"

import { useEffect, useState } from "react"
import { useStore } from "@/lib/client/store"
import { EmptyState } from "@/components/ui"
import { NewChatDialog } from "@/components/dialogs"
import { MessageSquare } from "lucide-react"

export default function AppIndex() {
  const { savedChatId, setActiveChat } = useStore()
  const [showNew, setShowNew] = useState(false)

  useEffect(() => {
    setActiveChat(null)
  }, [setActiveChat])

  return (
    <div className="flex h-full items-center justify-center p-8">
      <div className="max-w-md">
        <EmptyState
          icon={<MessageSquare className="h-10 w-10 text-mute" />}
          title="Pick a conversation"
          text="Choose a chat on the left, or start a new encrypted conversation. Your saved messages chat is ready too."
        />
        <div className="mt-4 flex justify-center">
          <button
            className="rounded-xl bg-primary px-6 py-3 font-semibold text-on-primary hover:bg-primary-active"
            onClick={() => setShowNew(true)}
          >
            New conversation
          </button>
        </div>
        {savedChatId && (
          <p className="mt-3 text-center text-xs text-mute">
            Tip: open “Saved messages” to keep private notes synced across your devices.
          </p>
        )}
      </div>
      <NewChatDialog open={showNew} onClose={() => setShowNew(false)} />
    </div>
  )
}
