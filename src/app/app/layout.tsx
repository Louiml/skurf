"use client"

import { useEffect } from "react"
import { useRouter, usePathname } from "next/navigation"
import { useStore } from "@/lib/client/store"
import { AppShell } from "@/components/app-shell"
import { PasscodeLock } from "@/components/passcode-lock"
import { CallOverlay } from "@/components/call-overlay"
import { Spinner } from "@/components/ui"

export default function AppLayout({ children }: { children: React.ReactNode }) {
  const router = useRouter()
  const pathname = usePathname()
  const { ready, init, me, locked, hasPasscode } = useStore()

  useEffect(() => {
    init().catch(() => router.replace("/login"))
  }, [init, router])

  if (!ready || !me) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-canvas-soft gap-3">
        <Spinner className="h-6 w-6" />
        <span className="text-sm text-body">Unlocking your keys…</span>
      </div>
    )
  }

  if (hasPasscode && locked) {
    return <PasscodeLock />
  }

  return (
    <AppShell>
      {children}
      <CallOverlay />
    </AppShell>
  )
}

export const dynamic = "force-dynamic"
