export const dynamic = "force-dynamic";
export const revalidate = 0;

import { NextResponse } from "next/server";

const API_URL = "https://v1.basketball.api-sports.io";
const EUROLEAGUE_ID = process.env.EUROLEAGUE_LEAGUE_ID || "120";
// API-Sports season values use the starting year, e.g. 2026 for 2026/27.
const SEASON = process.env.EUROLEAGUE_SEASON || "2026";
const FINISHED = new Set(["FT", "AOT", "AWD", "CANC", "ABD", "POST"]);

export async function GET() {
  const key = process.env.API_SPORTS_BASKETBALL_KEY;
  if (!key) return NextResponse.json({ available: false, error: "Basketball API key is not configured." }, { status: 503 });

  const params = new URLSearchParams({ league: EUROLEAGUE_ID, season: SEASON });
  const response = await fetch(`${API_URL}/games?${params.toString()}`, {
    headers: { "x-apisports-key": key },
    // Keep the free daily quota safe while the page can poll more frequently.
    next: { revalidate: 1200 },
  });
  if (!response.ok) {
    console.error("API-Sports basketball HTTP failure", { status: response.status });
    return NextResponse.json({ available: false, error: "Basketball provider request failed.", diagnostic: "UPSTREAM_HTTP_ERROR" }, { status: 502 });
  }

  let payload: { response?: Array<any>; errors?: Record<string, unknown> };
  try {
    payload = await response.json();
  } catch {
    console.error("API-Sports basketball response was not valid JSON");
    return NextResponse.json({ available: false, error: "Basketball provider returned an unreadable response.", diagnostic: "UPSTREAM_INVALID_JSON" }, { status: 502 });
  }

  const providerErrors = payload.errors && typeof payload.errors === "object"
    ? Object.keys(payload.errors)
    : [];
  if (providerErrors.length > 0) {
    // Keep error values in server logs only; never send provider details or credentials to clients.
    console.error("API-Sports basketball provider errors", { fields: providerErrors });
    return NextResponse.json({
      available: false,
      error: "Basketball provider rejected the request.",
      diagnostic: "UPSTREAM_API_ERROR",
      providerErrorFields: providerErrors,
    }, { status: 502 });
  }
  const allGames = (payload.response || []).map((game) => ({
    id: String(game.id),
    home: game.teams?.home?.name || "Home",
    away: game.teams?.away?.name || "Away",
    homeLogo: game.teams?.home?.logo || null,
    awayLogo: game.teams?.away?.logo || null,
    tipoff: game.date,
    status: game.status?.short || null,
    statusLong: game.status?.long || null,
    round: game.week || game.stage || null,
    result: !FINISHED.has(game.status?.short || "") && !["Q1", "Q2", "Q3", "Q4", "OT", "HT", "BT"].includes(game.status?.short || "")
      ? null
      : Number.isFinite(game.scores?.home?.total) && Number.isFinite(game.scores?.away?.total)
        ? { home: game.scores.home.total, away: game.scores.away.total }
        : null,
  })).filter((game) => Number.isFinite(Date.parse(game.tipoff)));

  // Show one active/upcoming round instead of dumping the entire season schedule.
  const groups = new Map<string, typeof allGames>();
  for (const game of allGames) {
    const key = game.round || game.tipoff.slice(0, 10);
    groups.set(key, [...(groups.get(key) || []), game]);
  }
  const now = Date.now();
  const groupValues = [...groups.values()];
  const activeGroups = groupValues.filter((group) => group.some((game) =>
    !FINISHED.has(game.status || "") && Date.parse(game.tipoff) >= now - 3 * 60 * 60 * 1000
  ));
  const selected = activeGroups.sort((a, b) =>
    Math.min(...a.filter((game) => !FINISHED.has(game.status || "")).map((game) => Date.parse(game.tipoff))) -
    Math.min(...b.filter((game) => !FINISHED.has(game.status || "")).map((game) => Date.parse(game.tipoff)))
  )[0] || groupValues
    .filter((group) => group.every((game) => FINISHED.has(game.status || "")))
    .sort((a, b) => Math.max(...b.map((game) => Date.parse(game.tipoff))) - Math.max(...a.map((game) => Date.parse(game.tipoff))))[0];

  const games = selected || [];
  return NextResponse.json({ available: true, games, provider: "API-Sports", providerGameCount: allGames.length, updatedAt: new Date().toISOString(), leagueId: EUROLEAGUE_ID, season: SEASON });
}
