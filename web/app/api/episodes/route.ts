import { NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase";

export async function GET() {
  try {
    const supabase = getSupabaseAdmin();
    const { data, error } = await supabase
      .from("episodes")
      .select("id, title, published_at, youtube_video_id, duration_seconds")
      .eq("ingest_status", "done")
      .order("published_at", { ascending: false });

    if (error) {
      throw new Error(error.message);
    }

    return NextResponse.json({ episodes: data ?? [] });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to load episodes";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
