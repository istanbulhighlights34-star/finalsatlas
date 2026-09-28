import { database } from "../../../../lib/arena";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

const season = process.env.THESPORTSDB_FOOTBALL_SEASON || "2026-2027";
const apiKey = process.env.THESPORTSDB_API_KEY || "123";
const refreshMinutes = 15;
const competitions = [
  { id: "ucl", name: "Champions League", leagueId: "4480" },
  { id: "uel", name: "Europa League", leagueId: "4481" },
  { id: "uecl", name: "Conference League", leagueId: "5071" },
] as const;

type Event = {
  idEvent?: string | null;
  strEvent?: string | null;
  strHomeTeam?: string | null;
  strAwayTeam?: string | null;
  strStatus?: string | null;
  strProgress?: string | null;
  intRound?: string | number | null;
  intHomeScore?: string | number | null;
  intAwayScore?: string | number | null;
  strTimestamp?: string | null;
  dateEvent?: string | null;
  strTime?: string | null;
  strHomeTeamBadge?: string | null;
  strAwayTeamBadge?: string | null;
};
type Payload = { events?: Event[] | null; error?: string | null };

function parseScore(value: Event["intHomeScore"]): number | null {
  if (value === null || value === undefined || value === "") return null;
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isInteger(parsed) && parsed >= 0 ? parsed : null;
}
function kickoff(event: Event): string | null {
  if (event.strTimestamp && Number.isFinite(Date.parse(event.strTimestamp))) return new Date(event.strTimestamp).toISOString();
  if (event.dateEvent && event.strTime && /^\d{2}:\d{2}:\d{2}$/.test(event.strTime)) {
    const value = new Date(`${event.dateEvent}T${event.strTime}Z`);
    if (Number.isFinite(value.getTime())) return value.toISOString();
  }
  return null;
}

let schemaReady: Promise<void> | null = null;
async function ensureSchema(sql: ReturnType<typeof database>) {
  if (!schemaReady) schemaReady = (async () => {
    await sql`CREATE TABLE IF NOT EXISTS arena_provider_sync (
      source text PRIMARY KEY, last_synced_at timestamptz, lease_until timestamptz, last_error text
    )`;
    await sql`CREATE TABLE IF NOT EXISTS arena_european_fixtures (
      game_id text PRIMARY KEY,
      competition text NOT NULL CHECK (competition IN ('ucl','uel','uecl')),
      provider_event_id text NOT NULL,
      round_number integer,
      home_team text NOT NULL,
      away_team text NOT NULL,
      kickoff timestamptz NOT NULL,
      status text,
      home_score integer,
      away_score integer,
      home_badge text,
      away_badge text,
      updated_at timestamptz NOT NULL DEFAULT now()
    )`;
    await sql`CREATE INDEX IF NOT EXISTS arena_european_fixtures_kickoff ON arena_european_fixtures (kickoff)`;
  })();
  try { await schemaReady; }
  catch (error) { schemaReady = null; throw error; }
}

async function refreshCup(sql: ReturnType<typeof database>, cup: typeof competitions[number]) {
  const source = `thesportsdb-european-${cup.id}-${season}`;
  const lease = await sql`
    INSERT INTO arena_provider_sync (source, last_synced_at, lease_until)
    VALUES (${source}, NULL, now() + interval '2 minutes')
    ON CONFLICT (source) DO UPDATE
      SET lease_until = now() + interval '2 minutes'
      WHERE (arena_provider_sync.last_synced_at IS NULL
        OR arena_provider_sync.last_synced_at < now() - (${refreshMinutes} * interval '1 minute'))
        AND (arena_provider_sync.lease_until IS NULL OR arena_provider_sync.lease_until < now())
    RETURNING source
  `;
  if (!lease.length) return;

  try {
    const url = new URL(`https://www.thesportsdb.com/api/v1/json/${encodeURIComponent(apiKey)}/eventsseason.php`);
    url.searchParams.set("id", cup.leagueId);
    url.searchParams.set("s", season);
    const response = await fetch(url, { cache: "no-store", signal: AbortSignal.timeout(12_000) });
    if (!response.ok) throw new Error(`TheSportsDB HTTP ${response.status}`);
    const payload = await response.json() as Payload;
    if (!Array.isArray(payload.events) || payload.events.length === 0) throw new Error(payload.error || "No season events returned");

    for (const event of payload.events) {
      const id = event.idEvent?.trim();
      const home = event.strHomeTeam?.trim();
      const away = event.strAwayTeam?.trim();
      const start = kickoff(event);
      if (!id || !home || !away || !start) continue;
      const homeScore = parseScore(event.intHomeScore);
      const awayScore = parseScore(event.intAwayScore);
      const round = event.intRound === null || event.intRound === undefined ? null : Number(event.intRound);
      await sql`
        INSERT INTO arena_european_fixtures
          (game_id, competition, provider_event_id, round_number, home_team, away_team, kickoff, status, home_score, away_score, home_badge, away_badge, updated_at)
        VALUES
          (${cup.id || ""} || '-' || ${id}, ${cup.id}, ${id}, ${Number.isInteger(round) ? round : null},
           ${home}, ${away}, ${start}::timestamptz, ${event.strStatus || event.strProgress || null},
           ${homeScore}, ${awayScore}, ${event.strHomeTeamBadge || null}, ${event.strAwayTeamBadge || null}, now())
        ON CONFLICT (game_id) DO UPDATE SET
          round_number = EXCLUDED.round_number,
          home_team = EXCLUDED.home_team,
          away_team = EXCLUDED.away_team,
          kickoff = EXCLUDED.kickoff,
          status = EXCLUDED.status,
          home_score = EXCLUDED.home_score,
          away_score = EXCLUDED.away_score,
          home_badge = EXCLUDED.home_badge,
          away_badge = EXCLUDED.away_badge,
          updated_at = now()
      `;
    }
    await sql`UPDATE arena_provider_sync SET last_synced_at = now(), lease_until = NULL, last_error = NULL WHERE source = ${source}`;
  } catch (error) {
    const message = error instanceof Error ? error.message.slice(0, 500) : "Unknown provider error";
    await sql`UPDATE arena_provider_sync SET lease_until = NULL, last_error = ${message} WHERE source = ${source}`;
  }
}

export async function GET() {
  try {
    const sql = database();
    await ensureSchema(sql);
    await Promise.all(competitions.map(cup => refreshCup(sql, cup)));
    const [rows, syncRows] = await Promise.all([
      sql`SELECT game_id, competition, round_number, home_team, away_team, kickoff, status, home_score, away_score, home_badge, away_badge
        FROM arena_european_fixtures WHERE kickoff >= now() - interval '8 hours'
        ORDER BY kickoff ASC`,
      sql`SELECT source, last_synced_at, last_error FROM arena_provider_sync WHERE source LIKE ${`thesportsdb-european-%-${season}`}`,
    ]);
    const fixtures = rows.map(row => ({
      id: String(row.game_id),
      competition: String(row.competition),
      round: row.round_number === null ? null : Number(row.round_number),
      home: String(row.home_team),
      away: String(row.away_team),
      kickoff: new Date(String(row.kickoff)).toISOString(),
      status: row.status ? String(row.status) : null,
      result: row.home_score !== null && row.away_score !== null ? { home: Number(row.home_score), away: Number(row.away_score) } : null,
      homeLogo: row.home_badge ? String(row.home_badge) : null,
      awayLogo: row.away_badge ? String(row.away_badge) : null,
    }));
    return Response.json({
      available: true,
      source: "TheSportsDB",
      season,
      competitions,
      fixtures,
      sync: syncRows.map(row => ({ competition: String(row.source), lastSyncedAt: row.last_synced_at, error: row.last_error ? String(row.last_error) : null })),
    }, { headers: { "Cache-Control": "no-store" } });
  } catch {
    return Response.json({ available: false, source: "TheSportsDB", fixtures: [] }, { status: 503, headers: { "Cache-Control": "no-store" } });
  }
}
