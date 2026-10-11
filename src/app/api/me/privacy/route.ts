import { NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/db"
import { handleRoute, requireUser } from "@/lib/auth/session"
import { privacySchema } from "@/lib/validations"

export async function PATCH(req: NextRequest) {
  return handleRoute(async () => {
    const user = await requireUser(req)
    const input = privacySchema.parse(await req.json())
    const updated = await prisma.user.update({
      where: { id: user.id },
      data: {
        displayName: input.displayName,
        bio: input.bio,
        lastSeenVisibility: input.lastSeenVisibility,
        readReceiptsEnabled: input.readReceiptsEnabled,
      },
    })
    return NextResponse.json({
      user: {
        id: updated.id,
        displayName: updated.displayName,
        bio: updated.bio,
        lastSeenVisibility: updated.lastSeenVisibility,
        readReceiptsEnabled: updated.readReceiptsEnabled,
      },
    })
  })
}
