import { createServer } from "node:http"
import next from "next"
import { Server } from "socket.io"
import { setupSocketIO, sweepExpired } from "./src/server/socket"
import { prisma } from "./src/lib/db"

const dev = process.env.NODE_ENV !== "production"
const port = parseInt(process.env.PORT ?? "3000", 10)

async function main() {
  const app = next({ dev })
  const handle = app.getRequestHandler()
  await app.prepare()

  const httpServer = createServer((req, res) => {
    handle(req, res).catch((err) => {
      console.error(err)
      res.statusCode = 500
      res.end("Internal error")
    })
  })

  const io = new Server(httpServer, {
    path: "/socket.io",
    cors: { origin: (process.env.ORIGINS ?? "http://localhost:3000").split(","), credentials: true },
  })
  setupSocketIO(io as any)

  const sweeper = setInterval(() => void sweepExpired(prisma), 30_000)
  sweeper.unref?.()

  httpServer.listen(port, () => {
    console.log(`> Skurf ready on http://localhost:${port} (${dev ? "dev" : "production"})`)
  })
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
