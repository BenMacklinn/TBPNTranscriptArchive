import { NextRequest, NextResponse } from "next/server";
import { searchGuestNames } from "@/lib/guest-search";

export async function GET(request: NextRequest) {
  try {
    const query = request.nextUrl.searchParams.get("q")?.trim() ?? "";
    const guests = await searchGuestNames(query, 12);
    return NextResponse.json({ guests });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Guest lookup failed";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
