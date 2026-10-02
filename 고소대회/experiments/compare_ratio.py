"""EI vs β/α 비교 (LSTM + 역치 확인 조합, 교차검증). 사용: python compare_ratio.py <mat 폴더> [AF3,AF4]"""
import glob, sys, numpy as np
sys.path.insert(0, __import__("os").path.dirname(__import__("os").path.dirname(__import__("os").path.abspath(__file__))))
from sklearn.model_selection import KFold
from eval_attention import load, CH
from focus import preprocess, baseline, confirm_below, detect_onset, STEP_S
from scipy.signal import welch
import lstm_detector as L
FS, W, PM, CAL = 128, 256, 30, slice(30, 120)
def bands(x):
    n = x.shape[1] // W
    f, p = welch(x[:, :n * W].reshape(x.shape[0], n, W), fs=FS, nperseg=W, axis=-1)
    df = f[1] - f[0]
    return np.stack([p[..., (f >= lo) & (f < hi)].sum(-1) * df for lo, hi in ((4, 8), (8, 13), (13, 22))], -1).mean(0)  # (창, 3)
files = sorted(glob.glob(__import__("os").path.join(sys.argv[1], "*.mat")), key=lambda p: int("".join(filter(str.isdigit, p.split("/")[-1]))))
chs = None if len(sys.argv) < 3 else sys.argv[2].split(",")
S = []
for f in files:
    x = preprocess(load(f, chs), FS); bp = bands(x); lb = np.log(bp + 1e-12)
    ei = lb[:, 2] - np.log(bp[:, 0] + bp[:, 1]); ba = lb[:, 2] - lb[:, 1]
    t = np.arange(len(bp)) / PM
    S.append(dict(X_ei=np.c_[lb, ei].astype(np.float32), X_ba=np.c_[lb, ba].astype(np.float32), y=(t >= 10).astype(np.float32),
                  ci={k: (v - baseline(v[CAL])[0]) / baseline(v[CAL])[1] for k, v in (("ei", ei), ("ba", ba))},
                  sd={k: baseline(v[CAL])[1] for k, v in (("ei", ei), ("ba", ba))}))
R = {}
for tr, te in KFold(5, shuffle=True, random_state=0).split(S):
    for key in ("ei", "ba"):
        det = L.pretrain([(S[i]["X_" + key], S[i]["y"], CAL) for i in tr])
        for i in te:
            s = S[i]; X = s["X_" + key]; ci = s["ci"][key]; det.calibrate(X[CAL])
            on, _ = det.detect(X[120:900]); on_f, _ = det.detect(X[120:300])
            for r in (0.2, 0.3, 0.4):
                k = np.log(1 - r) / s["sd"][key]
                ok = on is not None and confirm_below(ci[120:900], int(on / STEP_S), k=k)[0]
                okf = on_f is not None and confirm_below(ci[120:300], int(on_f / STEP_S), k=k)[0]
                d = R.setdefault((key, r), [[], 0]); d[0].append(4 + on / 60 if ok else None); d[1] += int(okf)
print("채널:", chs or "14개")
for (key, r), (hits, fa) in sorted(R.items()):
    h = np.array([x for x in hits if x is not None]); e10 = np.abs(h - 10) <= 3 if len(h) else np.zeros(1); e20 = np.abs(h - 20) <= 3 if len(h) else np.zeros(1)
    print(f"{'EI ' if key=='ei' else 'β/α'} 비율 r={r:.0%}: 탐지 {len(h):2d}/34, 10분 ±3 {e10.mean():.0%}, 20분 ±3 {e20.mean():.0%}, 둘 중 하나 {np.mean(e10|e20):.0%}, 집중만 헛탐지 {fa}/34")
