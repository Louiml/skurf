"use client"

import { useEffect, useRef, useState } from "react"
import { useStore, type Chat } from "@/lib/client/store"
import { getSocket } from "@/lib/client/socket"
import { cn, Spinner } from "@/components/ui"
import { uploadAsset, compressImage, VoiceRecorder, getCurrentPosition } from "@/lib/client/media"
import type { ChatPayload } from "@/lib/crypto/protocol"
import { Paperclip, Send, Smile, Mic, Square, MapPin, Trash2, Reply, X, BarChart3, Timer, Image as ImageIcon } from "lucide-react"
import { DISAPPEAR_OPTIONS } from "@/lib/client/store-helpers"

export function Composer({ chat, onToast }: { chat: Chat; onToast: (msg: string) => void }) {
  const { sendMessage, saveDraft, loadDraft, activeReplyTo, setActiveReply, setDisappearing } = useStore()
  const [text, setText] = useState("")
  const [busy, setBusy] = useState(false)
  const [recording, setRecording] = useState(false)
  const [recordMs, setRecordMs] = useState(0)
  const [showPoll, setShowPoll] = useState(false)
  const [showTimer, setShowTimer] = useState(false)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const recorderRef = useRef<VoiceRecorder | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)
  const imageRef = useRef<HTMLInputElement>(null)
  const typingRef = useRef<number>(0)

  useEffect(() => {
    loadDraft(chat.id).then((d) => d && setText(d))
    return () => {
      saveDraft(chat.id, text)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chat.id])

  useEffect(() => {
    if (activeReplyTo) textareaRef.current?.focus()
  }, [activeReplyTo])

  const emitTyping = () => {
    const socket = getSocket()
    if (!socket) return
    const now = Date.now()
    if (now - typingRef.current > 2500) {
      typingRef.current = now
      socket.emit("typing:update", { chatId: chat.id, isTyping: true })
    }
  }

  const stopTyping = () => {
    getSocket()?.emit("typing:update", { chatId: chat.id, isTyping: false })
  }

  const canPost = chat.type !== "CHANNEL" || chat.role === "OWNER" || chat.role === "ADMIN"

  async function send() {
    const trimmed = text.trim()
    if (!trimmed || busy) return
    setBusy(true)
    const replyId = activeReplyTo?.id
    setActiveReply(null)
    setText("")
    stopTyping()
    try {
      await sendMessage(chat.id, { t: "text", text: trimmed }, { replyToId: replyId })
      await saveDraft(chat.id, "")
    } catch (err) {
      onToast((err as Error).message)
      setText(trimmed)
    } finally {
      setBusy(false)
    }
  }

  async function sendPoll(question: string, options: string[], allowMultiple: boolean, anonymous: boolean) {
    setShowPoll(false)
    await sendMessage(chat.id, { t: "poll", question, options, allowMultiple, anonymous })
  }

  async function onFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    e.target.value = ""
    if (!file) return
    setBusy(true)
    try {
      if (file.type.startsWith("image/")) {
        const { file: compressed, width, height } = await compressImage(file)
        const asset = await uploadAsset(compressed, { kind: "image", mime: compressed.type, width, height })
        await sendMessage(chat.id, { t: "media", mediaId: asset.id, mime: compressed.type, width, height, fileName: file.name, size: compressed.size })
      } else {
        const asset = await uploadAsset(file, { kind: "document", mime: file.type, size: file.size })
        await sendMessage(chat.id, { t: "file", mediaId: asset.id, fileName: file.name, mime: file.type, size: file.size })
      }
    } catch (err) {
      onToast((err as Error).message)
    } finally {
      setBusy(false)
    }
  }

  async function startRecording() {
    try {
      recorderRef.current = new VoiceRecorder()
      await recorderRef.current.start()
      setRecording(true)
      setRecordMs(0)
    } catch {
      onToast("Microphone access denied")
    }
  }

  async function stopRecording(send: boolean) {
    const rec = recorderRef.current
    setRecording(false)
    if (!rec) return
    const result = send ? await rec.stop() : (await rec.cancel(), null)
    if (!result) return
    setBusy(true)
    try {
      const asset = await uploadAsset(result.file, {
        kind: "voice",
        mime: result.file.type,
        durationMs: result.durationMs,
        waveform: JSON.stringify(result.waveform),
      })
      await sendMessage(chat.id, { t: "voice", mediaId: asset.id, durationMs: result.durationMs, waveform: result.waveform })
    } catch (err) {
      onToast((err as Error).message)
    } finally {
      setBusy(false)
    }
  }

  async function shareLocation(live: boolean) {
    try {
      const pos = await getCurrentPosition()
      await sendMessage(chat.id, { t: "location", lat: pos.coords.latitude, lng: pos.coords.longitude, live })
      onToast(live ? "Live location shared — updates when you re-share" : "Location shared")
    } catch {
      onToast("Location access denied")
    }
  }

  useEffect(() => {
    if (!recording) return
    const t = setInterval(() => setRecordMs((ms) => ms + 200), 200)
    return () => clearInterval(t)
  }, [recording])

  if (!canPost) {
    return (
      <div className="border-t border-ink/10 bg-canvas px-6 py-4 text-center text-sm text-mute">
        Only channel admins can post.
      </div>
    )
  }

  return (
    <div className="relative border-t border-ink/10 bg-canvas px-3 py-2 md:px-6">
      {activeReplyTo && (
        <div className="mb-2 flex items-center justify-between rounded-md border-l-[3px] border-positive bg-canvas-soft px-3 py-1.5 text-xs">
          <span className="flex items-center gap-1 truncate">
            <Reply className="h-3 w-3 shrink-0" />
            <span className="truncate text-body">{activeReplyTo.payload?.text ?? "Message"}</span>
          </span>
          <button onClick={() => setActiveReply(null)}>
            <X className="h-3.5 w-3.5 text-mute" />
          </button>
        </div>
      )}

      {showPoll && (
        <PollComposer onDone={sendPoll} onCancel={() => setShowPoll(false)} />
      )}

      {showTimer && (
        <div className="mb-2 flex flex-wrap gap-1 rounded-md bg-canvas-soft p-2">
          {DISAPPEAR_OPTIONS.map((o) => (
            <button
              key={o.label}
              className={cn(
                "rounded-pill px-3 py-1 text-xs font-semibold",
                chat.disappearAfter === o.seconds ? "bg-ink text-primary" : "bg-canvas text-body hover:bg-primary-pale"
              )}
              onClick={() => {
                setDisappearing(chat.id, o.seconds)
                setShowTimer(false)
                onToast(o.seconds ? `Disappearing messages: ${o.label}` : "Disappearing messages off")
              }}
            >
              {o.label}
            </button>
          ))}
        </div>
      )}

      {recording ? (
        <div className="flex items-center gap-3 py-2">
          <span className="flex items-center gap-2 text-sm text-negative">
            <span className="h-2.5 w-2.5 animate-pulse rounded-full bg-negative" />
            {Math.floor(recordMs / 60000)}:{String(Math.floor((recordMs % 60000) / 1000)).padStart(2, "0")}
          </span>
          <div className="flex flex-1 items-center gap-[2px]">
            {Array.from({ length: 40 }).map((_, i) => (
              <div
                key={i}
                className="waveform-bar w-[3px] rounded-pill bg-ink/30"
                style={{ height: `${Math.max(3, (recorderRef.current?.amplitude ?? 0.2) * 32 * (0.6 + Math.sin(i * 1.3 + Date.now() / 300) * 0.4))}px` }}
              />
            ))}
          </div>
          <button onClick={() => stopRecording(false)} className="rounded-full p-2 text-negative hover:bg-canvas-soft" title="Discard">
            <Trash2 className="h-5 w-5" />
          </button>
          <button onClick={() => stopRecording(true)} className="rounded-full bg-ink p-2.5 text-primary" title="Send voice note">
            <Send className="h-4 w-4" />
          </button>
        </div>
      ) : (
        <div className="flex items-end gap-1">
          <button className="rounded-full p-2 text-body hover:bg-canvas-soft" title="Attach file" onClick={() => fileRef.current?.click()}>
            <Paperclip className="h-5 w-5" />
          </button>
          <button className="rounded-full p-2 text-body hover:bg-canvas-soft" title="Send photo" onClick={() => imageRef.current?.click()}>
            <ImageIcon className="h-5 w-5" />
          </button>
          <button className="rounded-full p-2 text-body hover:bg-canvas-soft" title="Share location" onClick={() => shareLocation(false)}>
            <MapPin className="h-5 w-5" />
          </button>
          <button className="rounded-full p-2 text-body hover:bg-canvas-soft" title="Create poll" onClick={() => setShowPoll((v) => !v)}>
            <BarChart3 className="h-5 w-5" />
          </button>
          <button className="rounded-full p-2 text-body hover:bg-canvas-soft" title="Disappearing messages" onClick={() => setShowTimer((v) => !v)}>
            <Timer className={cn("h-5 w-5", !!chat.disappearAfter && "text-positive-deep")} />
          </button>

          <textarea
            ref={textareaRef}
            value={text}
            onChange={(e) => {
              setText(e.target.value)
              emitTyping()
            }}
            onBlur={stopTyping}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault()
                void send()
              }
            }}
            rows={1}
            placeholder="Write a message… **bold**, `code`, ``` ``` supported"
            className="max-h-32 min-h-[44px] flex-1 resize-none rounded-md bg-canvas-soft/70 px-4 py-2.5 text-[15px] text-ink outline-none placeholder:text-mute focus:bg-canvas-soft"
          />

          {text.trim() ? (
            <button
              onClick={() => void send()}
              disabled={busy}
              className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-primary text-on-primary transition-transform hover:scale-105 disabled:opacity-50"
              title="Send"
            >
              {busy ? <Spinner className="border-on-primary/30 border-t-on-primary" /> : <Send className="h-5 w-5" />}
            </button>
          ) : (
            <button
              onClick={startRecording}
              className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-canvas-soft text-ink hover:bg-primary-pale"
              title="Record voice note"
            >
              <Mic className="h-5 w-5" />
            </button>
          )}
        </div>
      )}

      <input ref={fileRef} type="file" className="hidden" onChange={onFileChange} />
      <input ref={imageRef} type="file" accept="image/*" className="hidden" onChange={onFileChange} />
    </div>
  )
}

function PollComposer({
  onDone,
  onCancel,
}: {
  onDone: (question: string, options: string[], allowMultiple: boolean, anonymous: boolean) => void
  onCancel: () => void
}) {
  const [question, setQuestion] = useState("")
  const [options, setOptions] = useState(["", ""])
  const [allowMultiple, setAllowMultiple] = useState(false)
  const [anonymous, setAnonymous] = useState(false)

  return (
    <div className="mb-2 rounded-md bg-canvas-soft p-3">
      <input
        className="mb-2 w-full rounded-md border border-ink/30 bg-canvas px-3 py-2 text-sm outline-none"
        placeholder="Ask a question…"
        value={question}
        onChange={(e) => setQuestion(e.target.value)}
      />
      {options.map((o, i) => (
        <input
          key={i}
          className="mb-1 w-full rounded-md border border-ink/20 bg-canvas px-3 py-1.5 text-sm outline-none"
          placeholder={`Option ${i + 1}`}
          value={o}
          onChange={(e) => setOptions((opts) => opts.map((x, j) => (j === i ? e.target.value : x)))}
        />
      ))}
      <button className="mb-2 text-xs font-semibold text-positive-deep" onClick={() => options.length < 10 && setOptions([...options, ""])}>
        + Add option
      </button>
      <div className="flex flex-wrap items-center gap-4 text-xs text-body">
        <label className="flex items-center gap-1.5">
          <input type="checkbox" checked={allowMultiple} onChange={(e) => setAllowMultiple(e.target.checked)} />
          Multiple choice
        </label>
        <label className="flex items-center gap-1.5">
          <input type="checkbox" checked={anonymous} onChange={(e) => setAnonymous(e.target.checked)} />
          Anonymous voting
        </label>
        <span className="flex-1" />
        <button className="font-semibold text-mute" onClick={onCancel}>
          Cancel
        </button>
        <button
          className="rounded-pill bg-primary px-4 py-1 font-semibold text-on-primary disabled:opacity-50"
          disabled={!question.trim() || options.filter((o) => o.trim()).length < 2}
          onClick={() => onDone(question.trim(), options.map((o) => o.trim()).filter(Boolean), allowMultiple, anonymous)}
        >
          Create poll
        </button>
      </div>
    </div>
  )
}
