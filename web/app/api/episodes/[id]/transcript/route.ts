import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase";

type RouteContext = {
  params: Promise<{ id: string }>;
};

export async function GET(_request: NextRequest, context: RouteContext) {
  try {
    const { id } = await context.params;
    const supabase = getSupabaseAdmin();

    const { data: episode, error: episodeError } = await supabase
      .from("episodes")
      .select("id, title, published_at, youtube_video_id, duration_seconds, source_url")
      .eq("id", id)
      .maybeSingle();

    if (episodeError) {
      throw new Error(episodeError.message);
    }

    if (!episode) {
      return NextResponse.json({ error: "Episode not found" }, { status: 404 });
    }

    const { data: chunks, error: chunksError } = await supabase
      .from("transcript_chunks")
      .select("start_seconds, end_seconds, start_time, end_time, text")
      .eq("episode_id", id)
      .order("start_seconds", { ascending: true });

    if (chunksError) {
      throw new Error(chunksError.message);
    }

    return NextResponse.json({ episode, chunks: chunks ?? [] });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Failed to load transcript";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
