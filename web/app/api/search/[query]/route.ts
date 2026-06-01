import { NextRequest, NextResponse } from "next/server";
import {
  parseSearchFilters,
  parseSearchLimit,
  parseSearchQueryFromPath,
  runArchiveSearch,
} from "@/lib/read-api";

type RouteContext = {
  params: Promise<{ query: string }>;
};

export async function GET(request: NextRequest, context: RouteContext) {
  try {
    const { query: querySegment } = await context.params;
    const query = parseSearchQueryFromPath(querySegment);

    if (!query) {
      return NextResponse.json({ error: "Query is required" }, { status: 400 });
    }

    const result = await runArchiveSearch(
      query,
      parseSearchFilters(request.nextUrl.searchParams),
      parseSearchLimit(request.nextUrl.searchParams),
    );

    return NextResponse.json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Search failed";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
