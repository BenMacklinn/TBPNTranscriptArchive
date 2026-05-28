import { NextRequest, NextResponse } from "next/server";
import { runSearch } from "@/lib/search";

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json()) as {
      query?: string;
      dateFrom?: string;
      dateTo?: string;
      episodeId?: string;
    };

    const query = body.query?.trim();
    if (!query) {
      return NextResponse.json({ error: "Query is required" }, { status: 400 });
    }

    const result = await runSearch({
      query,
      dateFrom: body.dateFrom,
      dateTo: body.dateTo,
      episodeId: body.episodeId,
    });

    return NextResponse.json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Search failed";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
