"use client"

import { useState } from "react"
import { useStore } from "@/lib/client/store"
import { verifyPasscode } from "@/lib/client/passcode"
import { Input, Spinner, cn } from "@/components/ui"
import { Lock } from "lucide-react"

export function PasscodeLock() {
  const setLocked = useStore((s) => s.setLocked)
  const [value, setValue] = useState("")
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setBusy(true)
    const ok = await verifyPasscode(value)
    if (ok) {
      setLocked(false)
    } else {
      setError("Wrong passcode")
      setValue("")
    }
    setBusy(false)
  }

  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-canvas-soft gap-6">
      <div className="flex flex-col items-center gap-2">
        <span className="rounded-full bg-ink p-4 text-primary">
          <Lock className="h-8 w-8" />
        </span>
        <h1 className="text-2xl font-black tracking-tight">Skurf is locked</h1>
        <p className="text-sm text-body">Enter your passcode to unlock this device's messages.</p>
      </div>
      <form onSubmit={submit} className="w-64 space-y-3">
        <Input
          type="password"
          inputMode="numeric"
          autoFocus
          value={value}
          onChange={(e) => setValue(e.target.value)}
          className={cn("text-center text-2xl tracking-[0.5em]", error && "border-negative")}
          placeholder="••••"
        />
        {error && <p className="text-center text-sm text-negative">{error}</p>}
        <button type="submit" disabled={busy} className="w-full rounded-xl bg-primary py-3 font-semibold text-on-primary disabled:opacity-50">
          {busy ? <Spinner className="border-on-primary/30 border-t-on-primary" /> : "Unlock"}
        </button>
      </form>
    </div>
  )
}
