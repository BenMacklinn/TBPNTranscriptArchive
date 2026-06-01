import { NextResponse } from "next/server";
import { parseGuestFromPath } from "@/lib/read-api";
import { searchGuestNames } from "@/lib/guest-search";

type RouteContext = {
  params: Promise<{ guest: string }>;
};

export async function GET(_request: Request, context: RouteContext) {
  try {
    const { guest } = await context.params;
    const needle = parseGuestFromPath(guest);
    const guests = await searchGuestNames(needle, 12);
    return NextResponse.json({ guests });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Guest lookup failed";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
