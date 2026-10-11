import { z } from "zod"

export const envSchema = z.object({
  DATABASE_URL: z.string().min(1),
  REDIS_URL: z.string().min(1),
  JWT_SECRET: z.string().min(32),
  NEXT_PUBLIC_APP_URL: z.string().url().default("http://localhost:3000"),
  MEDIA_DIR: z.string().default("./data/media"),
  RP_ID: z.string().default("localhost"),
  RP_NAME: z.string().default("Skurf"),
  ORIGINS: z.string().default("http://localhost:3000"),
  STUN_URL: z.string().default("stun:stun.l.google.com:19302"),
  TURN_URL: z.string().optional(),
  TURN_USERNAME: z.string().optional(),
  TURN_CREDENTIAL: z.string().optional(),
})

export type Env = z.infer<typeof envSchema>

function loadEnv(): Env {
  return envSchema.parse({
    DATABASE_URL: process.env.DATABASE_URL,
    REDIS_URL: process.env.REDIS_URL,
    JWT_SECRET: process.env.JWT_SECRET,
    NEXT_PUBLIC_APP_URL: process.env.NEXT_PUBLIC_APP_URL,
    MEDIA_DIR: process.env.MEDIA_DIR,
    RP_ID: process.env.RP_ID,
    RP_NAME: process.env.RP_NAME,
    ORIGINS: process.env.ORIGINS,
    STUN_URL: process.env.STUN_URL,
    TURN_URL: process.env.TURN_URL,
    TURN_USERNAME: process.env.TURN_USERNAME,
    TURN_CREDENTIAL: process.env.TURN_CREDENTIAL,
  })
}

let cached: Env | null = null
export function getEnv(): Env {
  if (!cached) cached = loadEnv()
  return cached
}
