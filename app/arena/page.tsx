"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import styles from "./arena.module.css";

type Game = { round?: number; id: string; home: string; away: string; tipoff: string; homeLogo?: string | null; awayLogo?: string | null; status?: string | null; result?: { home: number; away: number } | null; liveScore?: { home: number; away: number } | null };
type Picks = { games: Record<string, "1" | "2">; topScorer: string; roundTopScorers: Record<string, string>; champion: string; finalFour: string[] };
// EuroLeague Media Centre lists these times in CEST (UTC+2).
const initialGames: Game[] = [
  { id: "hta-bay", home: "Hapoel Tel Aviv", away: "Bayern Munich", tipoff: "2026-09-24T16:00:00Z", result: { home: 84, away: 86 } },
  { id: "dub-rmb", home: "Dubai Basketball", away: "Real Madrid", tipoff: "2026-09-24T16:00:00Z", result: { home: 78, away: 77 } },
  { id: "czv-zal", home: "Crvena Zvezda", away: "Žalgiris Kaunas", tipoff: "2026-09-24T18:00:00Z" },
  { id: "pao-pbb", home: "Panathinaikos", away: "Paris Basketball", tipoff: "2026-09-24T18:15:00Z" },
  { id: "kba-oly", home: "Baskonia", away: "Olympiacos", tipoff: "2026-09-24T18:30:00Z" },
  { id: "bar-efs", home: "FC Barcelona", away: "Anadolu Efes", tipoff: "2026-09-24T18:30:00Z", result: { home: 89, away: 82 } },
  { id: "asv-mta", home: "ASVEL", away: "Maccabi Tel Aviv", tipoff: "2026-09-24T18:45:00Z" },
  { id: "bjk-vbc", home: "Beşiktaş", away: "Valencia Basket", tipoff: "2026-09-25T17:00:00Z" },
  { id: "fbt-vir", home: "Fenerbahçe", away: "Virtus Bologna", tipoff: "2026-09-25T17:45:00Z" },
  { id: "par-mil", home: "Partizan", away: "Olimpia Milano", tipoff: "2026-09-25T18:45:00Z" },
];
initialGames.push(
  { id: "r2-dub-bar", round: 2, home: "Dubai Basketball", away: "FC Barcelona", tipoff: "2026-09-29T16:00:00Z" },
  { id: "r2-efs-rmb", round: 2, home: "Anadolu Efes", away: "Real Madrid", tipoff: "2026-09-29T17:00:00Z" },
  { id: "r2-zal-oly", round: 2, home: "Žalgiris Kaunas", away: "Olympiacos", tipoff: "2026-09-29T17:00:00Z" },
  { id: "r2-fbt-bay", round: 2, home: "Fenerbahçe", away: "Bayern Munich", tipoff: "2026-09-29T17:45:00Z" },
  { id: "r2-czv-hta", round: 2, home: "Crvena Zvezda", away: "Hapoel Tel Aviv", tipoff: "2026-09-29T18:00:00Z" },
  { id: "r2-vbc-kba", round: 2, home: "Valencia Basket", away: "Baskonia", tipoff: "2026-09-29T19:30:00Z" },
  { id: "r2-mil-vir", round: 2, home: "Olimpia Milano", away: "Virtus Bologna", tipoff: "2026-09-29T19:30:00Z" },
  { id: "r2-pbb-par", round: 2, home: "Paris Basketball", away: "Partizan", tipoff: "2026-09-29T19:45:00Z" },
  { id: "r2-mta-bjk", round: 2, home: "Maccabi Tel Aviv", away: "Beşiktaş", tipoff: "2026-09-30T18:05:00Z" },
  { id: "r2-pao-asv", round: 2, home: "Panathinaikos", away: "ASVEL", tipoff: "2026-09-30T18:15:00Z" },
);
const initialTeams = [...new Set(initialGames.flatMap((game) => [game.home, game.away]))];
const storageKey = "finalsatlas-euroleague-2026-27-round-1";
const emptyPicks: Picks = { games: {}, topScorer: "", roundTopScorers: {}, champion: "", finalFour: [] };
const formatTime = (iso: string) => new Intl.DateTimeFormat(undefined, {
  weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", timeZoneName: "short",
}).format(new Date(iso));

const bingoTiers = [
  { id: "elite", label: "TOP TIER", limit: 3, points: 10, teams: ["Manchester City", "Bayern Munich", "Paris Saint-Germain", "Real Madrid", "Barcelona", "Inter"] },
  { id: "middle", label: "CHALLENGERS", limit: 4, points: 20, teams: ["Newcastle", "Başakşehir", "Hoffenheim", "Real Sociedad", "Real Betis", "Atalanta"] },
  { id: "outsider", label: "OUTSIDERS", limit: 3, points: 30, teams: ["Çorum FK", "Gaziantep", "Angers", "Crystal Palace", "Lecce", "St. Pauli"] },
] as const;
type BingoTier = typeof bingoTiers[number]["id"];

export default function ArenaPage() {
  const [now, setNow] = useState<number | null>(null);
  const [games, setGames] = useState<Game[]>(initialGames);
  const [liveSource, setLiveSource] = useState<"api" | "fallback">("fallback");
  const [picks, setPicks] = useState<Picks>(emptyPicks);
  const [submittedRounds, setSubmittedRounds] = useState<number[]>([]);
  const [submittingRound, setSubmittingRound] = useState(false);
  const [saved, setSaved] = useState(true);
  const [clockSource, setClockSource] = useState<"checking" | "server" | "device">("checking");
  const [account, setAccount] = useState<{ id: string; email: string } | null>(null);
  const [available, setAvailable] = useState(false);
  const [email, setEmail] = useState("");
  const [nickname, setNickname] = useState("");
  const [message, setMessage] = useState("");
  const [selectedSport, setSelectedSport] = useState<"football" | "basketball">("football");
  const [footballCompetition, setFootballCompetition] = useState<"leagues" | "cups">("leagues");
  const [footballLeague, setFootballLeague] = useState("Süper Lig");
  const [footballCup, setFootballCup] = useState("Champions League");
  const [footballGame, setFootballGame] = useState<"picks" | "bingo">("picks");
  const [bingoPicks, setBingoPicks] = useState<Record<BingoTier, string[]>>({ elite: [], middle: [], outsider: [] });
  const [bingoSaved, setBingoSaved] = useState(false);
  const [bingoCards, setBingoCards] = useState<{ id: string; name: string; card: Record<BingoTier, string[]> }[]>([]);
  const [bingoReady, setBingoReady] = useState(0);
  const [bingoPlayers, setBingoPlayers] = useState(0);
  const [bingoStandings, setBingoStandings] = useState<{ id: string; name: string; locked: boolean; firstChinko: number; secondChinko: number; bingo: number; weeklyTotal: number }[]>([]);
  const [bingoTeamResults, setBingoTeamResults] = useState<Record<string, { opponent?: string; status?: string; won?: boolean | null; live?: boolean }>>({});
  const [bingoWeek, setBingoWeek] = useState("");
  const [accountPickValues, setAccountPickValues] = useState<Record<string, string>>({});
  const [groups, setGroups] = useState<{ id: string; name: string }[]>([]);
  const [groupName, setGroupName] = useState("");
  const [selectedGroup, setSelectedGroup] = useState("");
  const [standings, setStandings] = useState<{ name: string; points: number; picks: number }[]>([]);
  const [inviteUrl, setInviteUrl] = useState("");
  const offset = useRef(0);
  const teams = games.length ? [...new Set(games.flatMap((game) => [game.home, game.away]))] : initialTeams;
  const firstLock = games.length ? Date.parse(games[0].tipoff) - 120_000 : Infinity;

  useEffect(() => {
    async function syncClock() {
      const started = Date.now();
      try {
        const response = await fetch("/api/arena/time", { cache: "no-store" });
        if (!response.ok) throw new Error("Clock unavailable");
        const data = await response.json() as { now: number };
        if (!Number.isFinite(data.now)) throw new Error("Invalid clock");
        offset.current = data.now - Math.round((started + Date.now()) / 2);
        setClockSource("server");
      } catch {
        offset.current = 0;
        setClockSource("device");
      }
      setNow(Date.now() + offset.current);
    }
    void syncClock();
    try {
      const value = localStorage.getItem(storageKey);
      if (value) {
        const stored = JSON.parse(value) as Partial<Picks>;
        setPicks({ games: stored.games || {}, topScorer: stored.topScorer || "", roundTopScorers: stored.roundTopScorers || {}, champion: stored.champion || "", finalFour: Array.isArray(stored.finalFour) ? stored.finalFour : [] });
        setSubmittedRounds(Array.isArray((stored as { submittedRounds?: number[] }).submittedRounds) ? (stored as { submittedRounds: number[] }).submittedRounds : []);
      }
    } catch { setSaved(false); }
    const interval = setInterval(() => setNow(Date.now() + offset.current), 10_000);
    const resync = setInterval(() => { void syncClock(); }, 60_000);
    return () => { clearInterval(interval); clearInterval(resync); };
  }, []);

  useEffect(() => {
    let active = true;
    async function refreshGames() {
      try {
        const response = await fetch("/api/arena/games", { cache: "no-store" });
        const data = await response.json() as { available?: boolean; games?: Game[] };
        if (active && response.ok && data.available && Array.isArray(data.games) && data.games.length) {
          setGames(data.games);
          setLiveSource("api");
        }
      } catch {
        if (active) setLiveSource("fallback");
      }
    }
    void refreshGames();
    const interval = setInterval(() => { void refreshGames(); }, 5 * 60_000);
    return () => { active = false; clearInterval(interval); };
  }, []);

  useEffect(() => {
    async function load() {
      try {
        const inviteFromUrl = new URLSearchParams(window.location.search).get("invite");
        if (inviteFromUrl) localStorage.setItem("finalsatlas-pending-invite", inviteFromUrl);
        const response = await fetch("/api/arena/auth", { cache: "no-store" });
        const data = await response.json();
        setAvailable(!!data.available);
        setAccount(data.user || null);
        setNickname(data.user?.nickname || "");
        if (!data.user) return;
        const [savedPicks, membership] = await Promise.all([fetch("/api/arena/picks"), fetch("/api/arena/groups")]);
        if (savedPicks.ok) {
          const values = (await savedPicks.json()).picks as Record<string, string>;
          setPicks({ games: Object.fromEntries(Object.entries(values).filter(([key]) => key.startsWith("game:")).map(([key, value]) => [key.slice(5), value as "1" | "2"])), topScorer: values["topScorer:1"] || values.topScorer || "", roundTopScorers: { "1": values["topScorer:1"] || values.topScorer || "", "2": values["topScorer:2"] || "" }, champion: values.champion || "", finalFour: JSON.parse(values.finalFour || "[]") });
          setSubmittedRounds([1, 2].filter(round => values[`roundSubmitted:${round}`] === "submitted"));
          setAccountPickValues(values);
        }
        if (membership.ok) setGroups((await membership.json()).groups);
        const invite = inviteFromUrl || localStorage.getItem("finalsatlas-pending-invite");
        if (invite) {
          const joined = await fetch("/api/arena/groups", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ invite }) });
          if (joined.ok) {
            const group = (await joined.json()).group;
            setGroups(previous => previous.some(item => item.id === group.id) ? previous : [group, ...previous]);
            setSelectedGroup(group.id);
            history.replaceState(null, "", "/arena");
            localStorage.removeItem("finalsatlas-pending-invite");
            setMessage(`Joined ${group.name}`);
          } else {
            setMessage("Invitation could not be used.");
            if (joined.status === 404) localStorage.removeItem("finalsatlas-pending-invite");
          }
        }
      } catch { setMessage("Account service is unavailable."); }
    }
    void load();
  }, []);

  useEffect(() => {
    let active = true;
    async function refreshBingoResults() {
      try {
        const response = await fetch("/api/arena/bingo", { cache: "no-store" });
        const data = await response.json();
        if (active && Array.isArray(data.teams)) {
          setBingoTeamResults(Object.fromEntries(data.teams.map((team: { team: string }) => [team.team, team])));
          const week = String(data.week || "");
          setBingoWeek(week);
          const stored = accountPickValues[`bingoCard:${week}`] || (!account ? localStorage.getItem(`finalsatlas-bingo-${week}`) : "");
          if (stored) {
            try { setBingoPicks(JSON.parse(stored)); setBingoSaved(true); } catch { /* ignore malformed saved card */ }
          }
        }
      } catch { /* keep the card usable while the score feed is unavailable */ }
    }
    void refreshBingoResults();
    const interval = setInterval(() => { void refreshBingoResults(); }, 15 * 60_000);
    return () => { active = false; clearInterval(interval); };
  }, [accountPickValues, account]);

  useEffect(() => {
    if (!selectedGroup) return;
    let active = true;
    async function refresh() {
      const response = await fetch(`/api/arena/groups/${selectedGroup}`, { cache: "no-store" });
      if (response.ok && active) {
        const data = await response.json();
        setStandings(data.standings || []);
        setBingoCards(data.bingoCards || []);
        setBingoReady(data.bingoReady || 0);
        setBingoPlayers(data.bingoPlayers || 0);
        setBingoStandings(data.bingoStandings || []);
      }
    }
    void refresh();
    const interval = setInterval(() => { void refresh(); }, 60_000);
    return () => { active = false; clearInterval(interval); };
  }, [selectedGroup]);

  function update(next: Picks) {
    setPicks(next);
    if (account) {
      const changed = Object.entries(next.games).find(([id, value]) => picks.games[id] !== value);
      const changedBonusRound = ["1", "2"].find(round => next.roundTopScorers[round] !== picks.roundTopScorers[round]);
      const key = changed ? `game:${changed[0]}` : changedBonusRound ? `topScorer:${changedBonusRound}` : next.topScorer !== picks.topScorer ? "topScorer" : next.champion !== picks.champion ? "champion" : "finalFour";
      const selection = changed ? changed[1] : changedBonusRound ? next.roundTopScorers[changedBonusRound] : key === "topScorer" ? next.topScorer : key === "champion" ? next.champion : JSON.stringify(next.finalFour);
      setSaved(false);
      void fetch("/api/arena/picks", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ key, selection }) }).then(async response => {
        if (!response.ok) { setPicks(picks); setMessage((await response.json()).error || "Could not save pick"); }
        else setSaved(true);
      }).catch(() => { setPicks(picks); setMessage("Could not save pick"); });
    } else {
      try { localStorage.setItem(storageKey, JSON.stringify({ ...next, submittedRounds })); setSaved(true); }
      catch { setSaved(false); }
    }
  }

  const bonusOpen = now !== null && now < firstLock;
  const roundGames = games.filter(game => (game.round || (game.id.startsWith("r2-") ? 2 : 1)) === 2);
  const historyGames = games.filter(game => (game.round || (game.id.startsWith("r2-") ? 2 : 1)) === 1);
  const complete = roundGames.filter((game) => picks.games[game.id]).length;
  const openCount = now === null ? 0 : roundGames.filter((game) => now < Date.parse(game.tipoff) - 120_000).length;
  const roundSubmitted = submittedRounds.includes(2);
  const round2FirstLock = roundGames.length ? Math.min(...roundGames.map(game => Date.parse(game.tipoff) - 120_000)) : Infinity;
  const round2BonusOpen = now !== null && now < round2FirstLock;
  const getTopScoringTeams = (roundMatches: Game[]) => {
    if (!roundMatches.length || roundMatches.some(game => !game.result)) return null;
    const totals = new Map<string, number>();
    for (const game of roundMatches) { totals.set(game.home, (totals.get(game.home) || 0) + game.result!.home); totals.set(game.away, (totals.get(game.away) || 0) + game.result!.away); }
    const highest = Math.max(...totals.values());
    return [...totals.entries()].filter(([, points]) => points === highest).map(([team]) => team);
  };
  const week1BonusTeams = getTopScoringTeams(historyGames);
  const week2BonusTeams = getTopScoringTeams(roundGames);
  const timeZone = now === null ? "Your local time" : new Intl.DateTimeFormat(undefined, { timeZoneName: "short" }).formatToParts(new Date(now)).find((part) => part.type === "timeZoneName")?.value || "Local time";

  function updateBingoSlot(tier: BingoTier, index: number, team: string) {
    if (bingoSaved) return;
    setBingoPicks(previous => {
      const row = [...previous[tier]];
      while (row.length < bingoTiers.find(item => item.id === tier)!.limit) row.push("");
      row[index] = team;
      return { ...previous, [tier]: row.filter((value, position) => value || position < row.length) };
    });
  }

  async function lockBingoCard() {
    if (!bingoComplete || bingoSaved) return;
    if (account) {
      const response = await fetch("/api/arena/picks", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ key: `bingoCard:${bingoWeek}`, selection: JSON.stringify(bingoPicks) }) });
      const data = await response.json();
      if (!response.ok) { setMessage(data.error || "Could not lock Bingo card."); return; }
    } else {
      localStorage.setItem(`finalsatlas-bingo-${bingoWeek}`, JSON.stringify(bingoPicks));
    }
    setBingoSaved(true);
    setMessage(account ? "Bingo card locked. Group cards open when every player is ready." : "Bingo card locked on this device.");
  }

  const bingoComplete = bingoTiers.every(tier => bingoPicks[tier.id].length === tier.limit && bingoPicks[tier.id].every(Boolean) && new Set(bingoPicks[tier.id]).size === tier.limit);

  async function submitCurrentRound() {
    if (complete !== roundGames.length || !roundGames.length) return;
    setSubmittingRound(true);
    try {
      if (account) {
        const response = await fetch("/api/arena/picks", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "submitRound", round: 2 }) });
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || "Could not submit picks.");
      } else {
        const nextRounds = [...submittedRounds, 2];
        setSubmittedRounds(nextRounds);
        localStorage.setItem(storageKey, JSON.stringify({ ...picks, submittedRounds: nextRounds }));
      }
      setSubmittedRounds(previous => previous.includes(2) ? previous : [...previous, 2]);
      setMessage("Week 2 picks saved. Each match stays editable until two minutes before tip-off.");
    } catch (error) { setMessage(error instanceof Error ? error.message : "Could not submit picks."); }
    finally { setSubmittingRound(false); }
  }

  return <main className={styles.page}>
    <header className={styles.header}>
      <Link className="brand" href="/" aria-label="Finals Atlas Arena home"><img className="brand-mark" src="/icon.svg" alt="" aria-hidden="true" /><span className="brand-name"><span>FINALS</span><span>ATLAS</span></span></Link>
      <nav aria-label="Primary navigation">
        <Link href="/finals">Finals</Link>
        <Link href="/cities/istanbul">Istanbul</Link>
        <Link href="/cities/madrid">Madrid</Link>
        <Link href="/cities/frankfurt">Frankfurt</Link>
      </nav>
        <details className="mobile-menu">
          <summary aria-label="Open navigation"><span aria-hidden="true">☰</span></summary>
          <div className="mobile-menu-panel">
            <Link href="/finals">Explore 2027</Link>
            <Link href="/blog">Journal</Link>
            <Link href="/arena">Arena</Link>
          </div>
        </details>
      <div className={styles.headerActions}>
        <Link className={styles.headerLink} href="/blog">Journal</Link>
        <Link className={`${styles.headerLink} ${styles.active}`} href="/arena" aria-current="page">Arena</Link>
        <Link className={styles.headerButton} href="/finals">Explore 2027</Link>
      </div>
    </header>
    <div className={styles.shell}>
      <div className={styles.topline}><span>FINALS ATLAS / ARENA PULSE</span><span>{liveSource === "api" ? "SCORE FEED · THESPORTSDB" : "EUROLEAGUE · 2026/27"}</span></div>
      <section className={styles.intro}><div><p className={styles.kicker}>ROUND 02 · 29–30 SEPTEMBER</p><h1><span className={styles.heroLine}><span className={styles.heroInitial}>F</span>OLLOW EVERY FINAL</span><br /><span className={styles.heroLine}><span className={styles.heroInitial}>A</span>CROSS EVERY ARENA</span></h1></div></section>
      <div className={styles.notice} role="status"><strong>{account ? `Signed in: ${account.email}` : "Personal preview"}</strong><span>{account ? "Your new picks are saved to your account. Scores appear after verified results are entered." : "Your picks are saved in this browser only. Sign in to save future picks and join groups. Existing device picks are not transferred after their deadlines."} {clockSource === "device" && "Server time is unavailable; deadlines currently use your device clock."}</span></div>
      {available && <section className={styles.panel} style={{ padding: 24, marginBottom: 24 }} aria-label="Account and friend groups">
        <div className={styles.panelHeading}><span>YOUR CIRCLE</span><span>EUROLEAGUE</span></div>
        {!account ? <form className={styles.accountForm} onSubmit={async event => { event.preventDefault(); setMessage("Sending sign-in link…"); try { const response = await fetch("/api/arena/auth", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email }) }); const data = await response.json(); setMessage(response.ok ? "Check your email for a sign-in link. You will stay signed in for 90 days." : data.error); } catch { setMessage("Could not send sign-in link."); } }}><p>Sign in with email to save picks and compete with friends.</p><div className={styles.accountFields}><input type="email" required placeholder="you@example.com" value={email} onChange={event => setEmail(event.target.value)} /> <button className={styles.result} type="submit">Email me a sign-in link</button></div></form> : <div>
          <form className={styles.accountForm} onSubmit={async event => { event.preventDefault(); const response = await fetch("/api/arena/auth", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ nickname }) }); setMessage(response.ok ? "Nickname saved." : "Could not save nickname."); }}><label htmlFor="nickname">Your Arena name</label><div className={styles.accountFields}><input id="nickname" maxLength={32} required value={nickname} onChange={event => setNickname(event.target.value)} placeholder="Your nickname" /> <button className={styles.result} type="submit">Save card</button></div></form>
          <form className={styles.accountForm} onSubmit={async event => { event.preventDefault(); const response = await fetch("/api/arena/groups", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name: groupName }) }); const data = await response.json(); if (response.ok) { setGroups(previous => [data.group, ...previous]); setSelectedGroup(data.group.id); setInviteUrl(data.inviteUrl); setGroupName(""); setMessage("Group created. Share the invitation link with friends."); } else setMessage(data.error); }}><label htmlFor="group-name">Create your circle</label><div className={styles.accountFields}><input id="group-name" maxLength={60} required value={groupName} onChange={event => setGroupName(event.target.value)} placeholder="Circle name" /> <button className={styles.result} type="submit">Create circle</button></div></form>
          {inviteUrl && <p>Circle invite: <input readOnly aria-label="Invitation link" value={inviteUrl} onFocus={event => event.target.select()} style={{ width: "min(100%, 500px)", padding: 10 }} /></p>}
          {groups.length > 0 && <div className={styles.groupsBlock}><p className={styles.groupsLabel}>Your circles</p><div className={styles.groupChoices}>{groups.map(group => <button key={group.id} className={selectedGroup === group.id ? styles.groupActive : styles.groupChoice} type="button" onClick={() => setSelectedGroup(group.id)} aria-pressed={selectedGroup === group.id}>{group.name}</button>)}</div>{selectedGroup && <div className={styles.standingsWrap}><div className={styles.standingsHeader}><span>RANK / PLAYER</span><span>POINTS</span><span>PICKS</span></div><ol className={styles.standings}>{standings.map((entry, index) => <li key={entry.name}><span className={styles.rank}>{index + 1}</span><span className={styles.player}>{entry.name}</span><strong>{entry.points}</strong><span>{entry.picks}</span></li>)}</ol></div>}</div>}
          <button type="button" className={`${styles.result} ${styles.signOut}`} onClick={async () => { await fetch("/api/arena/auth", { method: "DELETE" }); location.reload(); }}>Leave Arena</button>
        </div>}
        {message && <p role="status">{message}</p>}
      </section>}
      <section className={styles.pulseDashboard} aria-label="Arena Pulse overview">
        <div className={styles.pulseWelcome}>
          <span className={styles.pulseKicker}>ARENA PULSE</span>
          <h2>{account ? `Welcome back, ${nickname || "player"}` : "Choose your arena"}</h2>
          <p>One home for every sport, every competition and every circle. Start with a sport or jump back into your season.</p>
        </div>
        <div className={styles.sportDashboard}>
          <button className={`${styles.sportCard} ${selectedSport === "football" ? styles.sportCardActive : ""}`} type="button" onClick={() => setSelectedSport("football")}>
            <span className={styles.sportNumber}>01</span><strong>Football</strong><small>Domestic leagues · European cups</small><b>Open arena →</b>
          </button>
          <button className={`${styles.sportCard} ${selectedSport === "basketball" ? styles.sportCardActive : ""}`} type="button" onClick={() => setSelectedSport("basketball")}>
            <span className={styles.sportNumber}>02</span><strong>Basketball</strong><small>EuroLeague · season picks</small><b>Open arena →</b>
          </button>
          <div className={styles.sportCardComing}>
            <span className={styles.sportNumber}>03+</span><strong>More sports</strong><small>New competitions will appear here as Finals Atlas grows.</small><b>Coming next</b>
          </div>
        </div>
        <div className={styles.pulseMetrics}>
          <div><span>CALLS MADE</span><strong>{complete}<small> / 10</small></strong><em>{openCount} open</em></div>
          <div><span>SEASON SCORE</span><strong>{standings.find(entry => entry.name === nickname)?.points || 0}</strong><em>{selectedGroup ? "Your circle" : "No circle yet"}</em></div>
          <div><span>YOUR CIRCLE</span><strong>{groups.length}</strong><em>{groups.length ? "Ready to play" : "Create or join"}</em></div>
        </div>
        <div className={styles.pulseActions}>
          <a href="#matchroom">Open selected arena <b>→</b></a>
          <a href="#standings">View standings <b>→</b></a>
        </div>
      </section>{selectedSport === "football" && <section className={styles.footballHub} aria-label="Football competitions">
        <div className={styles.footballHubHeader}>
          <div><span className={styles.pulseKicker}>FOOTBALL ARENA</span><h2>Choose your competition</h2><p>Football has its own fixtures, predictions and standings, separate from Basketball.</p></div>
          <span className={styles.footballSeason}>2026 / 27 SEASON</span>
        </div>
        <div className={styles.footballModes} role="tablist" aria-label="Football competition type">
          <button type="button" role="tab" aria-selected={footballCompetition === "leagues"} className={footballCompetition === "leagues" ? styles.footballModeActive : styles.footballMode} onClick={() => setFootballCompetition("leagues")}><span>01</span><strong>Domestic Leagues</strong><small>Weekly league fixtures</small></button>
          <button type="button" role="tab" aria-selected={footballCompetition === "cups"} className={footballCompetition === "cups" ? styles.footballModeActive : styles.footballMode} onClick={() => setFootballCompetition("cups")}><span>02</span><strong>European Cups</strong><small>Continental competitions</small></button>
        </div>
        <div className={styles.footballGameModes} role="tablist" aria-label="Football game mode">
          <button type="button" role="tab" aria-selected={footballGame === "picks"} className={footballGame === "picks" ? styles.footballGameActive : styles.footballGame} onClick={() => setFootballGame("picks")}><span>01</span><strong>Score Picks</strong><small>Predict match results</small></button>
          <button type="button" role="tab" aria-selected={footballGame === "bingo"} className={footballGame === "bingo" ? styles.footballGameActive : styles.footballGame} onClick={() => setFootballGame("bingo")}><span>02</span><strong>Atlas Bingo</strong><small>Build a 10-team card</small></button>
        </div>
        {footballGame === "picks" ? <div className={styles.footballSelection}>
          <div className={styles.footballChoiceList} aria-label={footballCompetition === "leagues" ? "Select a domestic league" : "European Cups competition"}>
            {footballCompetition === "leagues"
              ? ["Süper Lig", "Premier League", "Bundesliga", "La Liga", "Ligue 1"].map((name) => {
                  const selected = footballLeague === name;
                  return <button key={name} type="button" aria-pressed={selected} className={selected ? styles.footballChoiceActive : styles.footballChoice} onClick={() => setFootballLeague(name)}>{name}<span>{selected ? "SELECTED" : "OPEN"}</span></button>;
                })
              : <button type="button" aria-pressed="true" className={styles.footballChoiceActive} onClick={() => setFootballCup("European Cups")}>European Cups<span>ALL THREE</span></button>}
          </div>
          <div className={styles.footballComing}>
            <span className={styles.pulseKicker}>{footballCompetition === "leagues" ? footballLeague.toUpperCase() : "CHAMPIONS LEAGUE · EUROPA LEAGUE · CONFERENCE LEAGUE"}</span>
            <h3>{footballCompetition === "cups" ? <>One shared<br /><em>European arena.</em></> : <>Fixtures are<br /><em>coming next.</em></>}</h3>
            <p>{footballCompetition === "cups" ? "Champions League, Europa League and Conference League matches belong to one shared competition. Members can follow their chosen club while everyone in the group predicts the same weekly fixtures." : "We’re preparing the football schedule and prediction room for this competition. Your football picks and standings will stay separate from EuroLeague."}</p>
            {footballCompetition === "cups" && <div className={styles.europeanBonusRules} aria-label="European Cups bonus scoring">
              <div><span>LEAGUE PHASE</span><strong>2 PTS</strong><p>For each team you correctly pick to finish in the top eight of a cup.</p></div>
              <div><span>SEASON PICK</span><strong>5 PTS</strong><p>For correctly picking the champion of each cup.</p></div>
              <small>No extra points are awarded for picking teams to advance in knockout ties.</small>
            </div>}
            <div className={styles.emptySportMeta}><span>COMPETITION</span><strong>{footballCompetition === "leagues" ? "DOMESTIC LEAGUE" : "THREE EUROPEAN CUPS · ONE ARENA"}</strong><span>STATUS</span><strong>FIXTURE FEED IN PREPARATION</strong></div>
          </div>
        </div> : <div className={styles.bingoBuilder}>
          <div className={styles.bingoIntro}>
            <span className={styles.pulseKicker}>WEEKLY 10-TEAM CARD</span>
            <h3>Build your Atlas Bingo</h3>
            <p>Choose 3 favourites, 4 challengers and 3 outsiders. A winning team lights up its square. The order of the rows does not matter.</p>
            <div className={styles.bingoRules}><span><strong>1ST CHINKO</strong><em>Any completed row · +10</em></span><span><strong>2ND CHINKO</strong><em>Any two completed rows · +20</em></span><span><strong>BINGO</strong><em>All 10 teams · +30</em></span></div>
            <div className={styles.bingoScore}><span>CURRENT CARD</span><strong>{bingoPicks.elite.filter(Boolean).length + bingoPicks.middle.filter(Boolean).length + bingoPicks.outsider.filter(Boolean).length}<small> / 10 teams</small></strong><em>Maximum weekly score · 60 points</em></div>
          </div>
          <div className={styles.bingoCard}>
            <div className={styles.bingoTicket}>
              <div className={styles.bingoTicketTop}><span>FINALS ATLAS · WEEKLY CARD</span><strong>{bingoSaved ? "LOCKED" : "BUILDING"}</strong></div>
              {bingoTiers.map((tier, index) => <section className={styles.bingoRow} key={tier.id}>
                <div className={styles.bingoRowHead}><span>ROW 0{index + 1} · {tier.label}</span><strong>CHINKO ROW</strong><small>{bingoPicks[tier.id].filter(Boolean).length} / {tier.limit}</small></div>
                <div className={styles.bingoSlots}>{Array.from({ length: tier.limit }, (_, slot) => {
                  const selected = bingoPicks[tier.id][slot] || "";
                  const used = new Set(bingoPicks[tier.id].filter(Boolean));
                  const teamResult = selected ? bingoTeamResults[selected] : undefined;
                  const finalLost = teamResult && teamResult.won === false;
                  const slotClass = teamResult?.won === true ? styles.bingoSlotWon : teamResult?.live ? styles.bingoSlotLive : finalLost ? styles.bingoSlotLost : selected ? styles.bingoSlotSelected : styles.bingoSlot;
                  return <label className={slotClass} key={slot}><span>{teamResult?.opponent ? `vs ${teamResult.opponent}` : String(slot + 1).padStart(2, "0")}</span><select aria-label={`${tier.label} team ${slot + 1}`} value={selected} disabled={bingoSaved} onChange={event => updateBingoSlot(tier.id, slot, event.target.value)}><option value="">Choose team</option>{tier.teams.map(team => <option key={team} value={team} disabled={used.has(team) && team !== selected}>{team}</option>)}</select><em>{teamResult?.won === true ? "WIN" : teamResult?.live ? "LIVE" : finalLost ? "FT" : selected ? selected.slice(0, 2).toUpperCase() : "FA"}</em></label>;
                })}</div>
              </section>)}
              <div className={styles.bingoSave}><div><strong>{bingoSaved ? "Your card is locked." : bingoComplete ? "Your 10-team card is ready." : "Complete all three rows to lock your card."}</strong><span>Cards stay private until every player in the circle has locked a complete card.</span></div><button type="button" disabled={!bingoComplete || bingoSaved} onClick={() => void lockBingoCard()}>{bingoSaved ? "CARD LOCKED" : "LOCK MY CARD"}</button></div>
            </div>
            {selectedGroup && <section className={styles.communityCards}>
              <div className={styles.communityHead}><div><span className={styles.pulseKicker}>CIRCLE CARDS</span><h3>{bingoCards.length ? "The cards are open" : "Waiting for every player"}</h3></div><strong>{bingoReady} / {bingoPlayers} LOCKED</strong></div>
              {bingoCards.length ? <div className={styles.communityGrid}>{bingoCards.map(player => <article className={styles.miniBingo} key={player.id}><header><strong>{player.name}</strong><span>{bingoWeek || "CURRENT WEEK"}</span></header>{bingoTiers.map(tier => <div className={styles.miniBingoRow} key={tier.id}>{player.card[tier.id].map(team => <span key={team}>{team}</span>)}</div>)}</article>)}</div> : <p className={styles.communityEmpty}>No card is revealed yet. As soon as every member locks a complete card, all cards appear here together.</p>}
              <div className={styles.bingoTableWrap}>
                <div className={styles.bingoTableTitle}><span>{bingoWeek ? `WEEK OF ${bingoWeek} · SCOREBOARD` : "CURRENT WEEK · SCOREBOARD"}</span><strong>MAX 60 PTS</strong></div>
                <div className={styles.bingoTableHead}><span>PLAYER</span><span>CARD</span><span>1ST CHINKO</span><span>2ND CHINKO</span><span>BINGO</span><span>TOTAL</span></div>
                <ol className={styles.bingoTable}>{bingoStandings.map((player, index) => <li key={player.id}><span><b>{index + 1}</b>{player.name}</span><em className={player.locked ? styles.cardLocked : styles.cardBuilding}>{player.locked ? "LOCKED" : "BUILDING"}</em><span>{player.firstChinko}<small> / 10</small></span><span>{player.secondChinko}<small> / 20</small></span><span>{player.bingo}<small> / 30</small></span><strong>{player.weeklyTotal}</strong></li>)}</ol>
                {!bingoStandings.length && <p className={styles.communityEmpty}>The weekly table appears when your circle has players.</p>}
              </div>
            </section>}
          </div>
        </div>}
      </section>}
      <div className={selectedSport === "football" ? styles.hiddenSportContent : ""}>
      <section id="matchroom" className={styles.heroGrid} aria-label="EuroLeague Round 2 predictions">
        <article className={styles.challenge}>
          <div className={styles.cardTop}><span>ROUND 02 / {roundGames.length} GAMES</span><span>{timeZone}</span></div>
          <div className={styles.challengeBody}>
            <p className={styles.eyebrow}>MATCHROOM · 2 POINTS EACH</p><h2>Who wins?</h2>
            <p className={styles.muted}>1 = home win · 2 = away win. Each game closes two minutes before tip-off. Times below are local to you.</p>
            <div className={styles.matchList}>{roundGames.map((game) => {
              const locked = now === null || now >= Date.parse(game.tipoff) - 120_000;
              const score = game.result || game.liveScore;
              return <div className={styles.matchRow} key={game.id}>
                <div className={styles.matchInfo}><time dateTime={game.tipoff}>{now === null ? "Checking local time…" : formatTime(game.tipoff)}</time><span>{now === null ? "Checking" : game.result ? "Final" : game.liveScore ? `Live · ${game.status || "In progress"}` : locked ? "Locked" : "Open"}</span></div>
                <div className={styles.matchTeams}><strong>{game.home}</strong><span>vs</span><strong>{game.away}</strong></div>
                <div className={styles.resultButtons} aria-label={`${game.home} vs ${game.away} winner`}>
                  {(["1", "2"] as const).map((choice) => <button key={choice} type="button" disabled={game.result ? true : locked} aria-label={choice === "1" ? `${game.home} wins` : `${game.away} wins`} aria-pressed={picks.games[game.id] === choice} className={game.result ? (game.result.home === game.result.away ? styles.finalScoreBox : ((choice === "1" && game.result.home > game.result.away) || (choice === "2" && game.result.away > game.result.home) ? styles.finalWinner : styles.finalScoreBox)) : game.liveScore ? styles.finalScoreBox : (picks.games[game.id] === choice ? styles.resultActive : styles.result)} onClick={() => {
                    if (Date.now() + offset.current >= Date.parse(game.tipoff) - 120_000) { setNow(Date.now() + offset.current); return; }
                    update({ ...picks, games: { ...picks.games, [game.id]: choice } });
                  }}>{score ? (choice === "1" ? score.home : score.away) : choice}</button>)}
                </div>
                {game.result && <p className={styles.pickFeedback}>{picks.games[game.id] ? ((picks.games[game.id] === "1" && game.result.home > game.result.away) || (picks.games[game.id] === "2" && game.result.away > game.result.home) ? "Correct · +2 points" : "Incorrect · 0 points") : "No pick · 0 points"}</p>}
              </div>;
            })}</div>
            <div className={styles.roundBonusResult}><strong>ROUND 2 TOP-SCORING TEAM</strong><span>{week2BonusTeams === null ? "Awaiting all final scores" : week2BonusTeams.join(" · ")}</span><em>{week2BonusTeams === null ? "Bonus not settled" : week2BonusTeams.includes(picks.roundTopScorers["2"] || "") ? `Your pick · ${picks.roundTopScorers["2"]} · +5 pts` : picks.roundTopScorers["2"] ? `Your pick · ${picks.roundTopScorers["2"]} · 0 pts` : "No bonus pick · 0 pts"}</em></div>
            <p className={styles.status}>{complete} / {roundGames.length} selected · {openCount} games open · {saved ? account ? "Saved to account" : "Saved on this device" : "Saving or unavailable"}</p>
            <div className={styles.submitBar}><span>{roundSubmitted ? "Your picks are saved. Each match remains editable until two minutes before tip-off." : "Save your picks; each match remains editable until two minutes before tip-off."}</span><button className={styles.submitButton} type="button" disabled={submittingRound || !saved || complete !== roundGames.length || now === null} onClick={() => void submitCurrentRound()}>{submittingRound ? "Saving…" : "Save week 2 picks"}</button></div>
          </div>
        </article>
        <aside className={styles.seasonCard}>
          <div className={styles.cardTop}><span>ROUND 02 BONUS</span><span>+5 POINTS</span></div>
          <div className={styles.sideBody}><h2>Top-scoring team</h2><p className={styles.muted}>Which team scores the most points in Round 2? A tie at the top counts for each tied team. This pick stays open until the first game starts, even after you submit your match picks.</p>
            <label className={styles.selectLabel} htmlFor="top-scorer">Choose a team</label>
            <select id="top-scorer" value={picks.roundTopScorers["2"] || ""} disabled={!round2BonusOpen} onChange={(event) => { if (Date.now() + offset.current < round2FirstLock) update({ ...picks, roundTopScorers: { ...picks.roundTopScorers, "2": event.target.value } }); else setNow(Date.now() + offset.current); }}><option value="">Select a team</option>{teams.map((team) => <option key={team}>{team}</option>)}</select>
            <p className={styles.status}>{round2BonusOpen ? `Locks ${formatTime(new Date(round2FirstLock).toISOString())}` : now === null ? "Checking deadline…" : "Round 2 bonus locked"}</p>
          </div>
        </aside>
      </section>
      <section className={styles.historySection} aria-label="Week 1 results and points"><div className={styles.historyHeading}><div><span className={styles.pulseKicker}>COMPLETED ROUND</span><h2>Week 1 · Results & points</h2></div><span>{historyGames.filter(game => !!game.result).length} / {historyGames.length} results</span></div><div className={styles.historyList}>{historyGames.map(game => { const correct = !!game.result && ((picks.games[game.id] === "1" && game.result.home > game.result.away) || (picks.games[game.id] === "2" && game.result.away > game.result.home)); return <div className={styles.historyRow} key={game.id}><span>{game.home} <i>vs</i> {game.away}</span><strong>{game.result ? `${game.result.home} – ${game.result.away}` : "Result pending"}</strong><em className={game.result ? (correct ? styles.pointsWon : styles.pointsMissed) : ""}>{game.result ? (picks.games[game.id] ? (correct ? "Correct · +2 pts" : "Incorrect · 0 pts") : "No pick · 0 pts") : "Awaiting final score"}</em></div>; })}</div><div className={styles.historyBonus}><strong>ROUND 1 TOP-SCORING TEAM</strong><span>{week1BonusTeams === null ? "Waiting for all final scores" : `${week1BonusTeams.join(" · ")} · +5 bonus points`}</span><em>{week1BonusTeams === null ? "Bonus not settled" : picks.topScorer ? (week1BonusTeams.includes(picks.topScorer) ? `Your pick · ${picks.topScorer} · +5 pts` : `Your pick · ${picks.topScorer} · 0 pts`) : "No bonus pick · 0 pts"}</em></div></section>
      <section id="standings" className={styles.dashboardGrid} aria-label="Season bonus predictions">
        <article className={styles.panel}><div className={styles.panelHeading}><span>SEASON CALL</span><span>+10 POINTS</span></div><div className={styles.sideBody}><h2>Champion</h2><p className={styles.muted}>Pick the 2026/27 champion before the first game.</p><label className={styles.selectLabel} htmlFor="champion">Choose a team</label><select id="champion" value={picks.champion} disabled={!bonusOpen} onChange={(event) => { if (Date.now() + offset.current < firstLock) update({ ...picks, champion: event.target.value }); else setNow(Date.now() + offset.current); }}><option value="">Select a team</option>{teams.map((team) => <option key={team}>{team}</option>)}</select></div></article>
        <article className={styles.panel}><div className={styles.panelHeading}><span>FINAL FOUR CALL</span><span>+3 PER TEAM</span></div><div className={styles.sideBody}><h2>Final Four</h2><p className={styles.muted}>Choose up to four teams before the first game. Each correct team earns three points.</p><div className={styles.teamPicker}>{teams.map((team) => {
          const selected = picks.finalFour.includes(team);
          return <button key={team} type="button" disabled={!bonusOpen || (!selected && picks.finalFour.length >= 4)} aria-pressed={selected} className={selected ? styles.pickSelected : styles.pick} onClick={() => {
            if (Date.now() + offset.current >= firstLock) { setNow(Date.now() + offset.current); return; }
            update({ ...picks, finalFour: selected ? picks.finalFour.filter((value) => value !== team) : [...picks.finalFour, team] });
          }}>{team}<span aria-hidden="true">{selected ? "✓" : "+"}</span></button>;
        })}</div><p className={styles.status}>{picks.finalFour.length} / 4 selected · {bonusOpen ? "Open" : "Locked"}</p></div></article>
      </section>
      </div>
      <div className={styles.bottomStrip}><span>Match source: <a href="https://mediacentre.euroleague.net/" target="_blank" rel="noreferrer">EuroLeague Media Centre ↗</a></span><span>Independent fan preview · No prize or entry fee</span></div>
    </div>
  </main>;
}
