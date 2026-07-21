import { NextResponse } from "next/server";
import { denyUnauthorizedRecipeMedia, serveRecipeStepMedia } from "@/lib/recipe-media";

export const runtime = "nodejs";

const VALID_UUID_PATTERN = /^[a-f0-9-]{36}$/i;

export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string; filename: string }> }
) {
  const { id, filename } = await params;

  // Validate id (should be a UUID)
  if (!id || !VALID_UUID_PATTERN.test(id)) {
    return NextResponse.json({ error: "Invalid recipe ID" }, { status: 400 });
  }

  // MEDIA-AUTHZ-01: proxy.ts proves a session exists; this proves it may read THIS recipe.
  const denied = await denyUnauthorizedRecipeMedia(req, id);

  if (denied) {
    return denied;
  }

  return serveRecipeStepMedia(id, filename, "public, max-age=31536000, immutable");
}
