#!/usr/bin/env python3
"""
F2.52: One-shot backfill local de Cartola FC → D1 player_match_aggs.
Não precisa de secrets — usa wrangler d1 execute --remote --file.
Roda 1x manualmente. Cron diário 05:00 UTC depois mantém atualizado.

Uso (de sportsbrain-api/):
  python scripts/cartola_backfill.py [--from 1] [--to 38] [--season 2026]
"""
import argparse
import json
import os
import subprocess
import sys
import unicodedata
import urllib.request
from pathlib import Path

CARTOLA = "https://api.cartola.globo.com"


def fetch_json(url):
    req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"})
    with urllib.request.urlopen(req, timeout=15) as r:
        return json.loads(r.read())


def norm(s):
    if not s:
        return ""
    n = unicodedata.normalize("NFD", str(s)).encode("ascii", "ignore").decode("ascii").lower()
    out = "".join(c if c.isalnum() or c == " " else " " for c in n)
    return " ".join(out.split()).strip()


def sq(s):
    """SQL escape single quote"""
    return str(s).replace("'", "''")


def build_sql_for_rodada(rodada, season):
    partidas_j = fetch_json(f"{CARTOLA}/partidas/{rodada}")
    pontuados_j = fetch_json(f"{CARTOLA}/atletas/pontuados/{rodada}")

    clubes = partidas_j.get("clubes") or {}
    partidas = partidas_j.get("partidas") or []
    if not partidas:
        return [], 0, 0

    clube_to_partida = {}
    for p in partidas:
        pid = p["partida_id"]
        data = (p.get("partida_data") or "").replace(" ", "T")
        match_id = f"cartola|{season}|{pid}"
        home = clubes.get(str(p["clube_casa_id"]), {})
        away = clubes.get(str(p["clube_visitante_id"]), {})
        clube_to_partida[str(p["clube_casa_id"])] = {
            "partida_id": pid, "match_id": match_id, "is_home": 1,
            "team_norm": norm(home.get("nome") or home.get("abreviacao")),
            "partida_data": data,
        }
        clube_to_partida[str(p["clube_visitante_id"])] = {
            "partida_id": pid, "match_id": match_id, "is_home": 0,
            "team_norm": norm(away.get("nome") or away.get("abreviacao")),
            "partida_data": data,
        }

    atletas = pontuados_j.get("atletas") or {}
    statements = []
    players_n = 0
    shooters_n = 0

    for aid, a in atletas.items():
        scout = a.get("scout") or {}
        ff, fd, ft, g = scout.get("FF", 0), scout.get("FD", 0), scout.get("FT", 0), scout.get("G", 0)
        shots = ff + fd + ft + g
        ot = fd + ft + g

        info = clube_to_partida.get(str(a.get("clube_id")))
        if not info:
            continue
        player_name = a.get("apelido") or a.get("nome") or f"cartola_{aid}"
        player_norm = norm(player_name)
        if not player_norm:
            continue
        if shots > 0:
            shooters_n += 1
        players_n += 1

        scout_raw = json.dumps(scout, separators=(",", ":"))
        sql = (
            "INSERT INTO player_match_aggs "
            "(match_id, source, season, rodada, partida_data, team_norm, is_home, "
            "player_name, player_norm, shots, shots_on_target, goals, assists, tackles, "
            "fouls_committed, fouls_suffered, yellow, red, scout_raw) VALUES "
            f"('{sq(info['match_id'])}','cartola',{season},{rodada},'{sq(info['partida_data'])}',"
            f"'{sq(info['team_norm'])}',{info['is_home']},'{sq(player_name)}','{sq(player_norm)}',"
            f"{shots},{ot},{g},{scout.get('A',0)},{scout.get('DS',0)},"
            f"{scout.get('FC',0)},{scout.get('FS',0)},{scout.get('CA',0)},{scout.get('CV',0)},"
            f"'{sq(scout_raw)}') "
            "ON CONFLICT(match_id, player_norm, source) DO UPDATE SET "
            "shots=excluded.shots,shots_on_target=excluded.shots_on_target,goals=excluded.goals,"
            "assists=excluded.assists,tackles=excluded.tackles,"
            "fouls_committed=excluded.fouls_committed,fouls_suffered=excluded.fouls_suffered,"
            "yellow=excluded.yellow,red=excluded.red,scout_raw=excluded.scout_raw,"
            "ingested_at=datetime('now');"
        )
        statements.append(sql)
    return statements, players_n, shooters_n


def run_d1(sql_file):
    """Roda wrangler d1 execute --file (shell=True para Windows resolver npx)"""
    cmd = f'npx wrangler d1 execute SB_DB --remote --file="{sql_file}"'
    r = subprocess.run(cmd, capture_output=True, encoding="utf-8", errors="replace", shell=True)
    if r.returncode != 0:
        print("WRANGLER ERR:", (r.stderr or r.stdout or "")[-700:], file=sys.stderr)
        return False
    return True


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--from-rodada", "--from", dest="from_r", type=int, default=1)
    ap.add_argument("--to-rodada", "--to", dest="to_r", type=int, default=None)
    ap.add_argument("--season", type=int, default=None)
    args = ap.parse_args()

    season = args.season or 2026
    to_r = args.to_r
    if to_r is None:
        status = fetch_json(f"{CARTOLA}/mercado/status")
        to_r = status.get("rodada_atual") or 38

    print(f"Backfill Cartola: season={season} rodadas {args.from_r}..{to_r}")
    total_players = 0
    total_shooters = 0
    tmp_dir = Path("./.cartola_tmp")
    tmp_dir.mkdir(exist_ok=True)

    for r in range(args.from_r, to_r + 1):
        print(f"  Rodada {r}: fetching…", end=" ", flush=True)
        try:
            stmts, p, s = build_sql_for_rodada(r, season)
        except Exception as e:
            print(f"FAIL {e}")
            continue
        if not stmts:
            print("no data")
            continue
        # Salva SQL em arquivo (D1 --file aceita até 50MB)
        sql_path = tmp_dir / f"r{r}.sql"
        sql_path.write_text("\n".join(stmts), encoding="utf-8")
        # Executa
        ok = run_d1(str(sql_path))
        if ok:
            print(f"players={p} shooters={s} OK")
            total_players += p
            total_shooters += s
            sql_path.unlink()
        else:
            print(f"players={p} shooters={s} EXECUTE FAILED")

    print(f"\nTotal: {total_players} players, {total_shooters} shooters in {to_r - args.from_r + 1} rodadas")


if __name__ == "__main__":
    main()
