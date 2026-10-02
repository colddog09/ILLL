"""FocusWave 집중도 산출 + 하락 시작 시점(변화점) 탐지
EI = beta / (alpha + theta), E = log(EI), CI = (E - mu) / sigma
대역: theta 4-8, alpha 8-13, beta 13-22 Hz (Pope 등 1995, Coelli 등 2015 인용 기준)
"""
import numpy as np
from scipy.signal import butter, sosfiltfilt, welch

BANDS = {"theta": (4.0, 8.0), "alpha": (8.0, 13.0), "beta": (13.0, 22.0)}
WIN_S, STEP_S = 2.0, 2.0


# ---------------------------------------------------------------- 1. 집중도
def preprocess(x, fs, lo=1.0, hi=45.0):
    sos = butter(4, [lo, min(hi, 0.45 * fs)], btype="bandpass", fs=fs, output="sos")
    return sosfiltfilt(sos, x, axis=-1)


def band_powers(x, fs, win_s=WIN_S, step_s=STEP_S):
    """x: (채널, 샘플) 필터된 신호 -> (창 수, 3) [theta, alpha, beta], 채널 평균"""
    w, s = int(win_s * fs), int(step_s * fs)
    n = (x.shape[-1] - w) // s + 1
    out = np.empty((max(n, 0), 3))
    for i in range(n):
        f, p = welch(x[:, i * s:i * s + w], fs=fs, nperseg=w, axis=-1)
        p = p.mean(0)
        df = f[1] - f[0]
        out[i] = [p[(f >= lo) & (f < hi)].sum() * df for lo, hi in BANDS.values()]
    return out


def log_ei(bp):
    th, al, be = bp[:, 0], bp[:, 1], bp[:, 2]
    return np.log(be / (al + th + 1e-12) + 1e-12)


def baseline(E, drop_mask=None, bad_mask=None):
    """평소 값 mu, 출렁임 폭 sigma. 저하 구간과 품질 불량 구간은 제외하고,
    이상치에 덜 흔들리도록 중앙값과 MAD(중앙값 절대편차 x 1.4826)를 쓴다."""
    keep = np.ones(len(E), bool)
    if drop_mask is not None:
        keep &= ~drop_mask
    if bad_mask is not None:
        keep &= ~bad_mask
    e = np.asarray(E)[keep]
    if len(e) == 0:
        e = np.asarray(E)
    med = float(np.median(e))
    return med, float(1.4826 * np.median(np.abs(e - med)) + 1e-8)


def focus_index(E, mu, sigma):
    return (E - mu) / sigma


# ---------------------------------------------------------------- 2. 변화점
def _hinge(y, t, min_seg, flat_before=False):
    """꺾인 직선 y = a + b*t + c*max(0, t - tau) 중 오차가 가장 작은 tau.
    flat_before=True면 하락 전 기울기 b를 0으로 고정한다 (평소 유지 -> 하락 모양)."""
    X1 = np.c_[np.ones_like(t)] if flat_before else np.c_[np.ones_like(t), t]
    sse1 = np.sum((y - X1 @ np.linalg.lstsq(X1, y, rcond=None)[0]) ** 2)
    best = None
    for j in range(min_seg, len(y) - min_seg):
        X = np.c_[X1, np.maximum(0, t - t[j])]
        coef = np.linalg.lstsq(X, y, rcond=None)[0]
        sse = np.sum((y - X @ coef) ** 2)
        if best is None or sse < best[0]:
            best = (sse, j, coef)
    if best is None:
        return None
    sse, j, coef = best
    a, c = coef[0], coef[-1]
    b = 0.0 if flat_before else coef[1]
    return j, b, c, 1 - sse / (sse1 + 1e-12)


def _first_sustained_below(y, k, need, smooth=5):
    """이동 중앙값으로 순간 튐을 줄인 뒤, k 아래로 need개 연속인 첫 구간의 시작 인덱스"""
    pad = smooth // 2
    yp = np.pad(y, pad, mode="edge")
    ys = np.array([np.median(yp[i:i + smooth]) for i in range(len(y))])
    run = 0
    for i, v in enumerate(ys):
        run = run + 1 if v < k else 0
        if run >= need:
            return i - need + 1
    return None


def _first_below_relative(y, delta, need, smooth=5, min_base=30):
    """하락 전 평균 기준 역치: 시점 i까지의 평균(하락 전 값들의 평균)에서 delta를 뺀 값을 역치로 두고,
    이동 중앙값이 그 아래로 need개 연속인 첫 구간의 시작과 그때의 역치를 돌려준다.
    처음 min_base개(60초)는 평균을 잡는 구간이라 판정하지 않는다."""
    pad = smooth // 2
    yp = np.pad(y, pad, mode="edge")
    ys = np.array([np.median(yp[i:i + smooth]) for i in range(len(y))])
    csum = np.concatenate([[0], np.cumsum(y)])
    start = None
    for i in range(min_base, len(y)):
        base_i = csum[i] / i
        if start is None:
            if ys[i] < base_i - delta:
                start = i
        elif ys[i] >= csum[start] / start - delta:          # 구간 시작 시점의 하락 전 평균으로 판단
            start = i if ys[i] < base_i - delta else None
        if start is not None and i - start + 1 >= need:
            return start, csum[start] / start - delta
    return None, None


def detect_onset(ci, step_s=STEP_S, min_seg=10, min_gain=0.05, k=None, hold_s=20.0, rel_delta=None):
    """하락 시작 시점 n(초)을 찾는다.
    k가 없으면: 곡선 전체에 꺾인 직선을 맞춘다.
    k가 있으면: CI가 k 아래로 hold_s초 이상 처음 머문 구간을 찾고(없으면 하락 없음),
               곡선 시작부터 그 구간까지만 잘라 꺾인 직선을 맞춘다.
               하락 뒤 낮은 상태로 머무는 구간이 맞춤을 흐리지 않게 하기 위함이다.
    인정 조건: 꺾인 뒤 기울기(b + c) < 0, c < 0 (k가 없을 때는 오차 감소율 >= min_gain도 필요).
    반환: 하락 시작 시각(초) 또는 None, 세부 정보 dict"""
    y = np.asarray(ci, float)
    end = len(y)
    info = {}
    if rel_delta is not None:                               # 하락 전 평균 - rel_delta 를 역치로
        need = int(np.ceil(hold_s / step_s))
        j_k, thr = _first_below_relative(y, rel_delta, need)
        if j_k is None:
            return None, {"reason": "하락 전 평균보다 충분히 낮아진 구간 없음"}
        info["threshold"] = thr
        k = thr                                             # 아래 판정과 맞춤에 같은 흐름을 쓰기 위함
        end = min(len(y), j_k + need)
        info["below_k_start_s"] = j_k * step_s
    elif k is not None:
        need = int(np.ceil(hold_s / step_s))
        j_k = _first_sustained_below(y, k, need)
        if j_k is None:
            return None, {"reason": "k 아래로 충분히 머문 구간 없음"}
        end = min(len(y), j_k + need)
        info["below_k_start_s"] = j_k * step_s
    t = np.arange(end) * step_s
    fit = _hinge(y[:end], t, min(min_seg, max(2, end // 3)), flat_before=k is not None)
    if fit is None:
        return None, {**info, "reason": "구간이 너무 짧음"}
    j, b, c, gain = fit
    info.update(tau_s=t[j], slope_before=b, slope_after=b + c, gain=gain)
    # k 조건을 통과했다면 실제 하락은 이미 확인된 것이므로 오차 감소율 조건은 k가 없을 때만 쓴다.
    # (평평한 구간이 길고 하락이 짧으면 오차 감소율이 작게 나와 실제 하락을 놓치기 때문)
    ok = c < 0 and (b + c) < 0 and (k is not None or gain >= min_gain)
    return (t[j] if ok else None), info


# ---------------------------------------------------------------- 3. EEGMAT 로더
def load_csv(path, channels=None, fs=500.0):
    """EEGMAT CSV (EDF 변환본) -> (채널, 샘플), fs. A2-A1, ECG 열은 제외한다."""
    import pandas as pd
    df = pd.read_csv(path)
    cols = [c for c in df.columns if "ECG" not in c and "A2" not in c]
    if channels:
        cols = [c for c in cols if c.replace("EEG ", "") in channels]
    return df[cols].to_numpy().T, fs, cols


def load(path, channels=None):
    return load_csv(path, channels) if path.endswith(".csv") else load_edf(path, channels)


def load_edf(path, channels=None):
    """EDF -> (채널, 샘플), fs. channels 예: ['Fp1', 'Fp2'] (2채널 흉내)"""
    import mne
    raw = mne.io.read_raw_edf(path, preload=True, verbose="error")
    names = raw.ch_names
    if channels:
        pick = [n for n in names if any(n.replace("EEG ", "").split("-")[0] == c for c in channels)]
    else:
        pick = [n for n in names if "ECG" not in n.upper() and "EKG" not in n.upper()]
    return raw.get_data(picks=pick), raw.info["sfreq"], pick


def process_file(path, fs=None, channels=None, win_s=WIN_S, step_s=STEP_S):
    x, fs, _ = load(path, channels)
    return log_ei(band_powers(preprocess(x, fs), fs, win_s, step_s))


# ---------------------------------------------------------------- 가상 신호 테스트
if __name__ == "__main__":
    fs, rng = 128, np.random.default_rng(0)
    dur, onset = 600, 360            # 10분 세션, 6분부터 하락
    t = np.arange(fs * dur) / fs
    beta_amp = np.where(t < onset, 1.0, 1.0 - 0.6 * (t - onset) / (dur - onset))
    theta_amp = np.where(t < onset, 1.0, 1.0 + 0.8 * (t - onset) / (dur - onset))
    x = (beta_amp * np.sin(2 * np.pi * 17 * t) + theta_amp * np.sin(2 * np.pi * 6 * t)
         + np.sin(2 * np.pi * 10 * t) + rng.normal(scale=1.0, size=(2, t.size)))
    E = log_ei(band_powers(preprocess(x, fs), fs))
    mu, sd = baseline(E[:60])        # 처음 2분을 보정 구간으로 가정
    ci = focus_index(E, mu, sd)
    est, info = detect_onset(ci)
    print(f"true onset {onset}s, detected {est}s")
    print("with k=-1:", detect_onset(ci, k=-1)[0], "| with k=-30 (never reached):", detect_onset(ci, k=-30)[0])
    print({kk: round(float(v), 3) for kk, v in info.items()})
    est2, info2 = detect_onset(focus_index(log_ei(band_powers(preprocess(
        rng.normal(size=(2, t.size)) + np.sin(2 * np.pi * 17 * t), fs), fs)), mu, sd))
    print("no-drop session ->", est2)


def confirm_below(ci, onset_idx, delta=1.0, hold_s=20.0, step_s=STEP_S, smooth=5, k=None):
    """후보 시점 onset_idx 이후 집중 점수가 역치 아래로 hold_s초 이상 연속인지.
    역치: k가 주어지면 고정값 k, 아니면 (그 전까지의 평균 - delta).
    반환: (확정 여부, 역치, 확정된 구간 시작 인덱스)"""
    y = np.asarray(ci, float)
    if onset_idx is None or onset_idx < 1 or onset_idx >= len(y):
        return False, None, None
    thr = float(k) if k is not None else float(y[:onset_idx].mean()) - delta
    pad = smooth // 2
    yp = np.pad(y, pad, mode="edge")
    ys = np.array([np.median(yp[i:i + smooth]) for i in range(len(y))])
    need, run = int(np.ceil(hold_s / step_s)), 0
    for i in range(onset_idx, len(y)):
        run = run + 1 if ys[i] < thr else 0
        if run >= need:
            return True, thr, i - need + 1
    return False, thr, None
