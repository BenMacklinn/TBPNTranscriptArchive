import { NextRequest, NextResponse } from "next/server";
import {
  parseSearchFilters,
  parseSearchLimit,
  parseSearchQueryFromPath,
  ReadApiNotFoundError,
  runGuestSearch,
} from "@/lib/read-api";

type RouteContext = {
  params: Promise<{ guest: string; query: string }>;
};

export async function GET(request: NextRequest, context: RouteContext) {
  try {
    const { guest, query: topicSegment } = await context.params;
    const topic = parseSearchQueryFromPath(topicSegment);

    if (!topic) {
      return NextResponse.json({ error: "Topic is required" }, { status: 400 });
    }

    const searchParams = request.nextUrl.searchParams;
    const result = await runGuestSearch(guest, topic, parseSearchFilters(searchParams));

    return NextResponse.json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Guest search failed";
    const status = message.includes("No appearances found") ? 404 : 500;
    return NextResponse.json({ error: message }, { status });
  }
}
