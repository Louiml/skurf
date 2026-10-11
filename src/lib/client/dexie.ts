import Dexie, { type EntityTable } from "dexie"
import type { RatchetState, KeyBundle } from "@/lib/crypto/protocol"

export interface DeviceKeys {
  deviceId: string
  identitySecret: string
  signingSecret: string
  spkSecret: string
  spkId: number
  nextOpkId: number
}

export interface RatchetRow {
  key: string
  peerUserId: string
  peerDeviceId: string
  peerIdentityKey: string
  state: RatchetState
  newSession: boolean
  updatedAt: number
}

export interface BundleRow {
  key: string
  bundle: KeyBundle & { deviceId: string }
  fetchedAt: number
}

export interface EpochRow {
  key: string
  chatId: string
  epoch: number
  seed: string
  updatedAt: number
}

export interface OpkSecretRow {
  keyId: number
  secret: string
}

export interface MetaRow {
  key: string
  value: unknown
}

export interface PasscodeWrap {
  key: string
  salt: string
  iv: string
  wrapped: string
}

export interface LocalMessage {
  id: string
  chatId: string
  senderId: string
  type: string
  seq: number
  createdAt: string
  editedAt?: string | null
  expiresAt?: string | null
  payloadJson: string | null
  epoch?: number | null
}

export class SkurfDB extends Dexie {
  deviceKeys!: EntityTable<DeviceKeys, "deviceId">
  ratchets!: EntityTable<RatchetRow, "key">
  bundles!: EntityTable<BundleRow, "key">
  epochs!: EntityTable<EpochRow, "key">
  opkSecrets!: EntityTable<OpkSecretRow, "keyId">
  meta!: EntityTable<MetaRow, "key">
  passcode!: EntityTable<PasscodeWrap, "key">
  messages!: EntityTable<LocalMessage, "id">

  constructor() {
    super("skurf")
    this.version(1).stores({
      deviceKeys: "deviceId",
      ratchets: "key, peerUserId, peerDeviceId, updatedAt",
      bundles: "key, &[userId+deviceId], fetchedAt",
      epochs: "key, chatId, epoch, [chatId+epoch]",
      opkSecrets: "keyId",
      meta: "key",
      passcode: "key",
      messages: "id, chatId, seq, createdAt",
    })
  }
}

export const db = new SkurfDB()

export async function getMeta<T>(key: string): Promise<T | null> {
  const row = await db.meta.get(key)
  return (row?.value as T) ?? null
}

export async function setMeta(key: string, value: unknown) {
  await db.meta.put({ key, value })
}

export async function getDeviceId(): Promise<string | null> {
  return getMeta<string>("deviceId")
}
