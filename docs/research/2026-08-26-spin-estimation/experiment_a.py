"""Experiment A: is spin class separable from 30 fps observations?

Three tiers:
  ORACLE-BOUNCE : true 3D velocities in/out of both bounces (what a
                  perfect measurement of the bounce could know).
  PRACTICAL     : features from noisy 30 fps pixels + homography + given
                  bounce events (what production could compute today).
  PRACTICAL-NX  : same but no pixel noise / no dropout (isolates the
                  30 fps sampling limit from detection quality).

Targets: topback {top, none, back}, side {L, none, R},
         strength {light, med, heavy} among spun serves.
Classifier: multinomial logistic (scipy L-BFGS) + kNN sanity check.
"""
import json
import numpy as np
from scipy.optimize import minimize
from features import matrix, FEATURE_ORDER

RNG = np.random.default_rng(7)

def softmax_fit(X, y, n_class, l2=1e-2, iters=300):
    n, d = X.shape
    W0 = np.zeros((n_class, d + 1))
    Xb = np.hstack([X, np.ones((n, 1))])
    Y = np.eye(n_class)[y]
    def loss(wf):
        W = wf.reshape(n_class, d + 1)
        Z = Xb @ W.T
        Z -= Z.max(axis=1, keepdims=True)
        P = np.exp(Z); P /= P.sum(axis=1, keepdims=True)
        ll = -np.log(np.clip(P[np.arange(n), y], 1e-12, None)).mean()
        grad = (P - Y).T @ Xb / n + l2 * W
        return ll + 0.5 * l2 * (W * W).sum(), grad.ravel()
    res = minimize(loss, W0.ravel(), jac=True, method="L-BFGS-B",
                   options=dict(maxiter=iters))
    return res.x.reshape(n_class, d + 1)

def softmax_predict(W, X):
    Xb = np.hstack([X, np.ones((X.shape[0], 1))])
    return np.argmax(Xb @ W.T, axis=1)

def knn_predict(Xtr, ytr, Xte, k=15):
    out = np.empty(len(Xte), int)
    for i, x in enumerate(Xte):
        d = np.linalg.norm(Xtr - x, axis=1)
        idx = np.argpartition(d, k)[:k]
        out[i] = np.bincount(ytr[idx]).argmax()
    return out

def prep(X):
    med = np.nanmedian(X, axis=0)
    Xi = np.where(np.isnan(X), med, X)
    mu, sd = Xi.mean(0), Xi.std(0) + 1e-9
    return (Xi - mu) / sd, (med, mu, sd)

def evaluate(X, y, classes, name, splits=5):
    n = len(y)
    idx = RNG.permutation(n)
    accs, accs_knn = [], []
    C = np.zeros((len(classes), len(classes)), int)
    for s in range(splits):
        te = idx[s::splits]
        tr = np.setdiff1d(idx, te)
        Xs, _ = prep(X[tr])
        med, mu, sd = _[0], _[1], _[2]
        Xte = (np.where(np.isnan(X[te]), med, X[te]) - mu) / sd
        W = softmax_fit(Xs, y[tr], len(classes))
        p = softmax_predict(W, Xte)
        accs.append((p == y[te]).mean())
        pk = knn_predict(Xs, y[tr], Xte)
        accs_knn.append((pk == y[te]).mean())
        for a, b in zip(y[te], p):
            C[a, b] += 1
    base = np.bincount(y).max() / n
    print(f"\n--- {name} ---")
    print(f"n={n}  majority-baseline={base:.3f}")
    print(f"logistic acc = {np.mean(accs):.3f} +/- {np.std(accs):.3f}")
    print(f"kNN acc      = {np.mean(accs_knn):.3f}")
    print("confusion (rows=true, cols=pred):")
    header = "        " + "".join(f"{c:>8}" for c in classes)
    print(header)
    for i, c in enumerate(classes):
        row = C[i] / max(C[i].sum(), 1)
        print(f"{c:>8}" + "".join(f"{v:>8.2f}" for v in row))
    return np.mean(accs), C

def oracle_features(recs):
    X = []
    for r in recs:
        b1i = np.array(r["b1"]["v_in"]); b1o = np.array(r["b1"]["v_out"])
        b2i = np.array(r["b2"]["v_in"]); b2o = np.array(r["b2"]["v_out"])
        def hs(v): return np.hypot(v[0], v[1])
        def hd(v): return np.arctan2(v[1], v[0])
        d = +1.0 if (r["b2"]["x"] - r["b1"]["x"]) > 0 else -1.0
        row = [hs(b1i), hs(b1o), hs(b1o)/max(hs(b1i),1e-6),
               b1i[2], b1o[2],
               hs(b2i), hs(b2o), hs(b2o)/max(hs(b2i),1e-6),
               b2i[2], b2o[2],
               d*np.angle(np.exp(1j*(hd(b1o)-hd(b1i)))),
               d*np.angle(np.exp(1j*(hd(b2o)-hd(b2i)))),
               r["b2"]["t"] - r["b1"]["t"],
               np.hypot(r["b2"]["x"]-r["b1"]["x"], r["b2"]["y"]-r["b1"]["y"])]
        X.append(row)
    return np.array(X)

def labels(recs, key):
    vals = [r["labels"][key] for r in recs]
    if key == "topback":
        classes = ["top", "none", "back"]
    elif key == "side":
        classes = ["L", "none", "R"]
    else:
        classes = ["light", "med", "heavy"]
    m = {c: i for i, c in enumerate(classes)}
    keep = [i for i, v in enumerate(vals) if v in m]
    y = np.array([m[vals[i]] for i in keep])
    return keep, y, classes

def run(recs, tag, Xpr=None):
    print(f"\n================ {tag} ================")
    Xor = oracle_features(recs)
    if Xpr is None:
        Xpr, _ = matrix(recs)
    for key in ["topback", "side"]:
        keep, y, classes = labels(recs, key)
        evaluate(Xor[keep], y, classes, f"{key} / ORACLE-BOUNCE")
        evaluate(Xpr[keep], y, classes, f"{key} / PRACTICAL-30FPS")
    # strength among serves that have spin, given known topback direction
    keep, y, classes = labels(recs, "strength")
    spin_only = [i for i in keep if recs[i]["labels"]["strength"] != "none"]
    m = {c: i for i, c in enumerate(["light", "med", "heavy"])}
    y2 = np.array([m[recs[i]["labels"]["strength"]] for i in spin_only])
    evaluate(Xor[spin_only], y2, ["light", "med", "heavy"],
             "strength / ORACLE-BOUNCE")
    evaluate(Xpr[spin_only], y2, ["light", "med", "heavy"],
             "strength / PRACTICAL-30FPS")
    return Xpr

if __name__ == "__main__":
    import sys
    path = sys.argv[1] if len(sys.argv) > 1 else "out/serves.json"
    recs = json.load(open(path))
    print(f"loaded {len(recs)} serves")
    run(recs, "MAIN (2px noise, 15% dropout)")
