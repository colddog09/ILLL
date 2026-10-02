"""공통 LSTM 모델 학습 (Mental Attention 데이터셋)
사용: python pretrain_common.py <mat 폴더> [AF3,AF4] [--test]
  기본           : 34세션 전체 14채널로 학습해 focus_lstm_epoc_x.pt 저장
  AF3,AF4 지정   : 이마 쪽 두 채널만으로 학습해 FX2용 focus_lstm_fx2.pt 저장
  --test         : 마지막 6세션을 빼고 학습해 하락 탐지와 파인튜닝을 점검
"""
import os as _os, sys as _sys
_sys.path.insert(0, _os.path.dirname(_os.path.dirname(_os.path.abspath(__file__))))

import glob, os, sys
import numpy as np
from sklearn.metrics import f1_score
from eval_attention import load, FS
from lstm_detector import raw_features, pretrain, Detector, seqs, THRESH
from focus import STEP_S

PM = int(60 / STEP_S); CAL = slice(1 * PM, 4 * PM); T0, T1, DROP = 4, 30, 10


def session(path, ch):
    # ch가 AF3,AF4면 FX2(이마 2채널) 대용 모델로 학습
    dev, names = ("fx2", ["Fp1", "Fp2"]) if ch == ["AF3", "AF4"] else ("epoc_x", None)
    X = raw_features(load(path, ch), FS, dev, names)
    t = np.arange(len(X)) / PM
    return X, (t >= DROP).astype(np.float32), t


if __name__ == "__main__":
    root = sys.argv[1]
    ch = next((a.split(",") for a in sys.argv[2:] if not a.startswith("--")), None)
    files = sorted(glob.glob(os.path.join(root, "*.mat")), key=lambda p: int("".join(filter(str.isdigit, os.path.basename(p)))))
    S = [session(f, ch) for f in files]
    trial = lambda X, t: (t >= T0) & (t < T1)
    if "--test" not in sys.argv:
        det = pretrain([(X[trial(X, t)], y[trial(X, t)], CAL) if False else (X, y, CAL) for X, y, t in S])
        out = "focus_lstm_fx2.pt" if ch == ["AF3", "AF4"] else "focus_lstm_epoc_x.pt"
        det.save(out); print("저장:", out); sys.exit()
    train, test = S[:-6], S[-6:]
    det = pretrain([(X, y, CAL) for X, y, t in train])
    print("빼둔 6세션 하락 탐지 (정답 10분):")
    for X, y, t in test:
        det.calibrate(X[CAL]); m = trial(X, t)
        on, p = det.detect(X[m]); on2, _ = det.detect(X[m], method="run")
        fmt = lambda o: '없음' if o is None else f'{T0 + o / 60:5.1f}분'
        print(f"  탐지(step) {fmt(on)} | 탐지(run) {fmt(on2)} | 창별 F1 "
              f"{f1_score(y[m], (p >= THRESH).astype(int), average='macro'):.2f}")
    # 파인튜닝 점검: 빼둔 세션 중 5개로 파인튜닝(마지막은 검증), 1개로 평가
    labeled = []
    for X, y, t in test[:5]:
        det.calibrate(X[CAL]); m = trial(X, t); labeled.append((X[m], y[m]))
    X, y, t = test[5]; det.calibrate(X[CAL]); m = trial(X, t)
    before = f1_score(y[m], (det.proba(X[m]) >= THRESH).astype(int), average="macro")
    ok, f_old, f_new = det.finetune(labeled)
    det.calibrate(X[CAL]); after = f1_score(y[m], (det.proba(X[m]) >= THRESH).astype(int), average="macro")
    print(f"파인튜닝: 검증 F1 {f_old:.2f} -> {f_new:.2f}, 채택 {ok} | 평가 세션 F1 {before:.2f} -> {after:.2f}")
