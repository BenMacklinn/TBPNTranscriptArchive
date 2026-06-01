import { NextRequest, NextResponse } from "next/server";
import {
  parseSearchLimit,
  parseSearchQueryFromPath,
  ReadApiNotFoundError,
  runEpisodeSearch,
} from "@/lib/read-api";

type RouteContext = {
  params: Promise<{ id: string; query: string }>;
};

export async function GET(request: NextRequest, context: RouteContext) {
  try {
    const { id, query: querySegment } = await context.params;
    const query = parseSearchQueryFromPath(querySegment);

    if (!query) {
      return NextResponse.json({ error: "Query is required" }, { status: 400 });
    }

    const result = await runEpisodeSearch(
      id,
      query,
      parseSearchLimit(request.nextUrl.searchParams),
    );

    return NextResponse.json(result);
  } catch (error) {
    if (error instanceof ReadApiNotFoundError) {
      return NextResponse.json({ error: error.message }, { status: 404 });
    }

    const message = error instanceof Error ? error.message : "Episode search failed";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
