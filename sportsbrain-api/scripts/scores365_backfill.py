#!/usr/bin/env python3
"""
F2.53: Backfill local 365Scores to shot_events.
Cobertura: Brasileirao A (113), Brasileirao B (116), CONMEBOL Lib (102), Sud (389).
Cada shot tem minute to permite split HT/FT.

Uso (de sportsbrain-api/):
  python scripts/scores365_backfill.py [--from DD/MM/YYYY] [--to DD/MM/YYYY] [--competitions 113,116]
"""
import argparse
import json
import subprocess
import sys
import unicodedata
import urllib.request
from datetime import datetime, timedelta
from pathlib import Path

S365 = "https://webws.365scores.com/web"

COMPETITION_NAMES = {
    113: "Brasileirao Serie A",
    116: "Brasileirao Serie B",
    102: "CONMEBOL Libertadores",
    389: "CONMEBOL Sudamericana",
}


def fetch_json(url):
    req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0", "Accept": "application/json"})
    with urllib.request.urlopen(req, timeout=20) as r:
        return json.loads(r.read())


def norm_team(s):
    if not s: return ""
    n = unicodedata.normalize("NFD", str(s)).encode("ascii", "ignore").decode("ascii").lower()
    # strip common suffixes
    for sfx in [" fc", " sc", " ac", " cf", " afc", " ec"]:
        if n.endswith(sfx): n = n[: -len(sfx)]
    out = "".join(c if c.isalnum() or c == " " else " " for c in n)
    return " ".join(out.split()).strip()


def norm_player(s):
    if not s: return ""
    n = unicodedata.normalize("NFD", str(s)).encode("ascii", "ignore").decode("ascii").lower()
    out = "".join(c if c.isalnum() or c == " " else " " for c in n)
    return " ".join(out.split()).strip()


def sq(s):
    return str(s).replace("'", "''") if s is not None else ""


def parse_minute(t):
    if not t: return None
    s = str(t).replace("'", "").replace('"', "").split("+")[0]
    try: return int(s)
    except: return None


def fmt(d):
    return f"{d.day:02d}/{d.month:02d}/{d.year}"


def list_games(date_from, date_to, comp_ids):
    url = (f"{S365}/games/allscores/?appTypeId=5&langId=1"
           f"&timezoneName=America/Sao_Paulo&userCountryId=21"
           f"&startDate={date_from}&endDate={date_to}&sports=1")
    data = fetch_json(url)
    want = set(comp_ids)
    # statusGroup: 3=Live? 4=Ended (Brasil); statusText='Ended' é o sinal robusto
    return [g for g in data.get("games", [])
            if g.get("competitionId") in want
            and (g.get("statusGroup") in (3, 4) or (g.get("statusText") or "").startswith("Ended"))
            and g.get("hasStats") is True]


def get_game_shots(game_id, fallback_home, fallback_away):
    url = (f"{S365}/game/?appTypeId=5&langId=1"
           f"&timezoneName=America/Sao_Paulo&userCountryId=21"
           f"&gameId={game_id}&showLineups=true&showStatistics=true&showPlayerStatistics=true")
    data = fetch_json(url)
    g = data.get("game", {})
    ce = (g.get("chartEvents") or {})
    events = ce.get("events", []) if isinstance(ce, dict) else []
    if not events: return None
    home_name = (g.get("homeCompetitor") or {}).get("name") or fallback_home
    away_name = (g.get("awayCompetitor") or {}).get("name") or fallback_away
    member_by_id = {}
    for m in (g.get("members") or []):
        if m.get("athleteId"): member_by_id[m["athleteId"]] = m
        if m.get("id"): member_by_id[m["id"]] = m
    shots = []
    for e in events:
        if e.get("type") not in (0, None): continue
        minute = parse_minute(e.get("time"))
        period = 2 if (minute is not None and minute > 45) else 1
        is_home = 1 if e.get("competitorNum") == 1 else 0
        team_name = home_name if is_home else away_name
        outcome = (e.get("outcome") or {}).get("name")
        is_goal = 1 if outcome == "Goal" else 0
        on_target = 1 if outcome in ("Goal", "Saved") else 0
        member = member_by_id.get(e.get("playerId"))
        player_name = (member or {}).get("name")
        try: xg = float(e.get("xg") or 0)
        except: xg = 0.0
        shots.append({
            "team": team_name,
            "team_norm": norm_team(team_name),
            "player_name": player_name,
            "minute": minute,
            "period": period,
            "shot_type": f"subType_{e.get('subType')}" if e.get("subType") is not None else None,
            "body_part": e.get("bodyPart"),
            "x_coord": e.get("line"),
            "y_coord": e.get("side"),
            "on_target": on_target,
            "is_goal": is_goal,
            "xg_computed": xg,
            "is_home": is_home,
        })
    return {"match_id": f"365|{game_id}", "shots": shots,
            "home": home_name, "away": away_name}


def build_sql(game_data):
    mid = game_data["match_id"]
    stmts = [f"DELETE FROM shot_events WHERE match_id = '{sq(mid)}';"]
    for s in game_data["shots"]:
        minute = s["minute"] if s["minute"] is not None else "NULL"
        period = s["period"] if s["period"] is not None else "NULL"
        x = s["x_coord"] if s["x_coord"] is not None else "NULL"
        y = s["y_coord"] if s["y_coord"] is not None else "NULL"
        body = f"'{sq(s['body_part'])}'" if s["body_part"] else "NULL"
        stype = f"'{sq(s['shot_type'])}'" if s["shot_type"] else "NULL"
        pname = f"'{sq(s['player_name'])}'" if s["player_name"] else "NULL"
        stmts.append(
            "INSERT INTO shot_events "
            "(match_id, team, team_norm, player_name, assist_player, minute, period, shot_type, "
            "body_part, x_coord, y_coord, distance, angle_deg, on_target, is_goal, xg_computed, "
            "xg_model_ver, is_home) VALUES "
            f"('{sq(mid)}','{sq(s['team'])}','{sq(s['team_norm'])}',{pname},NULL,"
            f"{minute},{period},{stype},{body},{x},{y},NULL,NULL,"
            f"{s['on_target']},{s['is_goal']},{s['xg_computed']},'365',{s['is_home']});"
        )
    return stmts


def run_d1(sql_file):
    cmd = f'npx wrangler d1 execute SB_DB --remote --file="{sql_file}"'
    r = subprocess.run(cmd, capture_output=True, encoding="utf-8", errors="replace", shell=True)
    if r.returncode != 0:
        print("WRANGLER ERR:", (r.stderr or r.stdout or "")[-700:], file=sys.stderr)
        return False
    return True


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--from", dest="d_from", help="DD/MM/YYYY (default: 60 dias atrás)")
    ap.add_argument("--to", dest="d_to", help="DD/MM/YYYY (default: hoje)")
    ap.add_argument("--competitions", default="113,116,102,389",
                    help="CSV de competitionIds (default todos BR/CONMEBOL)")
    ap.add_argument("--bucket-days", type=int, default=7)
    args = ap.parse_args()

    today = datetime.now()
    d_to = datetime.strptime(args.d_to, "%d/%m/%Y") if args.d_to else today
    d_from = datetime.strptime(args.d_from, "%d/%m/%Y") if args.d_from else (today - timedelta(days=60))
    comp_ids = [int(x.strip()) for x in args.competitions.split(",") if x.strip()]
    print(f"Backfill 365Scores: {fmt(d_from)} to {fmt(d_to)} comps={comp_ids}")

    tmp_dir = Path("./.scores365_tmp")
    tmp_dir.mkdir(exist_ok=True)
    total_games = 0
    total_shots = 0

    cursor = d_from
    while cursor <= d_to:
        bucket_end = min(cursor + timedelta(days=args.bucket_days - 1), d_to)
        bf, bt = fmt(cursor), fmt(bucket_end)
        try:
            games = list_games(bf, bt, comp_ids)
        except Exception as e:
            print(f"  [{bf}..{bt}] LIST FAIL: {e}")
            cursor = bucket_end + timedelta(days=1); continue

        print(f"  [{bf}..{bt}] {len(games)} games | ", end="", flush=True)
        bucket_shots = 0
        bucket_games_ok = 0
        all_stmts = []
        for g in games:
            try:
                gd = get_game_shots(
                    g["id"],
                    (g.get("homeCompetitor") or {}).get("name"),
                    (g.get("awayCompetitor") or {}).get("name"),
                )
                if not gd or not gd["shots"]:
                    continue
                all_stmts.extend(build_sql(gd))
                bucket_games_ok += 1
                bucket_shots += len(gd["shots"])
            except Exception as e:
                print(f"\n    GAME {g.get('id')} FAIL: {e}", end="", flush=True)

        if all_stmts:
            sql_path = tmp_dir / f"bucket_{cursor.strftime('%Y%m%d')}.sql"
            sql_path.write_text("\n".join(all_stmts), encoding="utf-8")
            ok = run_d1(str(sql_path))
            if ok:
                print(f"OK games={bucket_games_ok} shots={bucket_shots}")
                total_games += bucket_games_ok
                total_shots += bucket_shots
                sql_path.unlink()
            else:
                print(f"EXECUTE FAILED games={bucket_games_ok} shots={bucket_shots}")
        else:
            print("no shots")

        cursor = bucket_end + timedelta(days=1)

    print(f"\nTOTAL: {total_games} games, {total_shots} shots ingested")


if __name__ == "__main__":
    main()
