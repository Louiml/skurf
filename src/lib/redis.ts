import { Redis } from "ioredis"
import { getEnv } from "./env"

const globalForRedis = globalThis as unknown as {
  redis?: Redis
  redisSub?: Redis
}

export function getRedis(): Redis {
  if (!globalForRedis.redis) {
    globalForRedis.redis = new Redis(getEnv().REDIS_URL, { maxRetriesPerRequest: null })
  }
  return globalForRedis.redis
}

export function getRedisSub(): Redis {
  if (!globalForRedis.redisSub) {
    globalForRedis.redisSub = new Redis(getEnv().REDIS_URL, { maxRetriesPerRequest: null })
  }
  return globalForRedis.redisSub
}

export const PRESENCE_TTL_SECONDS = 60

export async function markOnline(userId: string, socketId: string) {
  const r = getRedis()
  await r.hset(`presence:${userId}`, socketId, Date.now().toString())
  await r.expire(`presence:${userId}`, PRESENCE_TTL_SECONDS)
}

export async function markSocketOffline(userId: string, socketId: string) {
  const r = getRedis()
  await r.hdel(`presence:${userId}`, socketId)
  const remaining = await r.hlen(`presence:${userId}`)
  return remaining === 0
}

export async function isOnline(userId: string) {
  const r = getRedis()
  const n = await r.hlen(`presence:${userId}`)
  return n > 0
}
