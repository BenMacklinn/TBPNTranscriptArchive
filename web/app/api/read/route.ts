import { NextRequest, NextResponse } from "next/server";
import { parseReadApiParams, ReadApiNotFoundError, runReadApi } from "@/lib/read-api";

export async function GET(request: NextRequest) {
  try {
    const params = parseReadApiParams(request.nextUrl.searchParams);
    const result = await runReadApi(params);
    return NextResponse.json(result);
  } catch (error) {
    if (error instanceof ReadApiNotFoundError) {
      return NextResponse.json({ error: error.message }, { status: 404 });
    }

    const message = error instanceof Error ? error.message : "Read request failed";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
