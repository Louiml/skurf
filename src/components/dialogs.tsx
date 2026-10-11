"use client"

import { useEffect, useState } from "react"
import { useRouter } from "next/navigation"
import { Modal, Button, Input, Avatar, Badge, Toggle, Textarea, cn, EmptyState } from "@/components/ui"
import { useStore, type Chat } from "@/lib/client/store"
import { chatNameSafe, DISAPPEAR_OPTIONS } from "@/lib/client/store-helpers"
import { GET, POST, PATCH, DELETE, deviceId } from "@/lib/client/api"
import { safetyNumber } from "@/lib/crypto/protocol"
import QRCode from "qrcode"
import { Smartphone, Shield, Trash2, QrCode, UserPlus, Megaphone, Users, LogOut, FolderPlus, Eye, EyeOff, Lock, Fingerprint } from "lucide-react"
import { setPasscode, clearPasscode } from "@/lib/client/passcode"
import { startRegistration } from "@simplewebauthn/browser"

export function NewChatDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const router = useRouter()
  const { createDirect, createGroup, createChannel } = useStore()
  const [tab, setTab] = useState<"dm" | "group" | "channel">("dm")
  const [username, setUsername] = useState("")
  const [title, setTitle] = useState("")
  const [handle, setHandle] = useState("")
  const [members, setMembers] = useState("")
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  async function submit() {
    setBusy(true)
    setError(null)
    try {
      if (tab === "dm") {
        const id = await createDirect(username.trim())
        router.push(`/app/chats/${id}`)
      } else if (tab === "group") {
        const names = members.split(/[,\s]+/).map((s) => s.trim()).filter(Boolean)
        const id = await createGroup(title.trim(), names)
        router.push(`/app/chats/${id}`)
      } else {
        const id = await createChannel(title.trim(), handle.trim())
        router.push(`/app/chats/${id}`)
      }
      onClose()
      setUsername("")
      setTitle("")
      setMembers("")
      setHandle("")
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal open={open} onClose={onClose} title="New conversation">
      <div className="mb-4 flex gap-2">
        {(
          [
            ["dm", "Direct", <Users key="u" className="h-4 w-4" />],
            ["group", "Group", <Users key="g" className="h-4 w-4" />],
            ["channel", "Channel", <Megaphone key="c" className="h-4 w-4" />],
          ] as const
        ).map(([id, label, icon]) => (
          <button
            key={id}
            onClick={() => setTab(id)}
            className={cn(
              "flex items-center gap-1.5 rounded-pill px-3 py-1.5 text-sm font-semibold",
              tab === id ? "bg-ink text-primary" : "bg-canvas-soft text-body hover:bg-primary-pale"
            )}
          >
            {icon}
            {label}
          </button>
        ))}
      </div>
      <div className="space-y-3">
        {tab === "dm" && <Input placeholder="their username" value={username} onChange={(e) => setUsername(e.target.value)} />}
        {(tab === "group" || tab === "channel") && (
          <Input placeholder={tab === "group" ? "Group name" : "Channel name"} value={title} onChange={(e) => setTitle(e.target.value)} />
        )}
        {tab === "channel" && <Input placeholder="handle (e.g. news_daily)" value={handle} onChange={(e) => setHandle(e.target.value)} />}
        {tab === "group" && (
          <Textarea placeholder="member usernames, comma separated" value={members} onChange={(e) => setMembers(e.target.value)} rows={2} />
        )}
        {tab === "channel" && (
          <p className="text-xs text-body">Channels broadcast to unlimited subscribers. Channel posts are not end-to-end encrypted (like Telegram).</p>
        )}
        {error && <p className="text-sm text-negative">{error}</p>}
        <Button className="w-full" onClick={submit} disabled={busy}>
          {busy ? "Creating…" : tab === "dm" ? "Start chat" : tab === "group" ? "Create group" : "Create channel"}
        </Button>
      </div>
    </Modal>
  )
}

export function ChatInfoDialog({
  chat,
  open,
  onClose,
  onToast,
}: {
  chat: Chat
  open: boolean
  onClose: () => void
  onToast: (msg: string) => void
}) {
  const { me, leaveChat, setDisappearing, addMembers, createFolder, assignFolderChats, folders } = useStore()
  const [addOpen, setAddOpen] = useState(false)
  const [newMember, setNewMember] = useState("")
  const [sn, setSn] = useState<string | null>(null)
  const isAdmin = chat.role === "OWNER" || chat.role === "ADMIN"
  const other = chat.members.find((m) => m.userId !== me?.id)

  useEffect(() => {
    if (open && chat.type === "DIRECT" && other) {
      safetyNumber(me!.identityKey, other.user.identityKey).then(setSn)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, chat.id])

  return (
    <Modal open={open} onClose={onClose} title={chatNameSafe(chat, me?.id ?? null)} wide>
      <div className="space-y-4">
        <div className="flex flex-wrap gap-2">
          {chat.members.map((m) => (
            <div key={m.userId} className="flex items-center gap-2 rounded-pill bg-canvas-soft py-1 pl-1 pr-3">
              <Avatar name={m.user.displayName} size={28} />
              <div>
                <div className="text-sm font-semibold leading-4">{m.userId === me?.id ? "You" : m.user.displayName}</div>
                <div className="text-[11px] leading-3 text-mute">@{m.user.username} · {m.role.toLowerCase()}</div>
              </div>
            </div>
          ))}
        </div>

        {sn && (
          <div className="rounded-lg bg-canvas-soft p-4">
            <div className="mb-1 flex items-center gap-2 text-sm font-semibold">
              <Shield className="h-4 w-4" /> Safety number
            </div>
            <p className="font-mono text-sm tracking-wider">{sn}</p>
            <p className="mt-1 text-xs text-body">Compare these digits with your contact in person or on another channel. If they match, your chat is secure.</p>
          </div>
        )}

        <div>
          <div className="mb-2 text-sm font-semibold">Disappearing messages</div>
          <div className="flex flex-wrap gap-1">
            {DISAPPEAR_OPTIONS.map((o) => (
              <button
                key={o.label}
                className={cn(
                  "rounded-pill px-3 py-1 text-xs font-semibold",
                  chat.disappearAfter === o.seconds ? "bg-ink text-primary" : "bg-canvas-soft text-body hover:bg-primary-pale"
                )}
                onClick={() => {
                  setDisappearing(chat.id, o.seconds)
                  onToast(o.seconds ? `Messages vanish after ${o.label}` : "Disappearing messages off")
                }}
              >
                {o.label}
              </button>
            ))}
          </div>
        </div>

        <div>
          <div className="mb-2 text-sm font-semibold">Folders</div>
          <div className="flex flex-wrap gap-1">
            {folders.map((f) => (
              <button
                key={f.id}
                className={cn(
                  "rounded-pill px-3 py-1 text-xs font-semibold",
                  f.chatIds.includes(chat.id) ? "bg-primary-pale text-positive-deep" : "bg-canvas-soft text-body hover:bg-primary-pale"
                )}
                onClick={() => {
                  const next = f.chatIds.includes(chat.id) ? f.chatIds.filter((id) => id !== chat.id) : [...f.chatIds, chat.id]
                  assignFolderChats(f.id, next)
                }}
              >
                {f.emoji ?? "📁"} {f.name}
              </button>
            ))}
            <button
              className="rounded-pill bg-canvas-soft px-3 py-1 text-xs font-semibold text-body hover:bg-primary-pale"
              onClick={async () => {
                const name = prompt("Folder name?")
                if (name?.trim()) {
                  await createFolder(name.trim())
                  onToast("Folder created — click again to assign this chat")
                }
              }}
            >
              <FolderPlus className="mr-1 inline h-3 w-3" /> New
            </button>
          </div>
        </div>

        {(chat.type === "GROUP" || chat.type === "CHANNEL") && isAdmin && (
          <div>
            <div className="mb-2 text-sm font-semibold">Add members</div>
            {addOpen ? (
              <div className="flex gap-2">
                <Input placeholder="username" value={newMember} onChange={(e) => setNewMember(e.target.value)} />
                <Button
                  size="sm"
                  onClick={async () => {
                    try {
                      await addMembers(chat.id, [newMember.trim()])
                      setNewMember("")
                      setAddOpen(false)
                      onToast("Member added — distributing new encryption key")
                    } catch (err) {
                      onToast((err as Error).message)
                    }
                  }}
                >
                  Add
                </Button>
              </div>
            ) : (
              <Button variant="secondary" size="sm" onClick={() => setAddOpen(true)}>
                <UserPlus className="h-4 w-4" /> Add people
              </Button>
            )}
          </div>
        )}

        {chat.type === "CHANNEL" && chat.handle && (
          <p className="text-sm text-body">
            Public link: <span className="font-mono text-ink">@{chat.handle}</span> — share it so people can discover and subscribe.
          </p>
        )}

        {chat.type !== "SAVED" && (
          <Button
            variant="danger"
            onClick={async () => {
              if (confirm(chat.role === "OWNER" ? "Delete this chat for everyone?" : "Leave this chat?")) {
                await leaveChat(chat.id)
                onClose()
                window.location.href = "/app"
              }
            }}
          >
            <LogOut className="h-4 w-4" /> {chat.role === "OWNER" ? "Delete chat" : "Leave chat"}
          </Button>
        )}
      </div>
    </Modal>
  )
}

export function SettingsDialog({
  open,
  onClose,
  folderPickerChat,
  onFolderPickerClose,
}: {
  open: boolean
  onClose: () => void
  folderPickerChat?: Chat | null
  onFolderPickerClose?: () => void
}) {
  const router = useRouter()
  const { me, savedChatId, folders, chats, createFolder, deleteFolder, refreshChats, setPasscode: setStorePasscode, hasPasscode } = useStore()
  const [devices, setDevices] = useState<Array<{ id: string; name: string; platform: string; lastActiveAt: string; createdAt: string }>>([])
  const [qr, setQr] = useState<string | null>(null)
  const [displayName, setDisplayName] = useState(me?.displayName ?? "")
  const [bio, setBio] = useState(me?.bio ?? "")
  const [lastSeen, setLastSeen] = useState(me?.lastSeenVisibility ?? "EVERYONE")
  const [receipts, setReceipts] = useState(me?.readReceiptsEnabled ?? true)
  const [passcode, setPasscodeInput] = useState("")
  const [passcodeOn, setPasscodeOn] = useState(hasPasscode)
  const [error, setError] = useState<string | null>(null)
  const myDevice = deviceId()

  useEffect(() => {
    if (open) {
      GET<{ devices: typeof devices; passkeyCount: number }>("/api/devices").then((r) => setDevices(r.devices))
      setPasscodeOn(hasPasscode)
    }
  }, [open, hasPasscode])

  async function makeQr() {
    const res = await POST<{ url: string; token: string }>("/api/devices/link", {})
    const dataUrl = await QRCode.toDataURL(res.url, { width: 240, margin: 1 })
    setQr(dataUrl)
  }

  async function registerPasskey() {
    try {
      const options = await POST<Record<string, unknown>>("/api/auth/webauthn/register", { start: true })
      const att = await startRegistration(options as any)
      await POST("/api/auth/webauthn/register", { response: att })
      setError(null)
      alert("Passkey registered! You can now log in without a password.")
    } catch (err) {
      setError((err as Error).message)
    }
  }

  return (
    <Modal open={open} onClose={onClose} title="Settings" wide>
      <div className="space-y-6">
        <section>
          <h3 className="mb-2 text-lg font-semibold">Profile</h3>
          <div className="flex items-center gap-3">
            <Avatar name={displayName || "me"} size={56} />
            <div className="flex-1 space-y-2">
              <Input value={displayName} onChange={(e) => setDisplayName(e.target.value)} placeholder="Display name" />
              <Input value={bio} onChange={(e) => setBio(e.target.value)} placeholder="Bio" />
              <Button
                size="sm"
                onClick={async () => {
                  await PATCH("/api/me/privacy", { displayName, bio })
                  await refreshChats()
                }}
              >
                Save profile
              </Button>
            </div>
          </div>
        </section>

        <section>
          <h3 className="mb-2 text-lg font-semibold">Privacy</h3>
          <div className="space-y-3 rounded-lg bg-canvas-soft p-4 text-sm">
            <div className="flex items-center justify-between">
              <span className="flex items-center gap-2">
                <Eye className="h-4 w-4" /> Last seen
              </span>
              <select
                className="rounded-md border border-ink/30 bg-canvas px-2 py-1 text-sm"
                value={lastSeen}
                onChange={async (e) => {
                  setLastSeen(e.target.value as any)
                  await PATCH("/api/me/privacy", { lastSeenVisibility: e.target.value })
                }}
              >
                <option value="EVERYONE">Everyone</option>
                <option value="CONTACTS">Contacts</option>
                <option value="NONE">Nobody</option>
              </select>
            </div>
            <div className="flex items-center justify-between">
              <span className="flex items-center gap-2">
                <EyeOff className="h-4 w-4" /> Read receipts
              </span>
              <Toggle
                checked={receipts}
                onChange={async (v) => {
                  setReceipts(v)
                  await PATCH("/api/me/privacy", { readReceiptsEnabled: v })
                }}
              />
            </div>
            <div className="flex items-center justify-between">
              <span className="flex items-center gap-2">
                <Fingerprint className="h-4 w-4" /> Passkey login
              </span>
              <Button size="sm" variant="secondary" onClick={registerPasskey}>
                Add passkey
              </Button>
            </div>
          </div>
          {error && <p className="mt-1 text-sm text-negative">{error}</p>}
        </section>

        <section>
          <h3 className="mb-2 text-lg font-semibold">App lock (passcode)</h3>
          <div className="flex items-center gap-2">
            <Toggle
              checked={passcodeOn}
              onChange={async (v) => {
                if (v) {
                  if (passcode.length < 4) {
                    setError("Enter a 4+ digit passcode above first")
                    return
                  }
                  await setPasscode(passcode)
                  setPasscodeInput("")
                  setPasscodeOn(true)
                  setStorePasscode(true)
                  setError(null)
                } else {
                  await clearPasscode()
                  setPasscodeOn(false)
                  setStorePasscode(false)
                }
              }}
              label="Passcode lock"
            />
            <Input
              type="password"
              placeholder="new passcode (4+ digits)"
              value={passcode}
              onChange={(e) => setPasscodeInput(e.target.value)}
              className="max-w-[220px]"
              inputMode="numeric"
            />
            <Lock className="h-4 w-4 text-mute" />
          </div>
          <p className="mt-1 text-xs text-body">
            {passcodeOn
              ? "Device keys are encrypted with your passcode. You'll be asked for it when the app opens."
              : "No lock. Anyone with access to this browser profile can read this device's messages."}
          </p>
        </section>

        <section>
          <h3 className="mb-2 text-lg font-semibold">
            Linked devices
          </h3>
          <div className="space-y-2">
            {devices.map((d) => (
              <div key={d.id} className="flex items-center justify-between rounded-lg bg-canvas-soft px-3 py-2 text-sm">
                <span className="flex items-center gap-2">
                  <Smartphone className="h-4 w-4" />
                  <span>
                    <span className="font-semibold">{d.name}</span>
                    {d.id === myDevice && <Badge className="ml-2">this device</Badge>}
                    <span className="block text-xs text-mute">last active {new Date(d.lastActiveAt).toLocaleString()}</span>
                  </span>
                </span>
                <button
                  className="rounded-full p-2 text-negative hover:bg-negative-bg/10"
                  title="Revoke device"
                  onClick={async () => {
                    if (confirm(`Revoke "${d.name}"? Its encrypted history will be lost on that device.`)) {
                      await DELETE(`/api/devices?id=${d.id}`)
                      setDevices((ds) => ds.filter((x) => x.id !== d.id))
                    }
                  }}
                >
                  <Trash2 className="h-4 w-4" />
                </button>
              </div>
            ))}
          </div>
          <div className="mt-2 flex items-center gap-2">
            <Button size="sm" variant="secondary" onClick={makeQr}>
              <QrCode className="h-4 w-4" /> Link a device
            </Button>
            {qr && (
              <div className="flex items-center gap-3 rounded-lg bg-canvas-soft p-3">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={qr} alt="Device link QR" className="h-28 w-28 rounded-md bg-white p-1" />
                <div className="text-xs text-body">
                  Scan this QR with your other device's Skurf app (open <span className="font-mono">/link</span> page).<br />
                  Valid for 5 minutes. Keys stay independent per device.
                </div>
              </div>
            )}
          </div>
        </section>

        <section>
          <h3 className="mb-2 text-lg font-semibold">Folders</h3>
          <div className="flex flex-wrap items-center gap-1">
            {folders.map((f) => (
              <span key={f.id} className="flex items-center gap-1 rounded-pill bg-canvas-soft px-3 py-1 text-xs font-semibold">
                {f.emoji ?? "📁"} {f.name}
                <button
                  className="text-mute hover:text-negative"
                  onClick={async () => {
                    await deleteFolder(f.id)
                  }}
                >
                  ×
                </button>
              </span>
            ))}
            <button
              className="rounded-pill bg-canvas-soft px-3 py-1 text-xs font-semibold hover:bg-primary-pale"
              onClick={async () => {
                const name = prompt("Folder name?")
                if (name?.trim()) await createFolder(name.trim())
              }}
            >
              + New folder
            </button>
          </div>
        </section>

        <section className="flex justify-between border-t border-ink/10 pt-4">
          <Button
            variant="secondary"
            onClick={async () => {
              await POST("/api/auth/logout", {})
              window.location.href = "/"
            }}
          >
            Log out
          </Button>
          {savedChatId && (
            <Button variant="tertiary" onClick={() => router.push(`/app/chats/${savedChatId}`)}>
              Saved messages
            </Button>
          )}
        </section>
      </div>
    </Modal>
  )
}
