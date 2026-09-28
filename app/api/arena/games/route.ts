import { NextResponse } from "next/server";
import { database, fixtures } from "../../../../lib/arena";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

const LEAGUE_ID = process.env.THESPORTSDB_EUROLEAGUE_ID || "4546";
const SEASON = process.env.THESPORTSDB_EUROLEAGUE_SEASON || "2026-2027";
const API_KEY = process.env.THESPORTSDB_API_KEY || "123";
const SYNC_INTERVAL_MINUTES = 15;
const LIVE_STATUSES = /live|in progress|quarter|\bq[1-4]\b|\b[1-4]h\b|half time|\bht\b|overtime|\bot\b/i;
const FINAL_STATUSES = /match finished|finished|\bfinal\b|\bft\b|after extra time|\baet\b/i;

type ProviderEvent = {
  idEvent?: string | null;
  strHomeTeam?: string | null;
  strAwayTeam?: string | null;
  strStatus?: string | null;
  strProgress?: string | null;
  intHomeScore?: string | number | null;
  intAwayScore?: string | number | null;
};
type ProviderPayload = { events?: ProviderEvent[] | null; error?: string | null };

function normalized(value: string) {
  return value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase()
    .replace(/\b(fc|bc|basketball|basket|club|team|the)\b/g, " ")
    .replace(/[^a-z0-9]+/g, " ").trim().replace(/\s+/g, " ");
}

const TEAM_ALIASES: Record<string, string[]> = {
  "olimpia milano": ["ea7 emp as milan", "ea7 emporio armani milan", "olimpia milano"],
  "barcelona": ["barcelona", "fc barcelona"],
  "asvel": ["ldlc asvel", "asvel villeurbanne", "asvel"],
  "fenerbahce": ["fenerbahce beko", "fenerbahce"],
  "partizan": ["partizan mozzart bet", "partizan"],
  "anadolu efes": ["anadolu efes istanbul", "anadolu efes"],
  "hapoel tel aviv": ["hapoel ibi tel aviv", "hapoel tel aviv"],
  "bayern munich": ["fc bayern munich", "fc bayern munchen", "bayern munich", "bayern munchen"],
  "maccabi tel aviv": ["maccabi rapyd tel aviv", "maccabi playtika tel aviv", "maccabi tel aviv"],
};

function teamMatches(fixtureName: string, providerName: string) {
  const expected = normalized(fixtureName);
  const actual = normalized(providerName);
  if (!expected || !actual) return false;
  const aliases = TEAM_ALIASES[expected] || [expected];
  const actualTokens = new Set(actual.split(" "));
  return aliases.some((alias) => {
    const targetTokens = normalized(alias).split(" ").filter(Boolean);
    // Sponsor and city words can be inserted into provider names (e.g. “Maccabi Rapyd Tel Aviv”).
    // Match the complete team identity tokens even when their order or spacing differs.
    return targetTokens.every((token) => actualTokens.has(token));
  });
}

function score(value: ProviderEvent["intHomeScore"]): number | null {
  if (value === null || value === undefined || value === "") return null;
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isInteger(parsed) && parsed >= 0 ? parsed : null;
}

let providerSchemaReady: Promise<void> | null = null;

async function ensureProviderTables(sql: ReturnType<typeof database>) {
  if (!providerSchemaReady) providerSchemaReady = (async () => {
  await sql`CREATE TABLE IF NOT EXISTS arena_provider_sync (
    source text PRIMARY KEY,
    last_synced_at timestamptz,
    lease_until timestamptz,
    last_error text
  )`;
  await sql`CREATE TABLE IF NOT EXISTS arena_provider_games (
    game_id text PRIMARY KEY,
    provider_event_id text,
    status text,
    home_score integer CHECK (home_score IS NULL OR home_score >= 0),
    away_score integer CHECK (away_score IS NULL OR away_score >= 0),
    updated_at timestamptz NOT NULL DEFAULT now()
  )`;
  await sql`CREATE INDEX IF NOT EXISTS arena_provider_games_updated
    ON arena_provider_games (updated_at DESC)`;
  })();
  try {
    await providerSchemaReady;
  } catch (error) {
    providerSchemaReady = null;
    throw error;
  }
}

async function trySync(sql: ReturnType<typeof database>) {
  const lease = await sql`
    INSERT INTO arena_provider_sync (source, last_synced_at, lease_until)
    VALUES ('thesportsdb-euroleague', NULL, now() + interval '2 minutes')
    ON CONFLICT (source) DO UPDATE
      SET lease_until = now() + interval '2 minutes'
      WHERE (arena_provider_sync.last_synced_at IS NULL
        OR arena_provider_sync.last_synced_at < now() - (${SYNC_INTERVAL_MINUTES} * interval '1 minute'))
        AND (arena_provider_sync.lease_until IS NULL OR arena_provider_sync.lease_until < now())
    RETURNING source
  `;
  if (!lease.length) return;

  try {
    const url = new URL(`https://www.thesportsdb.com/api/v1/json/${encodeURIComponent(API_KEY)}/eventsseason.php`);
    url.searchParams.set("id", LEAGUE_ID);
    url.searchParams.set("s", SEASON);
    const response = await fetch(url, { signal: AbortSignal.timeout(12_000), cache: "no-store" });
    if (!response.ok) throw new Error(`TheSportsDB HTTP ${response.status}`);
    const payload = await response.json() as ProviderPayload;
    if (!Array.isArray(payload.events) || payload.events.length === 0) {
      throw new Error(payload.error || "TheSportsDB returned no season events");
    }

    let matchedEvents = 0;
    for (const event of payload.events) {
      const home = event.strHomeTeam?.trim();
      const away = event.strAwayTeam?.trim();
      if (!home || !away) continue;
      const direct = fixtures.find((item) => teamMatches(item[1], home) && teamMatches(item[2], away));
      const reversed = direct ? null : fixtures.find((item) => teamMatches(item[1], away) && teamMatches(item[2], home));
      const fixture = direct || reversed;
      if (!fixture) continue;
      matchedEvents += 1;

      const status = (event.strStatus || event.strProgress || "").trim();
      const eventHomeScore = score(event.intHomeScore);
      const eventAwayScore = score(event.intAwayScore);
      const homeScore = reversed ? eventAwayScore : eventHomeScore;
      const awayScore = reversed ? eventHomeScore : eventAwayScore;
      await sql`
        INSERT INTO arena_provider_games (game_id, provider_event_id, status, home_score, away_score, updated_at)
        VALUES (${fixture[0]}, ${event.idEvent || null}, ${status || null}, ${homeScore}, ${awayScore}, now())
        ON CONFLICT (game_id) DO UPDATE SET
          provider_event_id = EXCLUDED.provider_event_id,
          status = EXCLUDED.status,
          home_score = EXCLUDED.home_score,
          away_score = EXCLUDED.away_score,
          updated_at = now()
      `;

      const scoreIsSettled = homeScore !== null && awayScore !== null && homeScore !== awayScore;
      const clearlyNotLive = !LIVE_STATUSES.test(status);
      const pastExpectedFinish = Date.now() >= Date.parse(fixture[3]) + 3 * 60 * 60 * 1000;
      const isFinal = FINAL_STATUSES.test(status) || (scoreIsSettled && clearlyNotLive && pastExpectedFinish);
      if (isFinal && scoreIsSettled) {
        await sql`
          INSERT INTO arena_results (game_id, home_score, away_score)
          VALUES (${fixture[0]}, ${homeScore}, ${awayScore})
          ON CONFLICT (game_id) DO UPDATE
            SET home_score = EXCLUDED.home_score, away_score = EXCLUDED.away_score, updated_at = now()
        `;
      }
    }
    if (!matchedEvents) throw new Error("TheSportsDB events did not match the configured EuroLeague fixtures");

    await sql`
      UPDATE arena_provider_sync
      SET last_synced_at = now(), lease_until = NULL, last_error = NULL
      WHERE source = 'thesportsdb-euroleague'
    `;
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown provider error";
    console.error("TheSportsDB EuroLeague sync failed", { message: message.slice(0, 300) });
    await sql`
      UPDATE arena_provider_sync
      SET last_synced_at = now(), lease_until = NULL, last_error = ${message.slice(0, 300)}
      WHERE source = 'thesportsdb-euroleague'
    `;
  }
}

export async function GET() {
  if (!process.env.DATABASE_URL) {
    return NextResponse.json({ available: false, error: "Arena database is not configured." }, { status: 503 });
  }

  try {
    const sql = database();
    await ensureProviderTables(sql);
    await trySync(sql);
    const [providerRows, resultRows, syncRows] = await Promise.all([
      sql`SELECT game_id, status, home_score, away_score, updated_at FROM arena_provider_games`,
      sql`SELECT game_id, home_score, away_score FROM arena_results`,
      sql`SELECT last_synced_at, last_error FROM arena_provider_sync WHERE source = 'thesportsdb-euroleague' LIMIT 1`,
    ]);
    const liveById = new Map(providerRows.map((row) => [String(row.game_id), row]));
    const finalsById = new Map(resultRows.map((row) => [String(row.game_id), row]));
    const games = fixtures.map(([id, home, away, tipoff]) => {
      const live = liveById.get(id);
      const final = finalsById.get(id);
      const isFinal = !!final;
      const liveScore = live && !isFinal && LIVE_STATUSES.test(String(live.status || ""))
        && live.home_score !== null && live.away_score !== null
        && Number.isInteger(Number(live.home_score)) && Number.isInteger(Number(live.away_score))
        ? { home: Number(live.home_score), away: Number(live.away_score) }
        : null;
      return {
        id, home, away, tipoff,
        status: isFinal ? "Final" : live?.status || null,
        result: isFinal ? { home: Number(final.home_score), away: Number(final.away_score) } : null,
        liveScore,
      };
    });
    return NextResponse.json({
      available: true,
      games,
      provider: "TheSportsDB",
      providerGameCount: providerRows.length,
      updatedAt: syncRows[0]?.last_synced_at || null,
      stale: !!syncRows[0]?.last_error,
      leagueId: LEAGUE_ID,
      season: SEASON,
      unmatchedFixtures: fixtures
        .filter(([id]) => !liveById.has(id))
        .map(([id, home, away]) => ({ id, matchup: `${home} vs ${away}` })),
    }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    console.error("Arena score store unavailable", error);
    return NextResponse.json({
      available: false,
      error: "Arena score store is unavailable. Apply the TheSportsDB database migration.",
      diagnostic: "SCORE_STORE_UNAVAILABLE",
    }, { status: 503 });
  }
}
