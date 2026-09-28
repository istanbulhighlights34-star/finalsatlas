import { neon } from "@neondatabase/serverless";
import { createHash, randomBytes } from "node:crypto";

export const fixtures = [
  ["hta-bay", "Hapoel Tel Aviv", "Bayern Munich", "2026-09-24T16:00:00Z"],
  ["dub-rmb", "Dubai Basketball", "Real Madrid", "2026-09-24T16:00:00Z"],
  ["czv-zal", "Crvena Zvezda", "Žalgiris Kaunas", "2026-09-24T18:00:00Z"],
  ["pao-pbb", "Panathinaikos", "Paris Basketball", "2026-09-24T18:15:00Z"],
  ["kba-oly", "Baskonia", "Olympiacos", "2026-09-24T18:30:00Z"],
  ["bar-efs", "FC Barcelona", "Anadolu Efes", "2026-09-24T18:30:00Z"],
  ["asv-mta", "ASVEL", "Maccabi Tel Aviv", "2026-09-24T18:45:00Z"],
  ["bjk-vbc", "Beşiktaş", "Valencia Basket", "2026-09-25T17:00:00Z"],
  ["fbt-vir", "Fenerbahçe", "Virtus Bologna", "2026-09-25T17:45:00Z"],
  ["par-mil", "Partizan", "Olimpia Milano", "2026-09-25T18:45:00Z"],
  ["r2-dub-bar", "Dubai Basketball", "FC Barcelona", "2026-09-29T16:00:00Z"],
  ["r2-efs-rmb", "Anadolu Efes", "Real Madrid", "2026-09-29T17:00:00Z"],
  ["r2-zal-oly", "Žalgiris Kaunas", "Olympiacos", "2026-09-29T17:00:00Z"],
  ["r2-fbt-bay", "Fenerbahçe", "Bayern Munich", "2026-09-29T17:45:00Z"],
  ["r2-czv-hta", "Crvena Zvezda", "Hapoel Tel Aviv", "2026-09-29T18:00:00Z"],
  ["r2-vbc-kba", "Valencia Basket", "Baskonia", "2026-09-29T19:30:00Z"],
  ["r2-mil-vir", "Olimpia Milano", "Virtus Bologna", "2026-09-29T19:30:00Z"],
  ["r2-pbb-par", "Paris Basketball", "Partizan", "2026-09-29T19:45:00Z"],
  ["r2-mta-bjk", "Maccabi Tel Aviv", "Beşiktaş", "2026-09-30T18:05:00Z"],
  ["r2-pao-asv", "Panathinaikos", "ASVEL", "2026-09-30T18:15:00Z"],
] as const;\nexport const fixtureRound: Record<string, number> = Object.fromEntries(fixtures.map(([id]) => [id, id.startsWith("r2-") ? 2 : 1]));
export const teams: string[] = fixtures.flatMap((game) => [game[1], game[2]]);
export const firstLock = Date.parse(fixtures[0][3]) - 120_000;
export const hash = (value: string) => createHash("sha256").update(value).digest("hex");
export const token = () => randomBytes(32).toString("base64url");
export function database() {
  if (!process.env.DATABASE_URL) throw new Error("Database unavailable");
  return neon(process.env.DATABASE_URL);
}
export async function member(request: Request) {
  const session = request.headers.get("cookie")?.match(/(?:^|;\s*)arena_session=([^;]+)/)?.[1];
  if (!session) return null;
  const rows = await database()`SELECT u.id, u.email, u.nickname FROM arena_sessions s JOIN arena_users u ON u.id = s.user_id WHERE s.token_hash = ${hash(session)} AND s.expires_at > now() LIMIT 1`;
  return rows[0] as { id: string; email: string; nickname: string | null } | undefined || null;
}
export function sameOrigin(request: Request) {
  const origin = request.headers.get("origin");
  return !!origin && origin === new URL(request.url).origin;
}
export function jsonError(message: string, status = 400) { return Response.json({ error: message }, { status }); }
