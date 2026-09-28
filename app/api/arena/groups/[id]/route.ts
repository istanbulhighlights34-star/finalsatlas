import { database, fixtureRound, fixtures, jsonError, member, teams } from "../../../../../lib/arena";

export const runtime = "nodejs";
export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  const user = await member(request);
  if (!user) return jsonError("Sign in first", 401);
  const { id } = await context.params;
  const sql = database();
  const access = await sql`SELECT g.name FROM arena_groups g JOIN arena_members m ON m.group_id = g.id WHERE g.id = ${id} AND m.user_id = ${user.id} LIMIT 1`;
  if (!access.length) return jsonError("Group not found", 404);
  const [members, picks, results, season] = await Promise.all([
    sql`SELECT u.id, u.email, u.nickname FROM arena_members m JOIN arena_users u ON u.id = m.user_id WHERE m.group_id = ${id}`,
    sql`SELECT p.user_id, p.key, p.selection FROM arena_picks p JOIN arena_members m ON m.user_id = p.user_id WHERE m.group_id = ${id}`,
    sql`SELECT game_id, home_score, away_score FROM arena_results`,
    sql`SELECT champion, final_four FROM arena_season_results WHERE id = 1`,
  ]);
  const resultMap = new Map(results.map(r => [r.game_id, r]));
  const scores = members.map(m => {
    const byKey = new Map(picks.filter(p => p.user_id === m.id).map(p => [p.key, p.selection]));
    let points = 0;
    let settled = 0;
    for (const game of fixtures) {
      const result = resultMap.get(game[0]);
      if (!result) continue;
      settled++;
      const winner = Number(result.home_score) > Number(result.away_score) ? "1" : "2";
      if (byKey.get(`game:${game[0]}`) === winner) points += 2;
    }
    for (const round of [1, 2]) {
      const roundGames = fixtures.filter(([gameId]) => (fixtureRound[gameId] || 1) === round);
      if (!roundGames.length || roundGames.some(([gameId]) => !resultMap.has(gameId))) continue;
      const totals = new Map<string, number>();
      for (const game of roundGames) {
        const result = resultMap.get(game[0])!;
        totals.set(game[1], (totals.get(game[1]) || 0) + Number(result.home_score));
        totals.set(game[2], (totals.get(game[2]) || 0) + Number(result.away_score));
      }
      const highest = Math.max(...totals.values());
      const winners = [...totals.entries()].filter(([, total]) => total === highest).map(([team]) => team);
      const selected = byKey.get(`topScorer:${round}`) || (round === 1 ? byKey.get("topScorer") : undefined);
      if (selected && winners.includes(String(selected))) points += 5;
    }
    if (season.length) {
      if (byKey.get("champion") === season[0].champion) points += 10;
      try { const selected = JSON.parse(String(byKey.get("finalFour") || "[]")) as string[]; for (const team of selected) if (Array.isArray(season[0].final_four) && season[0].final_four.includes(team) && teams.includes(team)) points += 3; } catch { /* malformed historical pick */ }
    }
    return { id: m.id, name: m.nickname || `Player ${String(m.id).slice(0, 6)}`, points, picks: [...byKey.keys()].filter(k => k.startsWith("game:")).length, settled };
  });
  scores.sort((a, b) => b.points - a.points || a.name.localeCompare(b.name));
  const lockedCards = members.map(m => {
    const row = picks.find(p => p.user_id === m.id && p.key === "bingoCard:week-1");
    if (!row) return null;
    try { return { id: m.id, name: m.nickname || `Player ${String(m.id).slice(0, 6)}`, card: JSON.parse(String(row.selection)) }; }
    catch { return null; }
  });
  const bingoCards = lockedCards.every(Boolean) ? lockedCards : [];
  return Response.json({ name: access[0].name, standings: scores, bingoCards, bingoReady: lockedCards.filter(Boolean).length, bingoPlayers: members.length, scoredGames: results.length, totalGames: fixtures.length }, { headers: { "Cache-Control": "no-store" } });
}
