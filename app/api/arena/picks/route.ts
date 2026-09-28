import { database, firstLock, fixtureRound, fixtures, jsonError, member, sameOrigin, teams } from "../../../../lib/arena";

export const runtime = "nodejs";
export async function GET(request: Request) {
  const user = await member(request);
  if (!user) return jsonError("Sign in first", 401);
  const rows = await database()`SELECT key, selection FROM arena_picks WHERE user_id = ${user.id}`;
  return Response.json({ picks: Object.fromEntries(rows.map(row => [row.key, row.selection])) }, { headers: { "Cache-Control": "no-store" } });
}
export async function PUT(request: Request) {
  if (!sameOrigin(request)) return jsonError("Invalid origin", 403);
  const user = await member(request);
  if (!user) return jsonError("Sign in first", 401);
  const body = await request.json() as { key?: string; selection?: string; action?: string; round?: number };
  const sql = database();

  if (body.action === "submitRound") {
    const round = body.round;
    if (round !== 1 && round !== 2) return jsonError("Unknown round");
    const roundGames = fixtures.filter(([id]) => fixtureRound[id] === round);
    const firstRoundLock = Math.min(...roundGames.map(([, , , tipoff]) => Date.parse(tipoff) - 120_000));
    if (!roundGames.length || Date.now() >= firstRoundLock) return jsonError("This round has closed", 409);
    const rows = await sql`SELECT key, selection FROM arena_picks WHERE user_id = ${user.id}`;
    const saved = new Map(rows.map(row => [String(row.key), String(row.selection)]));
    if (roundGames.some(([id]) => saved.get(`game:${id}`) !== "1" && saved.get(`game:${id}`) !== "2")) {
      return jsonError("Choose a winner for every game before submitting.");
    }
    const submitted = await sql`INSERT INTO arena_picks (user_id, key, selection)
      SELECT ${user.id}, ${`roundSubmitted:${round}`}, 'submitted'
      WHERE clock_timestamp() < to_timestamp(${firstRoundLock} / 1000.0)
      ON CONFLICT (user_id, key) DO NOTHING
      RETURNING key`;
    if (!submitted.length) {
      const existing = await sql`SELECT key FROM arena_picks WHERE user_id = ${user.id} AND key = ${`roundSubmitted:${round}`} LIMIT 1`;
      if (!existing.length) return jsonError("This round has closed", 409);
    }
    return Response.json({ ok: true, submitted: true, round });
  }

  const { key, selection } = body;
  const game = fixtures.find(item => key === `game:${item[0]}`);
  const round = game ? fixtureRound[game[0]] || 1 : null;
  const lock = game ? Date.parse(game[3]) - 120_000 : firstLock;
  if (!game && !["topScorer", "champion", "finalFour"].includes(key || "")) return jsonError("Unknown pick");
  if (Date.now() >= lock) return jsonError("This pick has closed", 409);
  if (game && round) {
    const submitted = await sql`SELECT key FROM arena_picks WHERE user_id = ${user.id} AND key = ${`roundSubmitted:${round}`} LIMIT 1`;
    if (submitted.length) return jsonError("Your submitted picks for this round are locked.", 409);
  }
  if (game && selection !== "1" && selection !== "2") return jsonError("Invalid winner");
  if ((key === "topScorer" || key === "champion") && selection && !teams.includes(selection as typeof teams[number])) return jsonError("Invalid team");
  if (key === "finalFour") {
    let chosen: unknown;
    try { chosen = JSON.parse(selection || ""); } catch { return jsonError("Invalid teams"); }
    if (!Array.isArray(chosen) || chosen.length > 4 || new Set(chosen).size !== chosen.length || chosen.some(t => !teams.includes(t))) return jsonError("Invalid teams");
  }
  if (typeof selection !== "string" || selection.length > 300) return jsonError("Invalid selection");
  if (selection) {
    const saved = await sql`INSERT INTO arena_picks (user_id, key, selection)
      SELECT ${user.id}, ${key}, ${selection}
      WHERE clock_timestamp() < to_timestamp(${lock} / 1000.0)
        AND NOT EXISTS (SELECT 1 FROM arena_picks WHERE user_id = ${user.id} AND key = ${round ? `roundSubmitted:${round}` : "__no_round__"})
      ON CONFLICT (user_id, key) DO UPDATE SET selection = EXCLUDED.selection, updated_at = now()
      WHERE clock_timestamp() < to_timestamp(${lock} / 1000.0)
      RETURNING key`;
    if (!saved.length) return jsonError("This pick has closed or has already been submitted.", 409);
  } else {
    await sql`DELETE FROM arena_picks WHERE user_id = ${user.id} AND key = ${key}
      AND clock_timestamp() < to_timestamp(${lock} / 1000.0)
      AND NOT EXISTS (SELECT 1 FROM arena_picks WHERE user_id = ${user.id} AND key = ${round ? `roundSubmitted:${round}` : "__no_round__"})`;
  }
  return Response.json({ ok: true });
}
