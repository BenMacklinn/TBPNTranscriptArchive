import { NextRequest, NextResponse } from "next/server";
import { loadChunkWords, ReadApiNotFoundError } from "@/lib/read-api";

type RouteContext = {
  params: Promise<{ chunk: string }>;
};

export async function GET(_request: NextRequest, context: RouteContext) {
  try {
    const { chunk } = await context.params;
    const words = await loadChunkWords(chunk);
    return NextResponse.json(words);
  } catch (error) {
    if (error instanceof ReadApiNotFoundError) {
      return NextResponse.json({ error: error.message }, { status: 404 });
    }

    const message =
      error instanceof Error ? error.message : "Failed to load word timestamps";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
