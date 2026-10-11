"use client"

import { cn } from "@/components/ui"
import { Button } from "@/components/ui"
import Link from "next/link"

export default function Landing() {
  return (
    <main className="min-h-screen">
      <nav className="sticky top-0 z-10 bg-canvas px-6 py-3">
        <div className="mx-auto flex max-w-6xl items-center justify-between">
          <span className="text-sm font-semibold tracking-tight">
            skurf<span className="text-positive-deep">.</span>
          </span>
          <div className="flex items-center gap-2">
            <Link href="/login">
              <Button variant="secondary" size="sm">
                Log in
              </Button>
            </Link>
            <Link href="/register">
              <Button size="sm">Get started</Button>
            </Link>
          </div>
        </div>
      </nav>

      <section className="bg-canvas-soft px-6 py-12 md:py-20">
        <div className="mx-auto max-w-6xl">
          <h1 className="display-hero max-w-3xl text-5xl md:text-7xl lg:text-8xl">
            Say it once.
            <br />
            Trust it <span className="bg-primary px-2 rounded-md inline-block -rotate-1">everywhere.</span>
          </h1>
          <p className="mt-6 max-w-xl text-lg text-body">
            Skurf is end-to-end encrypted messaging with the Signal protocol - double ratchet, disappearing messages,
            channels, and peer-to-peer calls. The server physically cannot read your chats.
          </p>
          <div className="mt-8 flex flex-wrap gap-3">
            <Link href="/register">
              <Button>Create your account</Button>
            </Link>
            <Link href="/login">
              <Button variant="tertiary">I already have one</Button>
            </Link>
          </div>

          <div className="mt-12 grid gap-4 md:grid-cols-3">
            {[
              { title: "True E2EE", text: "X3DH key agreement and double-ratchet encryption on every direct chat. Keys live only on your devices.", card: "card-white" },
              { title: "Disappearing messages", text: "Set a timer from 5 seconds to 1 week. Messages vanish from every device — including the server.", card: "card-green" },
              { title: "Channels & calls", text: "Broadcast to unlimited subscribers, jump on P2P video with screen sharing and active-speaker grid.", card: "card-dark" },
            ].map((f) => (
              <div
                key={f.title}
                className={cn(
                  "rounded-xl p-6",
                  f.card === "card-white" && "bg-canvas text-ink",
                  f.card === "card-green" && "bg-primary-pale text-ink",
                  f.card === "card-dark" && "bg-ink text-primary"
                )}
              >
                <h3 className="text-xl font-semibold">{f.title}</h3>
                <p className={cn("mt-2 text-sm", f.card === "card-dark" ? "text-canvas-soft" : "text-body")}>{f.text}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <footer className="bg-ink px-6 py-12 text-canvas-soft">
        <div className="mx-auto max-w-6xl text-sm">
          Skurf — a demonstration of practical E2EE messaging. Keys are generated in your browser and never leave your
          devices unencrypted.
        </div>
      </footer>
    </main>
  )
}
