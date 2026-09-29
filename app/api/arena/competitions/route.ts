import { database, jsonError, member, sameOrigin, token, hash } from "../../../../lib/arena";

export const runtime = "nodejs";

async function ensureTables() {
  const sql = database();
  await sql`CREATE TABLE IF NOT EXISTS arena_competitions (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    group_id uuid NOT NULL REFERENCES arena_groups(id) ON DELETE CASCADE,
    name text NOT NULL,
    sport text NOT NULL,
    game_type text NOT NULL,
    season text NOT NULL,
    owner_id uuid NOT NULL REFERENCES arena_users(id) ON DELETE CASCADE,
    invite_hash text NOT NULL UNIQUE,
    created_at timestamptz NOT NULL DEFAULT now()
  )`;
  await sql`CREATE TABLE IF NOT EXISTS arena_competition_members (
    competition_id uuid NOT NULL REFERENCES arena_competitions(id) ON DELETE CASCADE,
    user_id uuid NOT NULL REFERENCES arena_users(id) ON DELETE CASCADE,
    joined_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (competition_id, user_id)
  )`;
}

export async function GET(request: Request) {
  const user = await member(request);
  if (!user) return jsonError("Sign in first", 401);
  await ensureTables();
  const groupId = new URL(request.url).searchParams.get("groupId");
  if (!groupId) return jsonError("Choose a circle");
  const sql = database();
  const access = await sql`SELECT 1 FROM arena_members WHERE group_id=${groupId} AND user_id=${user.id} LIMIT 1`;
  if (!access.length) return jsonError("Circle not found", 404);
  const competitions = await sql`SELECT c.id, c.name, c.sport, c.game_type, c.season, c.created_at,
    (c.owner_id=${user.id}) AS is_owner, count(cm.user_id)::integer AS players
    FROM arena_competitions c
    JOIN arena_competition_members mine ON mine.competition_id=c.id AND mine.user_id=${user.id}
    LEFT JOIN arena_competition_members cm ON cm.competition_id=c.id
    WHERE c.group_id=${groupId}
    GROUP BY c.id ORDER BY c.created_at DESC`;
  return Response.json({ competitions }, { headers: { "Cache-Control": "no-store" } });
}

export async function POST(request: Request) {
  if (!sameOrigin(request)) return jsonError("Invalid origin", 403);
  const user = await member(request);
  if (!user) return jsonError("Sign in first", 401);
  await ensureTables();
  const body = await request.json() as { groupId?: string; name?: string; sport?: string; gameType?: string; season?: string; playerIds?: string[] };
  const name = body.name?.trim();
  if (!body.groupId || !name || name.length > 60) return jsonError("Competition name must be 1–60 characters");
  const games: Record<string, string[]> = { football: ["bingo", "score-picks"], basketball: ["euroleague"] };
  if (!body.sport || !body.gameType || !games[body.sport]?.includes(body.gameType)) return jsonError("Choose a valid sport and game");
  const sql = database();
  const owner = await sql`SELECT 1 FROM arena_groups WHERE id=${body.groupId} AND owner_id=${user.id} LIMIT 1`;
  if (!owner.length) return jsonError("Only the circle owner can create a competition", 403);
  const requested = Array.isArray(body.playerIds) ? [...new Set(body.playerIds)].slice(0, 100) : [];
  const members = await sql`SELECT user_id FROM arena_members WHERE group_id=${body.groupId}`;
  const allowed = new Set(members.map(row => String(row.user_id)));
  const playerIds = requested.filter(id => allowed.has(String(id)));
  if (!playerIds.includes(String(user.id))) playerIds.unshift(String(user.id));
  const invitation = token();
  const created = await sql`INSERT INTO arena_competitions (group_id,name,sport,game_type,season,owner_id,invite_hash)
    VALUES (${body.groupId},${name},${body.sport},${body.gameType},${body.season || "2026/27"},${user.id},${hash(invitation)})
    RETURNING id,name,sport,game_type,season`;
  for (const playerId of playerIds) {
    await sql`INSERT INTO arena_competition_members (competition_id,user_id) VALUES (${created[0].id},${playerId}) ON CONFLICT DO NOTHING`;
  }
  return Response.json({ competition: { ...created[0], players: playerIds.length }, inviteUrl: `${new URL(request.url).origin}/arena?competition=${invitation}` });
}
