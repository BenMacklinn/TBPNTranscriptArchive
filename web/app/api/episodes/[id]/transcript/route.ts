import { NextRequest, NextResponse } from "next/server";
import { loadEpisodeTranscript, ReadApiNotFoundError } from "@/lib/read-api";

type RouteContext = {
  params: Promise<{ id: string }>;
};

export async function GET(_request: NextRequest, context: RouteContext) {
  try {
    const { id } = await context.params;
    const transcript = await loadEpisodeTranscript(id);
    return NextResponse.json({
      episode: transcript.episode,
      chunks: transcript.chunks.map(({ id: _id, speaker: _speaker, clip_url: _clipUrl, ...chunk }) => chunk),
    });
  } catch (error) {
    if (error instanceof ReadApiNotFoundError) {
      return NextResponse.json({ error: error.message }, { status: 404 });
    }

    const message =
      error instanceof Error ? error.message : "Failed to load transcript";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
