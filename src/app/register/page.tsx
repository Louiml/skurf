"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import Link from "next/link"
import { Button, Input, Card } from "@/components/ui"
import { POST } from "@/lib/client/api"

export default function RegisterPage() {
  const router = useRouter()
  const [username, setUsername] = useState("")
  const [displayName, setDisplayName] = useState("")
  const [password, setPassword] = useState("")
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  async function register(e: React.FormEvent) {
    e.preventDefault()
    setBusy(true)
    setError(null)
    try {
      await POST("/api/auth/register", { username, displayName, password })
      router.push("/app")
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-canvas-soft p-6">
      <Card className="w-full max-w-sm bg-canvas-soft">
        <h1 className="display-hero text-4xl">Join Skurf</h1>
        <p className="mt-2 text-sm text-body">
          Your encryption keys are generated in this browser and never sent to the server.
        </p>
        <form onSubmit={register} className="mt-6 space-y-3">
          <Input placeholder="username (lowercase)" value={username} onChange={(e) => setUsername(e.target.value)} autoCapitalize="none" required />
          <Input placeholder="display name" value={displayName} onChange={(e) => setDisplayName(e.target.value)} required />
          <Input placeholder="password (8+ characters)" type="password" value={password} onChange={(e) => setPassword(e.target.value)} required />
          {error && <p className="text-sm text-negative">{error}</p>}
          <Button type="submit" disabled={busy} className="w-full">
            {busy ? "Creating account…" : "Create account"}
          </Button>
        </form>
        <p className="mt-4 text-sm text-body">
          Already registered?{" "}
          <Link href="/login" className="font-semibold underline">
            Log in
          </Link>
        </p>
      </Card>
    </main>
  )
}
