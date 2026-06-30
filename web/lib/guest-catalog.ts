import fs from "node:fs";
import path from "node:path";

const YOUTUBE_CSV = "tbpn-youtube-guest-timestamps.csv";
const CATALOG_JSON = "tbpn-guests-all.json";
const DEFAULT_GUEST_REPO = "BenMacklinn/tbpn-guests-research";
const DEFAULT_GUEST_BRANCH = "main";
const DEFAULT_GUEST_CATALOG_API = "https://tbpnguests.vercel.app/api/catalog";

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

type CatalogEntry = {
  person: string;
  company: string | null;
  job_position: string | null;
};

type CacheState = {
  sourceKey: string;
  catalog: Map<string, CatalogEntry>;
  appearances: GuestAppearanceRecord[];
};

let cache: CacheState | null = null;
let loadPromise: Promise<CacheState> | null = null;

export function normalizeGuestName(value: string) {
  return value.trim().toLowerCase().replace(/\s+/g, " ");
}

function getGuestDataDir() {
  return process.env.GUEST_DATA_DIR?.trim() || "";
}

function getGithubRepository() {
  return process.env.GUEST_GITHUB_REPOSITORY?.trim() || DEFAULT_GUEST_REPO;
}

function getGithubBranch() {
  return process.env.GUEST_GITHUB_BRANCH?.trim() || DEFAULT_GUEST_BRANCH;
}

function getGithubToken() {
  return (
    process.env.GITHUB_SYNC_TOKEN?.trim() ||
    process.env.GITHUB_TOKEN?.trim() ||
    process.env.GH_TOKEN?.trim() ||
    ""
  );
}

function getGuestCatalogApiBase() {
  return process.env.GUEST_CATALOG_API_URL?.trim() || DEFAULT_GUEST_CATALOG_API;
}

async function readLocalGuestFile(filename: string) {
  const dataDir = getGuestDataDir();
  if (!dataDir) {
    return null;
  }

  const filePath = path.join(dataDir, filename);
  if (!fs.existsSync(filePath)) {
    return null;
  }

  return fs.readFileSync(filePath, "utf8");
}

async function fetchPublicGithubFile(filename: string) {
  const repository = getGithubRepository();
  const branch = getGithubBranch();
  const url = `https://raw.githubusercontent.com/${repository}/${encodeURIComponent(branch)}/${filename}`;
  const response = await fetch(url, {
    headers: { "User-Agent": "tbpn-transcript-archive" },
    cache: "no-store",
  });

  if (!response.ok) {
    throw new Error(`Could not fetch ${filename}: ${response.status}`);
  }

  return response.text();
}

async function fetchPrivateGithubFile(filename: string, token: string) {
  const repository = getGithubRepository();
  const branch = getGithubBranch();
  const encodedPath = filename.split("/").map(encodeURIComponent).join("/");
  const url = `https://api.github.com/repos/${repository}/contents/${encodedPath}?ref=${encodeURIComponent(branch)}`;
  const response = await fetch(url, {
    headers: {
      Accept: "application/vnd.github.raw",
      Authorization: `Bearer ${token}`,
      "User-Agent": "tbpn-transcript-archive",
      "X-GitHub-Api-Version": "2022-11-28",
    },
    cache: "no-store",
  });
  const body = await response.text();

  if (!response.ok) {
    let message = `Could not fetch ${filename}: ${response.status}`;
    try {
      const payload = JSON.parse(body) as { message?: string };
      if (payload.message) {
        message = payload.message;
      }
    } catch {
      // Ignore JSON parse errors for raw responses.
    }
    throw new Error(message);
  }

  return body;
}

async function fetchGuestCatalogApiFile(filename: string) {
  const url = `${getGuestCatalogApiBase().replace(/\/$/, "")}?file=${encodeURIComponent(filename)}`;
  const response = await fetch(url, { cache: "no-store" });
  if (!response.ok) {
    throw new Error(`Could not fetch ${filename} from guest catalog API: ${response.status}`);
  }
  return response.text();
}

async function loadGuestFile(filename: string) {
  const local = await readLocalGuestFile(filename);
  if (local != null) {
    return local;
  }

  const token = getGithubToken();
  const attempts: Array<() => Promise<string>> = [];

  if (token) {
    attempts.push(() => fetchPrivateGithubFile(filename, token));
  }

  attempts.push(() => fetchPublicGithubFile(filename));

  if (filename === "tbpn-guests-all.csv") {
    attempts.push(() => fetchGuestCatalogApiFile(filename));
  }

  let lastError: Error | null = null;
  for (const attempt of attempts) {
    try {
      return await attempt();
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));
    }
  }

  throw lastError ?? new Error(`Could not load ${filename}`);
}

function parseCsvRow(content: string, startIndex: number) {
  const fields: string[] = [];
  let field = "";
  let index = startIndex;

  while (index < content.length) {
    const char = content[index];

    if (char === '"') {
      index += 1;
      while (index < content.length) {
        if (content[index] === '"') {
          if (content[index + 1] === '"') {
            field += '"';
            index += 2;
            continue;
          }
          index += 1;
          break;
        }
        field += content[index];
        index += 1;
      }
      continue;
    }

    if (char === ",") {
      fields.push(field);
      field = "";
      index += 1;
      continue;
    }

    if (char === "\n") {
      fields.push(field);
      return { fields, nextIndex: index + 1 };
    }

    if (char === "\r") {
      fields.push(field);
      const nextIndex = content[index + 1] === "\n" ? index + 2 : index + 1;
      return { fields, nextIndex };
    }

    field += char;
    index += 1;
  }

  fields.push(field);
  return { fields, nextIndex: content.length };
}

function parseCsv(content: string): Record<string, string>[] {
  const rows: Record<string, string>[] = [];
  let index = 0;

  const headerRow = parseCsvRow(content, index);
  const headers = headerRow.fields;
  index = headerRow.nextIndex;

  while (index < content.length) {
    const rowResult = parseCsvRow(content, index);
    index = rowResult.nextIndex;

    if (rowResult.fields.every((value) => !value.trim())) {
      continue;
    }

    const row: Record<string, string> = {};
    headers.forEach((header, columnIndex) => {
      row[header] = rowResult.fields[columnIndex] ?? "";
    });
    rows.push(row);
  }

  return rows;
}

function splitGuestNames(raw: string) {
  return raw
    .split(/\s*;\s*|\s+and\s+/i)
    .map((part) => part.trim())
    .filter(Boolean);
}

function resolvePersonName(rawName: string, catalog: Map<string, CatalogEntry>) {
  const normalized = normalizeGuestName(rawName);
  const exact = catalog.get(normalized);
  if (exact) {
    return exact.person;
  }

  for (const [key, value] of catalog.entries()) {
    if (normalized.includes(key) || key.includes(normalized)) {
      return value.person;
    }
  }

  return rawName.trim();
}

function loadCatalogEntriesFromJson(payload: Array<{
  person?: string;
  company?: string | null;
  job_position?: string | null;
}>) {
  const catalog = new Map<string, CatalogEntry>();
  for (const row of payload) {
    const person = row.person?.trim();
    if (!person) {
      continue;
    }
    catalog.set(normalizeGuestName(person), {
      person,
      company: row.company ?? null,
      job_position: row.job_position ?? null,
    });
  }
  return catalog;
}

function buildAppearances(catalog: Map<string, CatalogEntry>, rawRows: Record<string, string>[]) {
  const expanded: Array<{
    person: string;
    videoId: string;
    episodeDate: string;
    startSeconds: number;
    chapterTitle: string;
    timestampUrl: string;
  }> = [];

  for (const row of rawRows) {
    const guestRaw = (row.guest_name_guess ?? "").trim();
    const videoId = (row.video_id ?? "").trim();
    const episodeDate = (row.episode_date ?? "").trim();
    const timestampUrl = (row.timestamp_url ?? "").trim();
    const chapterTitle = (row.chapter_title ?? "").trim();
    const startSeconds = Number.parseInt((row.start_seconds ?? "").trim(), 10);

    if (!guestRaw || !videoId || !episodeDate || !timestampUrl || Number.isNaN(startSeconds)) {
      continue;
    }

    for (const guestName of splitGuestNames(guestRaw)) {
      expanded.push({
        person: resolvePersonName(guestName, catalog),
        videoId,
        episodeDate,
        startSeconds,
        chapterTitle,
        timestampUrl,
      });
    }
  }

  const byVideo = new Map<string, typeof expanded>();
  for (const row of expanded) {
    const bucket = byVideo.get(row.videoId) ?? [];
    bucket.push(row);
    byVideo.set(row.videoId, bucket);
  }

  const appearances: GuestAppearanceRecord[] = [];
  for (const rows of byVideo.values()) {
    rows.sort((left, right) => left.startSeconds - right.startSeconds);
    for (let index = 0; index < rows.length; index += 1) {
      const row = rows[index];
      const nextStart = index + 1 < rows.length ? rows[index + 1].startSeconds : null;
      appearances.push({
        person: row.person,
        videoId: row.videoId,
        episodeDate: row.episodeDate,
        startSeconds: row.startSeconds,
        endSeconds: nextStart != null ? nextStart - 1 : null,
        chapterTitle: row.chapterTitle,
        timestampUrl: row.timestampUrl,
      });
    }
  }

  return appearances;
}

async function loadGuestCatalogState(): Promise<CacheState> {
  const sourceKey = [
    getGuestDataDir(),
    getGithubRepository(),
    getGithubBranch(),
    getGuestCatalogApiBase(),
    Boolean(getGithubToken()),
  ].join("|");

  if (cache && cache.sourceKey === sourceKey) {
    return cache;
  }

  const [catalogText, youtubeText] = await Promise.all([
    loadGuestFile(CATALOG_JSON),
    loadGuestFile(YOUTUBE_CSV),
  ]);

  const catalog = loadCatalogEntriesFromJson(JSON.parse(catalogText) as Array<{
    person?: string;
    company?: string | null;
    job_position?: string | null;
  }>);
  const appearances = buildAppearances(catalog, parseCsv(youtubeText));

  cache = {
    sourceKey,
    catalog,
    appearances,
  };
  return cache;
}

async function getGuestCatalogState() {
  if (!loadPromise) {
    loadPromise = loadGuestCatalogState().finally(() => {
      loadPromise = null;
    });
  }
  return loadPromise;
}

function toCatalogGuest(entry: CatalogEntry): CatalogGuest {
  return {
    id: normalizeGuestName(entry.person),
    person: entry.person,
    company: entry.company,
    job_position: entry.job_position,
  };
}

function allGuestsWithAppearances(state: CacheState): CatalogGuest[] {
  const people = new Set(state.appearances.map((row) => row.person));
  const guests: CatalogGuest[] = [];

  for (const person of people) {
    const meta = state.catalog.get(normalizeGuestName(person));
    guests.push(
      meta
        ? toCatalogGuest(meta)
        : {
            id: normalizeGuestName(person),
            person,
            company: null,
            job_position: null,
          },
    );
  }

  return guests.sort((left, right) => left.person.localeCompare(right.person));
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

export async function searchGuestNames(query: string, limit = 10): Promise<CatalogGuest[]> {
  const state = await getGuestCatalogState();
  const guests = allGuestsWithAppearances(state);
  const trimmed = query.trim();

  if (!trimmed) {
    return guests.slice(0, limit);
  }

  return guests
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

function getGuestAppearancesSync(person: string, maxRows?: number): GuestAppearanceRecord[] {
  if (!cache) {
    return [];
  }

  const normalized = normalizeGuestName(person);
  const rows = cache.appearances
    .filter((row) => normalizeGuestName(row.person) === normalized)
    .sort((left, right) => right.episodeDate.localeCompare(left.episodeDate));

  if (maxRows != null) {
    return rows.slice(0, maxRows);
  }

  return rows;
}

export async function resolveGuest(guestName: string): Promise<CatalogGuest> {
  await getGuestCatalogState();
  const matches = (await searchGuestNames(guestName, 8)).filter(
    (guest) => getGuestAppearancesSync(guest.person, 1).length > 0,
  );

  if (!matches.length) {
    throw new Error(`No appearances found for guest "${guestName.trim()}".`);
  }

  const normalized = normalizeGuestName(guestName);
  return (
    matches.find((match) => normalizeGuestName(match.person) === normalized) ?? matches[0]
  );
}

export async function getGuestAppearances(
  person: string,
  maxRows?: number,
): Promise<GuestAppearanceRecord[]> {
  await getGuestCatalogState();
  return getGuestAppearancesSync(person, maxRows);
}

function getEpisodeShowDatesByVideoIdsSync(videoIds: string[]): Map<string, string> {
  if (!cache) {
    return new Map();
  }

  const wanted = new Set(videoIds);
  const dates = new Map<string, string>();

  for (const appearance of cache.appearances) {
    if (!wanted.has(appearance.videoId) || dates.has(appearance.videoId)) {
      continue;
    }
    dates.set(appearance.videoId, appearance.episodeDate);
  }

  return dates;
}

export async function getEpisodeShowDatesByVideoIds(
  videoIds: string[],
): Promise<Map<string, string>> {
  await getGuestCatalogState();
  return getEpisodeShowDatesByVideoIdsSync(videoIds);
}
