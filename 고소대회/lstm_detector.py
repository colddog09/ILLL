"""LSTM 기반 집중 저하 탐지

입력: 2초 창마다 [ln theta, ln alpha, ln beta, ln(beta/alpha)]를 개인 보정값으로 표준화한 것, 최근 30개(60초)
기기별로 모델을 따로 둔다 (EPOC X 14채널 / FX2 이마 2채널)
출력: 창마다 저하 확률. 0.5 이상이 20초 이상 이어진 첫 구간의 시작을 하락 시점 n으로 본다.

1) 공통 모델: 공개 데이터(Mental Attention, 집중 0 / 비집중, 졸림 1)로 미리 학습  -> pretrain()
2) 개인 파인튜닝: 공부 후 설문 4, 5번으로 만든 라벨로 분류층만 낮은 학습률로 재학습,
   검증 세션에서 macro-F1이 좋아질 때만 새 모델 채택                          -> Detector.finetune()
"""
import copy
import numpy as np
import torch, torch.nn as nn
from sklearn.metrics import f1_score

from focus import STEP_S

SEQ, HOLD_S, THRESH = 30, 20.0, 0.5
DRIFT_START = {"초반": 0.0, "중반": 1 / 3, "후반": 2 / 3}


def raw_features(eeg, fs, device="epoc_x", channel_names=None):
    from features import extract
    return extract(eeg, fs, device, channel_names)["X"]


def seqs(X, n=SEQ):
    pad = np.vstack([np.repeat(X[:1], n - 1, 0), X])
    return np.stack([pad[i:i + n] for i in range(len(X))]).astype(np.float32)


class Net(nn.Module):
    def __init__(self, f=4, h=32):
        super().__init__()
        self.lstm = nn.LSTM(f, h, batch_first=True)
        self.head = nn.Linear(h, 1)

    def forward(self, x):
        return self.head(self.lstm(x)[0][:, -1]).squeeze(-1)


def _train(net, X, y, epochs, lr, params=None, seed=0):
    torch.manual_seed(seed)
    opt = torch.optim.Adam(params or net.parameters(), lr)
    pw = torch.tensor((len(y) - y.sum()) / max(y.sum(), 1), dtype=torch.float32)
    lf = nn.BCEWithLogitsLoss(pos_weight=pw)
    Xt, yt = torch.tensor(X), torch.tensor(y, dtype=torch.float32)
    net.train()
    for _ in range(epochs):
        for i in torch.randperm(len(Xt)).split(256):
            opt.zero_grad(); lf(net(Xt[i]), yt[i]).backward(); opt.step()
    net.eval()
    return net


class Detector:
    def __init__(self, net=None):
        self.net = net or Net()
        self.mu = self.sd = None
        self.version, self.history = "common", []

    # ---- 저장
    def save(self, path):
        torch.save(dict(state=self.net.state_dict(), mu=self.mu, sd=self.sd, version=self.version,
                        history=self.history), path)

    @classmethod
    def load(cls, path):
        c = torch.load(path, weights_only=False)
        d = cls(); d.net.load_state_dict(c["state"]); d.net.eval()
        d.mu, d.sd, d.version, d.history = c["mu"], c["sd"], c["version"], c["history"]
        return d

    # ---- 사용
    def calibrate(self, X_calib):
        """초기 보정(집중 과제) 구간 특징으로 개인 표준화 값 설정"""
        self.mu, self.sd = X_calib.mean(0), X_calib.std(0) + 1e-8

    def norm(self, X):
        return (X - self.mu) / self.sd

    @torch.no_grad()
    def proba(self, X):
        return torch.sigmoid(self.net(torch.tensor(seqs(self.norm(X))))).numpy()

    def detect(self, X, step_s=STEP_S, hold_s=HOLD_S, thresh=THRESH, method="step", min_gap=0.2):
        """하락 시점(초) 또는 None, 창별 저하 확률
        method="step": 확률 곡선을 '낮은 구간 -> 높은 구간' 두 덩어리로 나누는 지점을 찾는다(기본).
                       뒤 구간 평균 >= thresh, 앞뒤 차이 >= min_gap일 때만 인정. 초반 60초는 제외.
        method="run" : 확률 >= thresh가 hold_s초 이상 이어진 첫 구간의 시작."""
        p = self.proba(X)
        if method == "step":
            q, m = p[SEQ:], SEQ                                  # 앞 60초는 기록이 덜 쌓여 제외
            if len(q) < 2 * SEQ:
                return None, p
            c = np.concatenate([[0], np.cumsum(q)]); n = len(q)
            best = None
            for j in range(SEQ, n - SEQ):                        # 양쪽 최소 60초
                a, b = c[j] / j, (c[n] - c[j]) / (n - j)
                score = j * (n - j) * (b - a) ** 2               # 두 덩어리 평균 차이가 클수록
                if b > a and (best is None or score > best[0]):
                    best = (score, j, a, b)
            if best and best[3] >= thresh and best[3] - best[2] >= min_gap:
                return (best[1] + m) * step_s, p
            return None, p
        pad = np.pad(p, 2, mode="edge")
        ps = np.array([np.median(pad[i:i + 5]) for i in range(len(p))])     # 순간 튐 완화
        need, run = int(np.ceil(hold_s / step_s)), 0
        for i, v in enumerate(ps):
            run = run + 1 if v >= thresh else 0
            if run >= need:
                return (i - need + 1) * step_s, p
        return None, p

    # ---- 개인 파인튜닝
    @staticmethod
    def survey_labels(n, focus_self, drift_when):
        """공부 후 설문으로 창별 라벨. 4번이 4~5면 전부 집중(0), 5번 시점 이후는 저하(1), 모르겠음이면 None"""
        if focus_self is not None and focus_self >= 4:
            return np.zeros(n, np.float32)
        if drift_when in DRIFT_START:
            y = np.zeros(n, np.float32); y[int(DRIFT_START[drift_when] * n):] = 1
            return y
        return None

    def finetune(self, labeled, min_sessions=5, epochs=5, lr=1e-4, min_gain=0.02):
        """labeled: [(X_raw, y)] 세션 목록. 마지막 세션을 검증용으로 두고, 분류층만 학습.
        검증 macro-F1이 min_gain 이상 좋아질 때만 채택한다(우연한 미세 개선으로 모델이 바뀌지 않게). 반환: (채택 여부, 이전 F1, 새 F1)"""
        if len(labeled) < min_sessions:
            return False, None, None
        tr, (Xv, yv) = labeled[:-1], labeled[-1]
        f1 = lambda net: f1_score(yv, (torch.sigmoid(net(torch.tensor(seqs(self.norm(Xv))))).detach().numpy() >= THRESH)
                                  .astype(int), average="macro", zero_division=0)
        old = f1(self.net)
        cand = copy.deepcopy(self.net)
        X = np.vstack([seqs(self.norm(x)) for x, _ in tr]); y = np.concatenate([y for _, y in tr])
        _train(cand, X, y, epochs, lr, params=cand.head.parameters())
        new = f1(cand)
        ok = new >= old + min_gain
        self.history.append(dict(sessions=len(labeled), f1_old=round(float(old), 3), f1_new=round(float(new), 3),
                                 promoted=bool(ok)))
        if ok:
            self.net, self.version = cand, f"personal-{len(self.history)}"
        return ok, old, new


def pretrain(sessions, epochs=8, lr=1e-3):
    """sessions: [(X_raw, y, calib_idx)]. 세션마다 자기 보정 구간으로 표준화해 공통 모델 학습"""
    Xs, ys = [], []
    for X, y, cal in sessions:
        mu, sd = X[cal].mean(0), X[cal].std(0) + 1e-8
        Xs.append(seqs((X - mu) / sd)); ys.append(y)
    return Detector(_train(Net(), np.vstack(Xs), np.concatenate(ys).astype(np.float32), epochs, lr))
