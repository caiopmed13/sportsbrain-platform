"""
SportsBrain ML service — FastAPI + XGBoost.

Endpoints:
  POST /predict/nba_spread   → spread cover probability
  POST /predict/nba_total    → over/under probability
  POST /predict/soccer_1x2   → home/draw/away softmax
  GET  /models               → lista modelos carregados
  POST /train/nba_spread     → refit rápido com CSV em memória

Modelos treinados offline em `training/` e salvos como .joblib.
Se não houver modelo treinado, endpoint retorna placeholder probabilístico
baseado em heurística simples (power rating + home advantage).
"""
from __future__ import annotations
import os, joblib, math, time
from pathlib import Path
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field
from typing import Optional

MODEL_DIR = Path(os.getenv("SB_MODEL_DIR", "./models"))
MODEL_DIR.mkdir(parents=True, exist_ok=True)

app = FastAPI(title="SportsBrain ML", version="0.1.0")
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"])

_models: dict[str, object] = {}

def load_model(name: str):
    if name in _models: return _models[name]
    p = MODEL_DIR / f"{name}.joblib"
    if p.exists():
        _models[name] = joblib.load(p)
        return _models[name]
    return None

class NBAFeatures(BaseModel):
    home_team: str
    away_team: str
    home_power: float = Field(..., description="Elo/power rating")
    away_power: float
    home_rest_days: int = 2
    away_rest_days: int = 2
    home_b2b: bool = False
    away_b2b: bool = False
    injuries_home: int = 0
    injuries_away: int = 0
    line: float = Field(..., description="spread da casa (negativo = favorita)")

class TotalFeatures(BaseModel):
    home_team: str
    away_team: str
    pace_home: float = 100.0
    pace_away: float = 100.0
    ortg_home: float = 112.0
    ortg_away: float = 112.0
    drtg_home: float = 112.0
    drtg_away: float = 112.0
    total_line: float

class SoccerFeatures(BaseModel):
    home: str
    away: str
    home_xg: float = 1.3
    away_xg: float = 1.1
    home_form: float = 0.0  # last5 goal diff per game
    away_form: float = 0.0
    home_rest: int = 4
    away_rest: int = 4
    h2h_home_win_pct: float = 0.5

@app.get("/health")
def health():
    return {"ok": True, "ts": int(time.time()), "models_loaded": list(_models.keys())}

@app.get("/models")
def models_list():
    available = [p.stem for p in MODEL_DIR.glob("*.joblib")]
    return {"available": available, "loaded": list(_models.keys())}

@app.post("/predict/nba_spread")
def predict_nba_spread(f: NBAFeatures):
    m = load_model("nba_spread")
    if m is None:
        # heurística: power diff + home court (3pts) + rest/b2b adjustment
        edge = (f.home_power - f.away_power) + 3.0
        edge -= 4 if f.home_b2b else 0
        edge += 4 if f.away_b2b else 0
        edge -= 0.8 * f.injuries_home
        edge += 0.8 * f.injuries_away
        # P(home cover line) — line is home spread; cover if actual margin > -line
        # Approx via normal with sigma=11
        from math import erf, sqrt
        z = (edge - (-f.line)) / (11.0 * sqrt(2))
        p = 0.5 * (1 + erf(z))
        return {"model": "heuristic_power", "p_home_cover": round(p, 4),
                "p_away_cover": round(1 - p, 4), "edge_pts": round(edge, 2)}
    import pandas as pd
    X = pd.DataFrame([f.model_dump()])
    # assume model expects numeric features only
    Xn = X.select_dtypes(include=['number'])
    p = float(m.predict_proba(Xn)[0, 1])
    return {"model": "xgboost", "p_home_cover": round(p, 4), "p_away_cover": round(1 - p, 4)}

@app.post("/predict/nba_total")
def predict_nba_total(f: TotalFeatures):
    # Pace-adjusted expected points: (pace_avg / 100) * ((ortg_h + ortg_a) - (drtg_h + drtg_a) + 224)
    pace = (f.pace_home + f.pace_away) / 2
    exp_total = (pace / 100.0) * ((f.ortg_home + f.ortg_away + f.drtg_home + f.drtg_away) / 2 - 0)
    # simpler: avg of predicted team scores
    home_pts = f.pace_home * (f.ortg_home / 100) * (f.drtg_away / 112)
    away_pts = f.pace_away * (f.ortg_away / 100) * (f.drtg_home / 112)
    exp_total = home_pts + away_pts
    from math import erf, sqrt
    z = (exp_total - f.total_line) / (12.0 * sqrt(2))
    p_over = 0.5 * (1 + erf(z))
    return {"model": "heuristic_pace", "expected_total": round(exp_total, 1),
            "p_over": round(p_over, 4), "p_under": round(1 - p_over, 4)}

@app.post("/predict/soccer_1x2")
def predict_soccer_1x2(f: SoccerFeatures):
    # Poisson-based: lambda_h = xg_h + form_h/2, lambda_a = xg_a + form_a/2
    lam_h = max(0.1, f.home_xg + f.home_form * 0.3 + 0.15)  # home advantage
    lam_a = max(0.1, f.away_xg + f.away_form * 0.3)
    # Score grid up to 6x6
    import math
    max_g = 6
    p_home = p_draw = p_away = 0.0
    for h in range(max_g + 1):
        ph = (math.exp(-lam_h) * lam_h ** h) / math.factorial(h)
        for a in range(max_g + 1):
            pa = (math.exp(-lam_a) * lam_a ** a) / math.factorial(a)
            p = ph * pa
            if h > a: p_home += p
            elif h == a: p_draw += p
            else: p_away += p
    s = p_home + p_draw + p_away
    return {"model": "poisson", "lambda_home": round(lam_h, 3), "lambda_away": round(lam_a, 3),
            "p_home": round(p_home/s, 4), "p_draw": round(p_draw/s, 4), "p_away": round(p_away/s, 4)}

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=int(os.getenv("PORT", 8200)))
