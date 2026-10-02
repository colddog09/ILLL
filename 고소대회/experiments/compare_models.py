"""계획서 7-2-1 성능 비교: 고정 CI 임계값 / RF / SVM / LSTM / 변화점 방식
데이터: Mental Attention State (EMOTIV 14채널 128Hz, 34세션)
과제: 2초 창마다 집중(0~10분) vs 저하(10~30분: 비집중 + 졸림) 구분, 보정 구간 0~4분은 제외
분할: 세션(파일) 단위 5겹 교차검증. 파일과 참가자의 대응을 확인하지 못해 참가자 단위 분할은 하지 않았다.
사용: python compare_models.py <mat 폴더> [채널 예: AF3,AF4]
"""
import os as _os, sys as _sys
_sys.path.insert(0, _os.path.dirname(_os.path.dirname(_os.path.abspath(__file__))))

import glob, os, sys
import numpy as np
import torch, torch.nn as nn
from sklearn.ensemble import RandomForestClassifier
from sklearn.svm import SVC
from sklearn.preprocessing import StandardScaler
from sklearn.model_selection import GroupKFold
from sklearn.metrics import accuracy_score, f1_score, recall_score

from focus import preprocess, band_powers, detect_onset, STEP_S
from eval_attention import load, FS

PER_MIN = int(60 / STEP_S)
CAL = (1, 4)          # 개인 기준 구간(분)
START, END = 4, 30    # 평가 구간(분)
K = -1.0
SEQ = 30              # LSTM 60초


def session_features(path, ch):
    bp = band_powers(preprocess(load(path, ch), FS), FS)
    lb = np.log(bp + 1e-12)                                     # log theta, alpha, beta
    E = lb[:, 2] - np.log(bp[:, 0] + bp[:, 1] + 1e-12)          # ln EI
    X = np.c_[lb, E]
    c = X[CAL[0] * PER_MIN:CAL[1] * PER_MIN]
    Xz = (X - c.mean(0)) / (c.std(0) + 1e-8)                    # 세션 보정 구간 기준 표준화
    t = np.arange(len(X)) / PER_MIN
    keep = (t >= START) & (t < END)
    state = np.where(t < 10, 0, np.where(t < 20, 1, 2))         # 0 집중, 1 비집중, 2 졸림
    return Xz[keep], state[keep], t[keep]


def seqs(X, n=SEQ):
    pad = np.vstack([np.repeat(X[:1], n - 1, 0), X])
    return np.stack([pad[i:i + n] for i in range(len(X))]).astype(np.float32)


class LSTM(nn.Module):
    def __init__(self, f, h=32):
        super().__init__(); self.l = nn.LSTM(f, h, batch_first=True); self.o = nn.Linear(h, 1)
    def forward(self, x):
        return self.o(self.l(x)[0][:, -1]).squeeze(-1)


def train_lstm(X, y, epochs=8, seed=0):
    torch.manual_seed(seed)
    m = LSTM(X.shape[-1]); opt = torch.optim.Adam(m.parameters(), 1e-3)
    pw = torch.tensor((len(y) - y.sum()) / max(y.sum(), 1), dtype=torch.float32)
    lf = nn.BCEWithLogitsLoss(pos_weight=pw)
    Xt, yt = torch.tensor(X), torch.tensor(y, dtype=torch.float32)
    for _ in range(epochs):
        for i in torch.randperm(len(Xt)).split(256):
            opt.zero_grad(); lf(m(Xt[i]), yt[i]).backward(); opt.step()
    m.eval()
    return lambda Z: (torch.sigmoid(m(torch.tensor(Z))) > 0.5).int().numpy()


def metrics(y_state, pred, t):
    y = (y_state > 0).astype(int)
    first = np.where((t >= 10) & (np.convolve(pred, np.ones(10), 'same') >= 10))[0]  # 20초 연속 저하 예측
    return dict(acc=accuracy_score(y, pred), f1=f1_score(y, pred, average="macro"),
                rec=recall_score(y, pred, zero_division=0),
                rec_unf=pred[y_state == 1].mean(), rec_drw=pred[y_state == 2].mean(),
                fa=pred[y_state == 0].mean(),
                delay=(t[first[0]] - 10) if len(first) else np.nan)


if __name__ == "__main__":
    root = sys.argv[1]; ch = sys.argv[2].split(",") if len(sys.argv) > 2 else None
    files = sorted(glob.glob(os.path.join(root, "*.mat")))
    S = [session_features(f, ch) for f in files]
    res = {m: [] for m in ["CI 임계값", "변화점", "RF", "SVM", "LSTM"]}
    for tr, te in GroupKFold(5).split(files, groups=np.arange(len(files))):
        Xtr = np.vstack([S[i][0] for i in tr]); ytr = np.concatenate([(S[i][1] > 0) for i in tr]).astype(int)
        sc = StandardScaler().fit(Xtr)
        rf = RandomForestClassifier(200, max_depth=8, class_weight="balanced", n_jobs=-1, random_state=0).fit(sc.transform(Xtr), ytr)
        sub = np.random.default_rng(0).choice(len(Xtr), min(6000, len(Xtr)), replace=False)
        svm = SVC(C=1.0, class_weight="balanced").fit(sc.transform(Xtr)[sub], ytr[sub])
        lstm = train_lstm(np.vstack([seqs(sc.transform(S[i][0])) for i in tr]), ytr.astype(np.float32))
        for i in te:
            X, st, t = S[i]; Xs = sc.transform(X); ci = X[:, 3]
            on, _ = detect_onset(ci, k=K)
            cp = (t >= START + on / 60).astype(int) if on is not None else np.zeros(len(t), int)
            for name, p in [("CI 임계값", (ci < K).astype(int)), ("변화점", cp), ("RF", rf.predict(Xs)),
                            ("SVM", svm.predict(Xs)), ("LSTM", lstm(seqs(Xs)))]:
                res[name].append(metrics(st, p, t))
    print(f"세션 {len(files)}개, 채널 {'14개' if ch is None else ch}, k={K}")
    print(f"{'모델':<8}{'정확도':>7}{'macro-F1':>10}{'저하 재현율':>10}{'비집중 재현':>10}{'졸림 재현':>9}{'오경보율':>8}{'탐지지연(분)':>11}")
    for name, rs in res.items():
        m = {k: np.nanmean([r[k] for r in rs]) for k in rs[0]}
        dl = np.nanmedian([r["delay"] for r in rs])
        print(f"{name:<8}{m['acc']:>8.2f}{m['f1']:>10.2f}{m['rec']:>11.2f}{m['rec_unf']:>11.2f}{m['rec_drw']:>10.2f}{m['fa']:>9.2f}{dl:>11.1f}")
