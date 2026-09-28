import { NextResponse } from "next/server";
import { database } from "../../../../lib/arena";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const API_KEY = process.env.API_SPORTS_KEY || process.env.APISPORTS_KEY || process.env.API_FOOTBALL_KEY || "";
const LEAGUES = [39, 78, 140, 135, 61, 203];
const TRACKED = ["Manchester City","Bayern Munich","Paris Saint-Germain","Real Madrid","Barcelona","Inter","Newcastle","Başakşehir","Hoffenheim","Real Sociedad","Real Betis","Atalanta","Çorum FK","Gaziantep","Angers","Crystal Palace","Lecce","St. Pauli"];
const FINAL = new Set(["FT","AET","PEN"]);
const LIVE = new Set(["1H","HT","2H","ET","BT","P","LIVE"]);

const normalized = (value: string) => value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
function trackedName(provider: string) {
  const actual = normalized(provider);
  return TRACKED.find(team => {
    const expected = normalized(team);
    return actual === expected || actual.includes(expected) || expected.includes(actual);
  });
}

async function ensureTables(sql: ReturnType<typeof database>) {
  await sql`CREATE TABLE IF NOT EXISTS arena_bingo_sync (
    source text PRIMARY KEY,
    last_synced_at timestamptz,
    lease_until timestamptz,
    last_error text
  )`;
  await sql`CREATE TABLE IF NOT EXISTS arena_bingo_team_results (
    week_key text NOT NULL,
    team text NOT NULL,
    opponent text,
    kickoff timestamptz,
    status text,
    won boolean,
    home_score integer,
    away_score integer,
    updated_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (week_key, team)
  )`;
  await sql`CREATE TABLE IF NOT EXISTS arena_bingo_fixtures (
    week_key text NOT NULL,
    fixture_id text NOT NULL,
    league text NOT NULL,
    home text NOT NULL,
    away text NOT NULL,
    home_logo text,
    away_logo text,
    kickoff timestamptz NOT NULL,
    status text,
    home_score integer,
    away_score integer,
    updated_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (week_key, fixture_id)
  )`;
}

function weekWindow() {
  const now = new Date();
  const day = now.getUTCDay();
  // League Bingo opens on Tuesday, covers Friday through the following Monday,
  // then archives when the next Tuesday card opens.
  const tuesday = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - ((day + 5) % 7)));
  const friday = new Date(tuesday); friday.setUTCDate(tuesday.getUTCDate() + 3);
  const monday = new Date(tuesday); monday.setUTCDate(tuesday.getUTCDate() + 6);
  const iso = (date: Date) => date.toISOString().slice(0, 10);
  return { key: iso(tuesday), from: iso(friday), to: iso(monday) };
}

async function sync(sql: ReturnType<typeof database>, week: ReturnType<typeof weekWindow>) {
  if (!API_KEY) return;
  const lease = await sql`INSERT INTO arena_bingo_sync (source, lease_until)
    VALUES ('api-sports-football', now() + interval '2 minutes')
    ON CONFLICT (source) DO UPDATE SET lease_until = now() + interval '2 minutes'
    WHERE (arena_bingo_sync.last_synced_at IS NULL OR arena_bingo_sync.last_synced_at < now() - interval '3 hours')
      AND (arena_bingo_sync.lease_until IS NULL OR arena_bingo_sync.lease_until < now())
    RETURNING source`;
  if (!lease.length) return;
  try {
    for (const league of LEAGUES) {
      const url = new URL("https://v3.football.api-sports.io/fixtures");
      url.searchParams.set("league", String(league));
      url.searchParams.set("season", week.from.slice(0, 4));
      url.searchParams.set("from", week.from);
      url.searchParams.set("to", week.to);
      url.searchParams.set("timezone", "UTC");
      const response = await fetch(url, { headers: { "x-apisports-key": API_KEY }, cache: "no-store", signal: AbortSignal.timeout(12_000) });
      if (!response.ok) throw new Error(`API-Sports HTTP ${response.status}`);
      const payload = await response.json() as { response?: any[]; errors?: unknown };
      for (const item of payload.response || []) {
        const fixtureId = String(item.fixture?.id || "");
        const homeName = String(item.teams?.home?.name || "");
        const awayName = String(item.teams?.away?.name || "");
        if (fixtureId) {
          await sql`INSERT INTO arena_bingo_fixtures (week_key, fixture_id, league, home, away, home_logo, away_logo, kickoff, status, home_score, away_score)
            VALUES (${week.key}, ${fixtureId}, ${String(item.league?.name || "")}, ${homeName}, ${awayName}, ${String(item.teams?.home?.logo || "")}, ${String(item.teams?.away?.logo || "")}, ${String(item.fixture?.date || "")}, ${String(item.fixture?.status?.short || "NS")}, ${Number.isInteger(item.goals?.home) ? Number(item.goals.home) : null}, ${Number.isInteger(item.goals?.away) ? Number(item.goals.away) : null})
            ON CONFLICT (week_key, fixture_id) DO UPDATE SET league=EXCLUDED.league, home=EXCLUDED.home, away=EXCLUDED.away, home_logo=EXCLUDED.home_logo, away_logo=EXCLUDED.away_logo, kickoff=EXCLUDED.kickoff, status=EXCLUDED.status, home_score=EXCLUDED.home_score, away_score=EXCLUDED.away_score, updated_at=now()`;
        }
        const home = trackedName(homeName);
        const away = trackedName(awayName);
        const short = String(item.fixture?.status?.short || "NS");
        const homeScore = Number.isInteger(item.goals?.home) ? Number(item.goals.home) : null;
        const awayScore = Number.isInteger(item.goals?.away) ? Number(item.goals.away) : null;
        const settled = FINAL.has(short) && homeScore !== null && awayScore !== null;
        for (const [team, opponent, isHome] of [[home, away || item.teams?.away?.name, true], [away, home || item.teams?.home?.name, false]] as const) {
          if (!team) continue;
          const won = settled ? (isHome ? homeScore! > awayScore! : awayScore! > homeScore!) : null;
          await sql`INSERT INTO arena_bingo_team_results (week_key, team, opponent, kickoff, status, won, home_score, away_score)
            VALUES (${week.key}, ${team}, ${String(opponent || "")}, ${String(item.fixture?.date || "")}, ${short}, ${won}, ${homeScore}, ${awayScore})
            ON CONFLICT (week_key, team) DO UPDATE SET opponent=EXCLUDED.opponent, kickoff=EXCLUDED.kickoff, status=EXCLUDED.status, won=EXCLUDED.won, home_score=EXCLUDED.home_score, away_score=EXCLUDED.away_score, updated_at=now()`;
        }
      }
    }
    await sql`UPDATE arena_bingo_sync SET last_synced_at=now(), lease_until=NULL, last_error=NULL WHERE source='api-sports-football'`;
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown sync error";
    await sql`UPDATE arena_bingo_sync SET last_synced_at=now(), lease_until=NULL, last_error=${message.slice(0,300)} WHERE source='api-sports-football'`;
  }
}

export async function GET() {
  if (!process.env.DATABASE_URL) return NextResponse.json({ available: false, teams: [] }, { status: 503 });
  const sql = database();
  await ensureTables(sql);
  const week = weekWindow();
  await sync(sql, week);
  const [rows, fixtures] = await Promise.all([
    sql`SELECT team, opponent, kickoff, status, won, home_score, away_score FROM arena_bingo_team_results WHERE week_key=${week.key} ORDER BY kickoff`,
    sql`SELECT fixture_id AS id, league, home, away, home_logo, away_logo, kickoff, status, home_score, away_score FROM arena_bingo_fixtures WHERE week_key=${week.key} ORDER BY kickoff`,
  ]);
  return NextResponse.json({
    available: !!API_KEY,
    week: week.key,
    window: { from: week.from, to: week.to },
    teams: rows.map(row => ({ ...row, live: LIVE.has(String(row.status || "")) })),
    fixtures: fixtures.map(row => ({ ...row, live: LIVE.has(String(row.status || "")), final: FINAL.has(String(row.status || "")) })),
  }, { headers: { "Cache-Control": "no-store" } });
}
