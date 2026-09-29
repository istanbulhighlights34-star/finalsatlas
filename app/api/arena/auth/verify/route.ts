import { database, hash, token } from "../../../../../lib/arena";

export const runtime = "nodejs";
export async function GET(request: Request) {
  const url = new URL(request.url);
  const secret = url.searchParams.get("token");
  if (!secret || secret.length > 100 || !process.env.DATABASE_URL) return Response.redirect(new URL("/arena/sign-in?login=invalid", url.origin));
  const sql = database();
  const consumed = await sql`UPDATE arena_login_tokens SET consumed_at = now() WHERE token_hash = ${hash(secret)} AND consumed_at IS NULL AND expires_at > now() RETURNING email`;
  if (!consumed.length) return Response.redirect(new URL("/arena/sign-in?login=expired", url.origin));
  const email = String(consumed[0].email);
  const users = await sql`INSERT INTO arena_users (email) VALUES (${email}) ON CONFLICT (email) DO UPDATE SET email = EXCLUDED.email RETURNING id`;
  const session = token();
  await sql`INSERT INTO arena_sessions (token_hash, user_id, expires_at) VALUES (${hash(session)}, ${users[0].id}, now() + interval '90 days')`;
  return new Response(null, { status: 303, headers: { Location: "/arena/me", "Set-Cookie": `arena_session=${session}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=7776000` } });
}
