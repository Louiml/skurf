"use client"

import { useEffect, useRef, useState } from "react"
import type { ChatPayload } from "@/lib/crypto/protocol"
import type { Message } from "@/lib/client/store"
import { cn } from "@/components/ui"

export function MediaRenderer({ payload }: { payload: ChatPayload }) {
  const [loaded, setLoaded] = useState(false)
  const [failed, setFailed] = useState(false)
  if (!payload.mediaId) return null
  if (failed) return <div className="rounded-md bg-negative-bg/10 p-3 text-sm text-negative">Media unavailable</div>
  return (
    <div className="overflow-hidden rounded-md">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={`/api/media/${payload.mediaId}`}
        alt={payload.fileName ?? "photo"}
        className={cn("max-h-80 w-auto rounded-md transition-opacity", loaded ? "opacity-100" : "opacity-0")}
        style={{ maxWidth: "100%" }}
        onLoad={() => setLoaded(true)}
        onError={() => setFailed(true)}
      />
      {!loaded && !failed && <div className="h-48 w-64 animate-pulse rounded-md bg-canvas-soft" />}
    </div>
  )
}

export function VoiceNote({ payload }: { payload: ChatPayload }) {
  const waveform = payload.waveform ?? []
  const durationSec = Math.round((payload.durationMs ?? 0) / 1000)
  const [progress, setProgress] = useState(0)
  const [playing, setPlaying] = useState(false)
  const audioRef = useRef<HTMLAudioElement | null>(null)

  const toggle = () => {
    const audio = audioRef.current
    if (!audio) return
    if (playing) {
      audio.pause()
      setPlaying(false)
    } else {
      void audio.play()
      setPlaying(true)
    }
  }

  return (
    <div className="flex min-w-[220px] items-center gap-3 py-1">
      <audio
        ref={audioRef}
        src={payload.mediaId ? `/api/media/${payload.mediaId}` : undefined}
        onTimeUpdate={(e) => setProgress(e.currentTarget.currentTime / (e.currentTarget.duration || 1))}
        onEnded={() => {
          setPlaying(false)
          setProgress(0)
        }}
        preload="metadata"
      />
      <button
        onClick={toggle}
        className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-ink text-primary transition-transform hover:scale-105"
        aria-label={playing ? "Pause" : "Play"}
      >
        {playing ? "❚❚" : "▶"}
      </button>
      <div className="flex h-10 flex-1 items-center gap-[2px]">
        {waveform.map((v, i) => (
          <div
            key={i}
            className={cn("waveform-bar w-[3px] rounded-pill", i / waveform.length <= progress ? "bg-positive" : "bg-ink/20")}
            style={{ height: `${Math.max(3, v * 32)}px` }}
          />
        ))}
        {waveform.length === 0 && <div className="h-1 flex-1 rounded-pill bg-ink/20" />}
      </div>
      <span className="shrink-0 text-xs text-body">
        {Math.floor(durationSec / 60)}:{String(durationSec % 60).padStart(2, "0")}
      </span>
    </div>
  )
}

export function LocationRenderer({ payload }: { payload: ChatPayload }) {
  const lat = payload.lat?.toFixed(5) ?? "?"
  const lng = payload.lng?.toFixed(5) ?? "?"
  return (
    <a
      href={`https://www.openstreetmap.org/?mlat=${payload.lat}&mlon=${payload.lng}#map=15/${payload.lat}/${payload.lng}`}
      target="_blank"
      rel="noreferrer"
      className="flex items-center gap-3 rounded-md bg-canvas-soft/70 p-3 text-sm hover:bg-canvas-soft"
    >
      <span className="text-2xl">📍</span>
      <span>
        <span className="block font-semibold">{payload.live ? "Live location (shared)" : "Location"}</span>
        <span className="text-xs text-body">
          {lat}, {lng}
        </span>
      </span>
    </a>
  )
}

export function PollRenderer({
  message,
  payload,
  onVote,
}: {
  message: Message
  payload: ChatPayload
  onVote: (optionIndex: number) => void
}) {
  const [voted, setVoted] = useState<number[]>([])
  const options = payload.options ?? []
  const counts = message.poll?.counts ?? []
  const total = message.poll?.totalVoters || 0
  const totalVotes = counts.reduce((a, b) => a + b.count, 0) || 1

  useEffect(() => {
    setVoted([])
  }, [message.id])

  return (
    <div className="min-w-[240px] py-1">
      <div className="text-sm font-semibold">📊 {payload.question}</div>
      <div className="mt-1 flex flex-col gap-1.5">
        {options.map((opt, i) => {
          const count = counts.find((c) => c.optionIndex === i)?.count ?? 0
          const pct = Math.round((count / totalVotes) * 100)
          const mine = voted.includes(i)
          return (
            <button
              key={i}
              onClick={() => {
                setVoted((v) => (payload.allowMultiple ? (mine ? v.filter((x) => x !== i) : [...v, i]) : [i]))
                onVote(i)
              }}
              className={cn(
                "relative overflow-hidden rounded-md px-3 py-1.5 text-left text-sm transition-colors",
                mine ? "bg-primary-pale" : "bg-canvas-soft/70 hover:bg-canvas-soft"
              )}
            >
              <span
                className="absolute inset-y-0 left-0 bg-primary/50 transition-all"
                style={{ width: message.poll ? `${pct}%` : "0%" }}
              />
              <span className="relative flex justify-between">
                <span className={cn(mine && "font-semibold")}>
                  {mine ? "◉" : "○"} {opt}
                </span>
                {message.poll && total > 0 && <span className="text-xs text-body">{pct}%</span>}
              </span>
            </button>
          )
        })}
      </div>
      <div className="mt-1 text-xs text-mute">
        {payload.anonymous ? "Anonymous" : "Public"} vote{!payload.allowMultiple ? " · single choice" : " · multiple choice"}
        {message.poll && total > 0 && ` · ${total} voter${total === 1 ? "" : "s"}`}
      </div>
    </div>
  )
}
