"use client"

import { useEffect, useRef, useState } from "react"
import { callManager } from "@/lib/client/webrtc"
import { cn, Avatar, Button } from "@/components/ui"
import { Mic, MicOff, Video, VideoOff, MonitorUp, PhoneOff, Phone, PhoneIncoming } from "lucide-react"

function VideoTile({ stream, label, speaking, muted }: { stream?: MediaStream; label: string; speaking: boolean; muted?: boolean }) {
  const ref = useRef<HTMLVideoElement>(null)
  useEffect(() => {
    if (ref.current && stream) {
      ref.current.srcObject = stream
    }
  }, [stream])
  return (
    <div className={cn("relative overflow-hidden rounded-lg bg-ink", speaking && !muted && "speaking-ring ring-2 ring-positive")}>
      {stream && stream.getVideoTracks().length > 0 ? (
        <video ref={ref} autoPlay playsInline muted={muted} className="h-full w-full object-cover" />
      ) : (
        <div className="flex h-full w-full items-center justify-center">
          <Avatar name={label} size={72} />
        </div>
      )}
      <span className="absolute bottom-2 left-2 rounded-pill bg-black/50 px-2 py-0.5 text-xs text-white">{label}</span>
    </div>
  )
}

export function CallOverlay() {
  const [, force] = useState(0)
  const [grid, setGrid] = useState(false)
  const cm = callManager

  useEffect(() => {
    const unsub = cm.subscribe(() => force((n) => n + 1))
    return () => {
      unsub()
    }
  }, [])

  useEffect(() => {
    setGrid(cm.peers.size > 1)
  }, [cm.peers.size])

  if (cm.state === "idle") return null

  const participants: Array<{ userId: string; stream?: MediaStream; label: string; speaking: boolean; self?: boolean }> = [
    {
      userId: "me",
      stream: (cm.screenStream ?? cm.localStream) ?? undefined,
      label: "You",
      speaking: cm.speaking.get("me") ?? false,
      self: true,
    },
    ...[...cm.remoteStreams.entries()].map(([userId, stream]) => ({
      userId,
      stream,
      label: userId.slice(0, 8),
      speaking: cm.speaking.get(userId) ?? false,
    })),
  ]

  const cols = participants.length <= 4 ? 2 : 3

  return (
    <div className="fixed inset-0 z-[70] flex flex-col bg-ink/95 backdrop-blur">
      {cm.state === "incoming" ? (
        <div className="flex flex-1 flex-col items-center justify-center gap-6 text-canvas">
          <Avatar name={cm.fromName || "?"} size={96} />
          <div className="text-center">
            <h2 className="text-3xl font-black">{cm.fromName}</h2>
            <p className="text-primary">
              Incoming {cm.kind === "VIDEO" ? "video" : "voice"} call…
            </p>
          </div>
          <div className="flex gap-6">
            <button
              onClick={() => cm.decline()}
              className="flex h-16 w-16 items-center justify-center rounded-full bg-negative text-white transition-transform hover:scale-110"
            >
              <PhoneOff className="h-7 w-7" />
            </button>
            <button
              onClick={() => void cm.accept()}
              className="flex h-16 w-16 items-center justify-center rounded-full bg-positive text-white transition-transform hover:scale-110"
            >
              <Phone className="h-7 w-7" />
            </button>
          </div>
        </div>
      ) : (
        <>
          <div className={cn("grid flex-1 gap-2 p-2", participants.length <= 1 ? "grid-cols-1" : participants.length <= 4 ? "grid-cols-2" : "grid-cols-3")} style={{ gridTemplateColumns: participants.length <= 1 ? undefined : `repeat(${cols}, minmax(0, 1fr))` }}>
            {participants.map((p) => (
              <VideoTile key={p.userId} stream={p.stream} label={p.label} speaking={p.speaking} muted={p.self} />
            ))}
          </div>
          <div className="flex items-center justify-center gap-3 bg-ink py-4">
            <button
              onClick={() => cm.toggleMute()}
              className={cn("flex h-12 w-12 items-center justify-center rounded-full", cm.muted ? "bg-negative text-white" : "bg-canvas-soft text-ink")}
              title={cm.muted ? "Unmute" : "Mute"}
            >
              {cm.muted ? <MicOff className="h-5 w-5" /> : <Mic className="h-5 w-5" />}
            </button>
            {cm.kind === "VIDEO" && (
              <button
                onClick={() => cm.toggleCamera()}
                className={cn("flex h-12 w-12 items-center justify-center rounded-full", cm.cameraOff ? "bg-negative text-white" : "bg-canvas-soft text-ink")}
                title={cm.cameraOff ? "Turn camera on" : "Turn camera off"}
              >
                {cm.cameraOff ? <VideoOff className="h-5 w-5" /> : <Video className="h-5 w-5" />}
              </button>
            )}
            <button
              onClick={() => void cm.toggleScreenShare()}
              className={cn("flex h-12 w-12 items-center justify-center rounded-full", cm.screenStream ? "bg-primary text-on-primary" : "bg-canvas-soft text-ink")}
              title="Share screen"
            >
              <MonitorUp className="h-5 w-5" />
            </button>
            <button
              onClick={() => cm.end()}
              className="flex h-12 w-12 items-center justify-center rounded-full bg-negative text-white"
              title="End call"
            >
              <PhoneOff className="h-5 w-5" />
            </button>
          </div>
          {cm.state === "outgoing" && (
            <div className="absolute left-1/2 top-6 -translate-x-1/2 rounded-pill bg-canvas-soft/90 px-4 py-1.5 text-sm text-ink">
              <PhoneIncoming className="mr-2 inline h-4 w-4 animate-bounce" />
              Ringing…
            </div>
          )}
        </>
      )}
    </div>
  )
}
