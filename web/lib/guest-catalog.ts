import { getSupabaseAdmin } from "@/lib/supabase";

export type CatalogGuest = {
  id: string;
  person: string;
  company: string | null;
  job_position: string | null;
};

export type GuestAppearanceRecord = {
  person: string;
  videoId: string;
  episodeDate: string;
  startSeconds: number;
  endSeconds: number | null;
  chapterTitle: string;
  timestampUrl: string;
};

type GuestNameRow = {
  id: string;
  person: string;
  normalized_name: string;
  company: string | null;
  job_position: string | null;
};

type GuestAppearanceRow = {
  video_id: string;
  episode_date: string;
  start_seconds: number;
  end_seconds: number | null;
  chapter_title: string | null;
  timestamp_url: string;
  guest_names: GuestNameRow | GuestNameRow[] | null;
};

export function normalizeGuestName(value: string) {
  return value.trim().toLowerCase().replace(/\s+/g, " ");
}

function toCatalogGuest(row: GuestNameRow): CatalogGuest {
  return {
    id: row.id,
    person: row.person,
    company: row.company,
    job_position: row.job_position,
  };
}

function guestSearchHaystack(guest: CatalogGuest) {
  return normalizeGuestName(
    [guest.person, guest.company ?? "", guest.job_position ?? ""].join(" "),
  );
}

function scoreGuestMatch(guest: CatalogGuest, query: string) {
  const normalized = normalizeGuestName(query);
  const name = normalizeGuestName(guest.person);
  const haystack = guestSearchHaystack(guest);

  if (name === normalized) {
    return 100;
  }

  if (name.startsWith(normalized)) {
    return 90;
  }

  const tokens = normalized.split(" ").filter(Boolean);
  if (tokens.length > 1 && tokens.every((token) => name.includes(token))) {
    return 85;
  }

  if (name.includes(normalized)) {
    return 70;
  }

  if (haystack.includes(normalized)) {
    return 55;
  }

  if (tokens.length > 1 && tokens.every((token) => haystack.includes(token))) {
    return 50;
  }

  return 0;
}

async function fetchGuestsWithAppearances(): Promise<CatalogGuest[]> {
  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase
    .from("guest_names")
    .select("id, person, normalized_name, company, job_position, guest_appearances(id)")
    .order("person", { ascending: true });

  if (error) {
    throw new Error(error.message);
  }

  return (data ?? [])
    .filter((row) => Array.isArray(row.guest_appearances) && row.guest_appearances.length > 0)
    .map((row) =>
      toCatalogGuest({
        id: row.id as string,
        person: row.person as string,
        normalized_name: row.normalized_name as string,
        company: (row.company as string | null) ?? null,
        job_position: (row.job_position as string | null) ?? null,
      }),
    );
}

export async function searchGuestNames(query: string, limit = 10): Promise<CatalogGuest[]> {
  const trimmed = query.trim();
  const supabase = getSupabaseAdmin();

  if (!trimmed) {
    const guests = await fetchGuestsWithAppearances();
    return guests.slice(0, limit);
  }

  const normalized = normalizeGuestName(trimmed);
  const escaped = trimmed.replace(/[%_,]/g, "\\$&");
  const { data, error } = await supabase
    .from("guest_names")
    .select("id, person, normalized_name, company, job_position, guest_appearances(id)")
    .or(
      [
        `normalized_name.ilike.${normalized}%`,
        `person.ilike.%${escaped}%`,
        `company.ilike.%${escaped}%`,
        `job_position.ilike.%${escaped}%`,
      ].join(","),
    )
    .limit(Math.max(limit * 4, 24));

  if (error) {
    throw new Error(error.message);
  }

  return (data ?? [])
    .filter((row) => Array.isArray(row.guest_appearances) && row.guest_appearances.length > 0)
    .map((row) =>
      toCatalogGuest({
        id: row.id as string,
        person: row.person as string,
        normalized_name: row.normalized_name as string,
        company: (row.company as string | null) ?? null,
        job_position: (row.job_position as string | null) ?? null,
      }),
    )
    .map((guest) => ({ guest, score: scoreGuestMatch(guest, trimmed) }))
    .filter((entry) => entry.score > 0)
    .sort((left, right) => {
      if (right.score !== left.score) {
        return right.score - left.score;
      }
      return left.guest.person.localeCompare(right.guest.person);
    })
    .slice(0, limit)
    .map((entry) => entry.guest);
}

export async function resolveGuest(guestName: string): Promise<CatalogGuest> {
  const candidates = await searchGuestNames(guestName, 8);
  const resolvedMatches = await Promise.all(
    candidates.map(async (guest) => ({
      guest,
      hasAppearances: (await getGuestAppearances(guest.person, 1)).length > 0,
    })),
  );

  const withAppearances = resolvedMatches
    .filter((entry) => entry.hasAppearances)
    .map((entry) => entry.guest);

  if (!withAppearances.length) {
    throw new Error(`No appearances found for guest "${guestName.trim()}".`);
  }

  const normalized = normalizeGuestName(guestName);
  return (
    withAppearances.find((match) => normalizeGuestName(match.person) === normalized) ??
    withAppearances[0]
  );
}

export async function getGuestAppearances(
  person: string,
  maxRows?: number,
): Promise<GuestAppearanceRecord[]> {
  const supabase = getSupabaseAdmin();
  const normalized = normalizeGuestName(person);

  const { data: guest, error: guestError } = await supabase
    .from("guest_names")
    .select("id, person")
    .eq("normalized_name", normalized)
    .maybeSingle();

  if (guestError) {
    throw new Error(guestError.message);
  }

  if (!guest) {
    const { data: fallbackGuest, error: fallbackError } = await supabase
      .from("guest_names")
      .select("id, person")
      .ilike("person", `%${person.trim()}%`)
      .limit(1)
      .maybeSingle();

    if (fallbackError) {
      throw new Error(fallbackError.message);
    }

    if (!fallbackGuest) {
      return [];
    }

    return fetchAppearancesForGuestId(fallbackGuest.id as string, fallbackGuest.person as string, maxRows);
  }

  return fetchAppearancesForGuestId(guest.id as string, guest.person as string, maxRows);
}

async function fetchAppearancesForGuestId(
  guestId: string,
  person: string,
  maxRows?: number,
): Promise<GuestAppearanceRecord[]> {
  const supabase = getSupabaseAdmin();

  let query = supabase
    .from("guest_appearances")
    .select(
      "video_id, episode_date, start_seconds, end_seconds, chapter_title, timestamp_url, guest_names!inner(person)",
    )
    .eq("guest_name_id", guestId)
    .order("episode_date", { ascending: false })
    .order("start_seconds", { ascending: true });

  if (maxRows != null) {
    query = query.limit(maxRows);
  }

  const { data, error } = await query;

  if (error) {
    throw new Error(error.message);
  }

  return (data as GuestAppearanceRow[]).map((row) => {
    const guestNames = row.guest_names;
    const guestPerson = Array.isArray(guestNames)
      ? guestNames[0]?.person
      : guestNames?.person;

    return {
      person: guestPerson ?? person,
      videoId: row.video_id,
      episodeDate: row.episode_date,
      startSeconds: row.start_seconds,
      endSeconds: row.end_seconds,
      chapterTitle: row.chapter_title ?? "",
      timestampUrl: row.timestamp_url,
    };
  });
}
