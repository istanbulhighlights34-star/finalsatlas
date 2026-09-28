import { database, hash, jsonError, member, sameOrigin, token } from "../../../../lib/arena";

export const runtime = "nodejs";
async function ensureGroupStartColumn() {
  await database()`ALTER TABLE arena_groups ADD COLUMN IF NOT EXISTS started_at timestamptz`;
}

export async function GET(request: Request) {
  await ensureGroupStartColumn();
  const user = await member(request);
  if (!user) return jsonError("Sign in first", 401);
  const groups = await database()`SELECT g.id, g.name, g.created_at, g.started_at, (g.owner_id = ${user.id}) AS is_owner FROM arena_groups g JOIN arena_members m ON m.group_id = g.id WHERE m.user_id = ${user.id} ORDER BY g.created_at DESC`;
  return Response.json({ groups }, { headers: { "Cache-Control": "no-store" } });
}
export async function POST(request: Request) {
  await ensureGroupStartColumn();
  if (!sameOrigin(request)) return jsonError("Invalid origin", 403);
  const user = await member(request);
  if (!user) return jsonError("Sign in first", 401);
  const { name } = await request.json() as { name?: string };
  const clean = name?.trim();
  if (!clean || clean.length > 60) return jsonError("Group name must be 1–60 characters");
  const sql = database();
  const count = await sql`SELECT count(*)::integer AS count FROM arena_groups WHERE owner_id = ${user.id}`;
  if (Number(count[0].count) >= 20) return jsonError("Group limit reached", 429);
  const invitation = token();
  const created = await sql`INSERT INTO arena_groups (name, owner_id, invite_hash) VALUES (${clean}, ${user.id}, ${hash(invitation)}) RETURNING id, name, started_at, TRUE AS is_owner`;
  await sql`INSERT INTO arena_members (group_id, user_id) VALUES (${created[0].id}, ${user.id})`;
  return Response.json({ group: created[0], inviteUrl: `${new URL(request.url).origin}/arena?invite=${invitation}` });
}
export async function PUT(request: Request) {
  await ensureGroupStartColumn();
  if (!sameOrigin(request)) return jsonError("Invalid origin", 403);
  const user = await member(request);
  if (!user) return jsonError("Sign in first", 401);
  const { invite } = await request.json() as { invite?: string };
  if (!invite || invite.length > 100) return jsonError("Invalid invitation");
  const sql = database();
  const group = await sql`SELECT id, name, started_at, FALSE AS is_owner FROM arena_groups WHERE invite_hash = ${hash(invite)} LIMIT 1`;
  if (!group.length) return jsonError("Invitation is invalid or expired", 404);
  await sql`INSERT INTO arena_members (group_id, user_id) VALUES (${group[0].id}, ${user.id}) ON CONFLICT DO NOTHING`;
  return Response.json({ group: group[0] });
}

export async function PATCH(request: Request) {
  await ensureGroupStartColumn();
  if (!sameOrigin(request)) return jsonError("Invalid origin", 403);
  const user = await member(request);
  if (!user) return jsonError("Sign in first", 401);
  const { groupId, action } = await request.json() as { groupId?: string; action?: string };
  if (action !== "startLeague" || !groupId) return jsonError("Invalid league action");
  const sql = database();
  const started = await sql`UPDATE arena_groups
    SET started_at = now()
    WHERE id = ${groupId} AND owner_id = ${user.id} AND started_at IS NULL
    RETURNING id, name, started_at`;
  if (!started.length) {
    const existing = await sql`SELECT started_at FROM arena_groups WHERE id = ${groupId} AND owner_id = ${user.id} LIMIT 1`;
    if (!existing.length) return jsonError("Only the circle owner can start this league.", 403);
    if (!existing[0].started_at) return jsonError("Could not start this league.", 409);
    return Response.json({ ok: true, alreadyStarted: true, startedAt: existing[0].started_at });
  }
  return Response.json({ ok: true, startedAt: started[0].started_at });
}
