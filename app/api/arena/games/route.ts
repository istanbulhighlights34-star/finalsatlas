export const dynamic = "force-dynamic";
export const revalidate = 0;

import { NextResponse } from "next/server";

const API_URL = "https://v1.basketball.api-sports.io";
const EUROLeague_ID = process.env.EUROLEAGUE_LEAGUE_ID || "120";
const SEASON = process.env.EUROLEAGUE_SEASON || "2026-2027";

export async function GET(request: Request) {
  const key = process.env.API_SPORTS_BASKETBALL_KEY;
  if (!key) return NextResponse.json({ available: false, error: "Basketball API key is not configured." }, { status: 503 });

  const date = new URL(request.url).searchParams.get("date");
  const params = new URLSearchParams({ league: EUROLeague_ID, season: SEASON });
  if (date) params.set("date", date);

  const response = await fetch(`${API_URL}/games?${params.toString()}`, {
    headers: { "x-apisports-key": key },
    next: { revalidate: 60 },
  });
  if (!response.ok) return NextResponse.json({ available: false, error: "Basketball provider request failed." }, { status: 502 });

  const payload = await response.json() as { response?: Array<any> };
  const games = (payload.response || []).map((game) => ({
    id: String(game.id),
    home: game.teams?.home?.name || "Home",
    away: game.teams?.away?.name || "Away",
    homeLogo: game.teams?.home?.logo || null,
    awayLogo: game.teams?.away?.logo || null,
    tipoff: game.date,
    status: game.status?.short || null,
    statusLong: game.status?.long || null,
    result: Number.isFinite(game.scores?.home?.total) && Number.isFinite(game.scores?.away?.total)
      ? { home: game.scores.home.total, away: game.scores.away.total }
      : null,
  }));
  return NextResponse.json({ available: true, games, provider: "API-Sports", updatedAt: new Date().toISOString() });
}
