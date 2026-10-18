"""Обучение демонстрационной модели на наборе UCI Energy Efficiency.

Запуск:  python3 model/train.py путь/к/ENB2012_data.xlsx
Результат: model.json (деревья градиентного бустинга для браузера),
           data/energy_efficiency.csv (исходные данные в удобном виде).
"""
import json
import sys
from pathlib import Path

import numpy as np
import pandas as pd
from sklearn.ensemble import GradientBoostingRegressor
from sklearn.inspection import permutation_importance
from sklearn.linear_model import LinearRegression
from sklearn.metrics import mean_absolute_error, r2_score
from sklearn.model_selection import train_test_split
from sklearn.neighbors import KNeighborsRegressor
from sklearn.pipeline import make_pipeline
from sklearn.preprocessing import StandardScaler

ROOT = Path(__file__).resolve().parent.parent
FEATURES = [
    ("X1", "compactness", "Относительная компактность"),
    ("X2", "surface", "Площадь поверхности, м²"),
    ("X3", "wall", "Площадь стен, м²"),
    ("X4", "roof", "Площадь кровли, м²"),
    ("X5", "height", "Высота, м"),
    ("X6", "orientation", "Ориентация"),
    ("X7", "glazing", "Доля остекления"),
    ("X8", "glazing_dist", "Распределение остекления"),
]
TARGETS = [("Y1", "heating", "Нагрузка на отопление"), ("Y2", "cooling", "Нагрузка на охлаждение")]


def export_tree(tree, digits=5):
    t = tree.tree_
    return {
        "f": t.feature.tolist(),
        "t": [round(float(x), digits) for x in t.threshold],
        "l": t.children_left.tolist(),
        "r": t.children_right.tolist(),
        "v": [round(float(x), digits) for x in t.value[:, 0, 0]],
    }


def main(xlsx):
    df = pd.read_excel(xlsx).iloc[:, :10]
    df.columns = [f[0] for f in FEATURES] + [t[0] for t in TARGETS]
    df = df.dropna()
    (ROOT / "data").mkdir(exist_ok=True)
    df.rename(columns={**{f[0]: f[1] for f in FEATURES}, **{t[0]: t[1] for t in TARGETS}}).to_csv(ROOT / "data" / "energy_efficiency.csv", index=False)

    X = df[[f[0] for f in FEATURES]].values
    out = {
        "dataset": {"name": "UCI Energy Efficiency (Tsanas, Xifara, 2012)", "rows": int(len(df))},
        "features": [{"key": k, "name": n} for _, k, n in FEATURES],
        "shapes": [],
        "targets": {},
    }
    # 12 типовых форм здания: уникальные сочетания X1–X5
    shapes = df[["X1", "X2", "X3", "X4", "X5"]].drop_duplicates().sort_values("X1", ascending=False)
    out["shapes"] = [[round(float(v), 4) for v in row] for row in shapes.values]
    out["ranges"] = {f[1]: [float(df[f[0]].min()), float(df[f[0]].max())] for f in FEATURES}

    for col, key, name in TARGETS:
        y = df[col].values
        Xtr, Xte, ytr, yte = train_test_split(X, y, test_size=0.2, random_state=42)
        gbr = GradientBoostingRegressor(n_estimators=400, max_depth=4, learning_rate=0.05, subsample=0.9, random_state=42)
        gbr.fit(Xtr, ytr)
        pred = gbr.predict(Xte)
        lin = LinearRegression().fit(Xtr, ytr)
        knn = make_pipeline(StandardScaler(), KNeighborsRegressor(n_neighbors=5)).fit(Xtr, ytr)
        imp = permutation_importance(gbr, Xte, yte, n_repeats=20, random_state=0)
        share = np.clip(imp.importances_mean, 0, None)
        share = share / share.sum()
        out["targets"][key] = {
            "name": name,
            "unit": "кВт·ч/м²",
            "range": [float(y.min()), float(y.max())],
            "init": round(float(gbr.init_.constant_[0][0]), 6),
            "lr": gbr.learning_rate,
            "trees": [export_tree(e[0]) for e in gbr.estimators_],
            "metrics": {
                "boosting": {"mae": round(mean_absolute_error(yte, pred), 3), "r2": round(r2_score(yte, pred), 4)},
                "linear": {"mae": round(mean_absolute_error(yte, lin.predict(Xte)), 3), "r2": round(r2_score(yte, lin.predict(Xte)), 4)},
                "knn": {"mae": round(mean_absolute_error(yte, knn.predict(Xte)), 3), "r2": round(r2_score(yte, knn.predict(Xte)), 4)},
            },
            "importance": {FEATURES[i][1]: round(float(share[i]), 4) for i in range(len(FEATURES))},
            "test": {"true": [round(float(v), 2) for v in yte], "pred": [round(float(v), 2) for v in pred]},
        }
        m = out["targets"][key]["metrics"]
        print(f"{name}: бустинг MAE={m['boosting']['mae']} R²={m['boosting']['r2']} | линейная MAE={m['linear']['mae']} | kNN MAE={m['knn']['mae']}")

    (ROOT / "model.json").write_text(json.dumps(out, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    print("model.json:", (ROOT / "model.json").stat().st_size // 1024, "КБ")


if __name__ == "__main__":
    main(sys.argv[1])
