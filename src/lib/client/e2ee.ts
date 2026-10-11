import nacl from "tweetnacl"
import {
  Ratchet,
  WireMessage,
  KeyBundle,
  PreKeyMessage,
  toB64,
  fromB64,
  utf8,
  x3dhInitiator,
  x3dhResponder,
  encryptGroup,
  decryptGroup,
  newEpochSeed,
  ChatPayload,
} from "@/lib/crypto/protocol"
import { db, getDeviceId, getMeta } from "./dexie"
import { POST, GET, setDeviceId } from "./api"

const OPK_BATCH = 60
const OPK_LOW_WATER = 10

interface DeviceBundleResponse {
  devices: Array<{
    deviceId: string
    identityKey: string
    signingKey: string
    signedPreKeyId: number
    signedPreKey: string
    signedPreKeySig: string
    oneTimePreKeyId?: number
    oneTimePreKey?: string
  }>
  user?: { displayName: string; username: string } | null
}

export async function hasLocalDevice(): Promise<boolean> {
  const deviceId = await getDeviceId()
  if (!deviceId) return false
  return (await db.deviceKeys.get(deviceId)) !== undefined
}

export async function initDevice(name: string, platform: "web" | "ios" | "android" | "desktop" = "web") {
  const identity = nacl.box.keyPair()
  const signing = nacl.sign.keyPair()
  const spk = nacl.box.keyPair()
  const spkSig = nacl.sign.detached(spk.publicKey, signing.secretKey)
  const oneTime: Array<{ keyId: number; publicKey: string }> = []
  const nextOpkId = 1
  for (let i = 0; i < OPK_BATCH; i++) {
    const opk = nacl.box.keyPair()
    oneTime.push({ keyId: i + nextOpkId, publicKey: toB64(opk.publicKey) })
    await db.opkSecrets.put({ keyId: i + nextOpkId, secret: toB64(opk.secretKey) })
  }
  const res = await POST<{ deviceId: string }>("/api/keys/device", {
    name,
    platform,
    identityKey: toB64(identity.publicKey),
    signingKey: toB64(signing.publicKey),
    registrationId: Math.floor(Math.random() * 16384),
    signedPreKeyId: nextOpkId,
    signedPreKey: toB64(spk.publicKey),
    signedPreKeySig: toB64(spkSig),
    oneTimePreKeys: oneTime,
  })
  await db.deviceKeys.put({
    deviceId: res.deviceId,
    identitySecret: toB64(identity.secretKey),
    signingSecret: toB64(signing.secretKey),
    spkSecret: toB64(spk.secretKey),
    spkId: nextOpkId,
    nextOpkId: nextOpkId + OPK_BATCH,
  })
  setDeviceId(res.deviceId)
  return res.deviceId
}

export async function getLocalKeys() {
  const deviceId = await getDeviceId()
  if (!deviceId) throw new Error("Device not initialized")
  const keys = await db.deviceKeys.get(deviceId)
  if (!keys) throw new Error("Device keys missing")
  return keys
}

async function identityPair() {
  const keys = await getLocalKeys()
  return nacl.box.keyPair.fromSecretKey(fromB64(keys.identitySecret))
}

export async function replenishPreKeys() {
  const keys = await getLocalKeys()
  const unused = await db.opkSecrets.count()
  if (unused > OPK_LOW_WATER) return
  const oneTime: Array<{ keyId: number; publicKey: string }> = []
  let id = keys.nextOpkId
  for (let i = 0; i < OPK_BATCH; i++) {
    const opk = nacl.box.keyPair()
    oneTime.push({ keyId: id, publicKey: toB64(opk.publicKey) })
    await db.opkSecrets.put({ keyId: id, secret: toB64(opk.secretKey) })
    id++
  }
  await POST("/api/keys/prekeys", { oneTimePreKeys: oneTime })
  await db.deviceKeys.update(keys.deviceId, { nextOpkId: id })
}

export async function fetchBundle(userId: string, deviceId?: string): Promise<DeviceBundleResponse> {
  const res = await GET<DeviceBundleResponse>(`/api/keys/bundle/${userId}`)
  if (deviceId) {
    res.devices = res.devices.filter((d) => d.deviceId === deviceId)
  }
  return res
}

function ratchetKey(peerUserId: string, peerDeviceId: string) {
  return `${peerUserId}:${peerDeviceId}`
}

export async function encryptForDevice(
  peerUserId: string,
  peerDeviceId: string,
  payload: ChatPayload | Record<string, unknown>
): Promise<string> {
  const me = await identityPair()
  const key = ratchetKey(peerUserId, peerDeviceId)
  const existing = await db.ratchets.get(key)
  const pt = utf8(JSON.stringify(payload))
  let wire: WireMessage
  if (existing) {
    const ratchet = Ratchet.deserialize(existing.state)
    wire = await ratchet.encrypt(pt)
    await saveRatchet(peerUserId, peerDeviceId, existing.peerIdentityKey, ratchet, false)
  } else {
    const { devices } = await fetchBundle(peerUserId, peerDeviceId)
    const bundle = devices[0]
    if (!bundle) throw new Error("No active device for peer")
    const { sk, preKeyMsg } = await x3dhInitiator(me, bundle)
    const ephemeralRatchet = await Ratchet.initAsInitiator(sk, fromB64(bundle.signedPreKey))
    wire = await ephemeralRatchet.encrypt(pt)
    wire.pk = preKeyMsg
    await saveRatchet(peerUserId, peerDeviceId, bundle.identityKey, ephemeralRatchet, true)
  }
  return JSON.stringify(wire)
}

async function saveRatchet(
  peerUserId: string,
  peerDeviceId: string,
  peerIdentityKey: string,
  ratchet: Ratchet,
  newSession: boolean
) {
  await db.ratchets.put({
    key: ratchetKey(peerUserId, peerDeviceId),
    peerUserId,
    peerDeviceId,
    peerIdentityKey,
    state: ratchet.serialize(),
    newSession,
    updatedAt: Date.now(),
  })
}

export async function decryptFromDevice(
  fromUserId: string,
  fromDeviceId: string,
  wireJson: string
): Promise<ChatPayload | Record<string, unknown>> {
  const wire = JSON.parse(wireJson) as WireMessage
  const key = ratchetKey(fromUserId, fromDeviceId)
  let row = await db.ratchets.get(key)

  let ratchet: Ratchet
  if (row && (!wire.pk || !row.newSession)) {
    ratchet = Ratchet.deserialize(row.state)
  } else if (wire.pk) {
    const keys = await getLocalKeys()
    const identity = nacl.box.keyPair.fromSecretKey(fromB64(keys.identitySecret))
    const spkPair = nacl.box.keyPair.fromSecretKey(fromB64(keys.spkSecret))
    let opkPair: nacl.BoxKeyPair | null = null
    if (wire.pk.opkId !== undefined) {
      const secret = await db.opkSecrets.get(wire.pk.opkId)
      if (secret) {
        opkPair = nacl.box.keyPair.fromSecretKey(fromB64(secret.secret))
        await db.opkSecrets.delete(wire.pk.opkId)
      }
    }
    const sk = await x3dhResponder(identity, spkPair, opkPair, wire.pk)
    ratchet = await Ratchet.initAsResponder(sk, spkPair)
  } else {
    throw new Error("No session for message")
  }

  const pt = await ratchet.decrypt(wire)
  await saveRatchet(fromUserId, fromDeviceId, row?.peerIdentityKey ?? "", ratchet, false)
  const dec = new TextDecoder()
  return JSON.parse(dec.decode(pt))
}

// ─── Group epochs ───────────────────────────────────────────────────────────

export async function getLatestEpoch(chatId: string): Promise<{ epoch: number; seed: Uint8Array } | null> {
  const rows = await db.epochs.where("chatId").equals(chatId).toArray()
  if (rows.length === 0) return null
  rows.sort((a, b) => b.epoch - a.epoch)
  return { epoch: rows[0].epoch, seed: fromB64(rows[0].seed) }
}

export async function storeEpoch(chatId: string, epoch: number, seed: Uint8Array) {
  await db.epochs.put({
    key: `${chatId}:${epoch}`,
    chatId,
    epoch,
    seed: toB64(seed),
    updatedAt: Date.now(),
  })
}

export async function createEpoch(chatId: string): Promise<{ epoch: number; seed: Uint8Array }> {
  const latest = await getLatestEpoch(chatId)
  const epoch = (latest?.epoch ?? -1) + 1
  const seed = newEpochSeed()
  await storeEpoch(chatId, epoch, seed)
  return { epoch, seed }
}

export async function distributeEpoch(
  chatId: string,
  epoch: number,
  seed: Uint8Array,
  memberUserIds: string[]
) {
  const myDeviceId = await getDeviceId()
  const payload = { t: "epoch", chatId, epoch, seed: toB64(seed) }
  const targets: string[] = []
  for (const userId of memberUserIds) {
    const { devices } = await fetchBundle(userId)
    for (const d of devices) {
      if (userId === (await currentUserId()) && d.deviceId === myDeviceId) continue
      targets.push(`${userId}|${d.deviceId}`)
    }
  }
  for (const target of targets) {
    const [userId, deviceId] = target.split("|")
    const payloadJson = await encryptForDevice(userId, deviceId, payload)
    await POST("/api/control/send", { toUserId: userId, toDeviceId: deviceId, payload: payloadJson, type: "EPOCH", chatId })
  }
}

export async function currentUserId(): Promise<string> {
  return (await getMeta<string>("userId")) ?? ""
}

export async function encryptGroupMessage(
  chatId: string,
  payload: ChatPayload
): Promise<{ body: string; meta: string } | null> {
  const epoch = await getLatestEpoch(chatId)
  if (!epoch) return null
  const sealed = await encryptGroup(epoch.seed, chatId, epoch.epoch, utf8(JSON.stringify(payload)))
  return { body: toB64(sealed), meta: JSON.stringify({ e: epoch.epoch }) }
}

export async function decryptGroupMessage(chatId: string, meta: string | null, body: string): Promise<ChatPayload | null> {
  const epochInfo = meta ? (JSON.parse(meta) as { e?: number }) : null
  if (!epochInfo?.e && epochInfo?.e !== 0) return null
  const rows = await db.epochs.where("[chatId+epoch]").equals([chatId, epochInfo.e]).toArray()
  if (rows.length === 0) return null
  const seed = fromB64(rows[0].seed)
  const dec = new TextDecoder()
  const pt = await decryptGroup(seed, chatId, epochInfo.e, fromB64(body))
  return JSON.parse(dec.decode(pt))
}

export async function encryptChannelPayload(payload: ChatPayload): Promise<string> {
  return JSON.stringify(payload)
}
