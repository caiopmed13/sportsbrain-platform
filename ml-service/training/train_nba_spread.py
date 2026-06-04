"""
Treina modelo XGBoost para spread cover NBA.
Input: CSV com colunas [home_power, away_power, home_rest_days, away_rest_days,
                         home_b2b, away_b2b, injuries_home, injuries_away, line, covered]
Output: models/nba_spread.joblib
"""
import sys, joblib
from pathlib import Path
import pandas as pd
from xgboost import XGBClassifier
from sklearn.model_selection import train_test_split
from sklearn.metrics import log_loss, roc_auc_score

def main(csv_path: str):
    df = pd.read_csv(csv_path)
    y = df["covered"].astype(int)
    X = df.drop(columns=["covered"]).select_dtypes(include=["number"])
    Xtr, Xte, ytr, yte = train_test_split(X, y, test_size=0.2, random_state=42, stratify=y)
    model = XGBClassifier(
        n_estimators=600, max_depth=5, learning_rate=0.03,
        subsample=0.85, colsample_bytree=0.85, eval_metric="logloss",
        early_stopping_rounds=40,
    )
    model.fit(Xtr, ytr, eval_set=[(Xte, yte)], verbose=False)
    p = model.predict_proba(Xte)[:, 1]
    print(f"logloss={log_loss(yte, p):.4f}  auc={roc_auc_score(yte, p):.4f}")
    out = Path(__file__).parent.parent / "models" / "nba_spread.joblib"
    out.parent.mkdir(exist_ok=True)
    joblib.dump(model, out)
    print(f"saved → {out}")

if __name__ == "__main__":
    main(sys.argv[1] if len(sys.argv) > 1 else "nba_spread_history.csv")
