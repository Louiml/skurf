import esbuild from "esbuild"

const dev = process.env.NODE_ENV !== "production"

await esbuild.build({
  entryPoints: ["server.ts"],
  outfile: ".server/server.cjs",
  bundle: true,
  platform: "node",
  format: "cjs",
  sourcemap: dev,
  external: [
    "next",
    "@prisma/client",
    "socket.io",
    "socket.io-client",
    "ioredis",
    "@socket.io/redis-adapter",
  ],
})

console.log("server built -> .server/server.cjs")
