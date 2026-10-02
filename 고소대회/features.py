"""기기별 특징 추출 (선행 연구 기반 지표)

집중 점수용 비율: ln(β/α)
  - EI(β/(α+θ)) 대신 쓰는 이유: 계산, 작업기억 과제에서 전두 세타는 노력에 따라 증가하므로
    (Gärtner 등 2015, Maurer 등 2015, Gevins 등 1997) 세타를 분모에 두면 노력을 저하로 읽을 수 있다.
    B/A 지표는 Pope 등(1995)이 제시한 참여도 지표 중 하나이다.
  - 공개 데이터(Mental Attention 34세션) 재검증: 14채널에서 헛탐지 0 기준 탐지 31/34 (EI 23/34)
상태 표시 (판정에는 쓰지 않고 표시, 저장만):
  - 부하(노력): 전두 세타. 작업 부하와 난이도에 따라 증가 (위 연구, 이마 단일 채널 연구 포함)
  - 딴생각: 알파 증가. 경험 표집 연구에서 딴생각 직전 알파 증가 (Compton 등 2019, Arnau 등 2020)
  - 좌우 알파 차이(EPOC X만): 언어/공간 과제에 따른 반구 차이 (Galin, Ornstein 1972, McLeod 1977).
    저하 판정 근거는 아니므로 저장만 한다.
"""
import numpy as np
from scipy.signal import welch

from focus import preprocess, STEP_S

BANDS3 = {"theta": (4.0, 8.0), "alpha": (8.0, 13.0), "beta": (13.0, 22.0)}

DEVICES = {
    "epoc_x": dict(
        channels=["AF3", "F7", "F3", "FC5", "T7", "P7", "O1", "O2", "P8", "T8", "FC6", "F4", "F8", "AF4"],
        frontal=["AF3", "AF4", "F3", "F4"],          # 정중선 Fz가 없어 대신 사용
        posterior=["P7", "P8", "O1", "O2"],
        left=["T7", "P7"], right=["T8", "P8"],
        artifact_factor=6.0, k_ratio=0.40, model="focus_lstm_epoc_x.pt"),
    "fx2": dict(                                      # LAXTHA neuroNicle FX2: 이마 2채널, 250Hz, 3~41Hz 대역
        channels=["Fp1", "Fp2"],
        frontal=["Fp1", "Fp2"],
        posterior=["Fp1", "Fp2"],                     # 뒤통수 채널이 없어 이마 알파로 대신 (근거 약함)
        left=None, right=None,
        artifact_factor=4.0, k_ratio=0.40, model="focus_lstm_fx2.pt"),   # 이마 전극이라 눈 깜빡임 제거를 더 강하게
}


def band_powers_ch(x, fs, win_s=STEP_S, step_s=STEP_S):
    """(채널, 샘플) 필터된 신호 -> (창, 채널, 3) [theta, alpha, beta]"""
    w, s = int(win_s * fs), int(step_s * fs)
    n = (x.shape[-1] - w) // s + 1
    segs = np.stack([x[:, i * s:i * s + w] for i in range(max(n, 0))]) if n > 0 else np.empty((0, x.shape[0], w))
    f, p = welch(segs, fs=fs, nperseg=w, axis=-1)
    df = f[1] - f[0]
    return np.stack([p[..., (f >= lo) & (f < hi)].sum(-1) * df for lo, hi in BANDS3.values()], -1)


def artifact_mask(x, fs, factor, win_s=STEP_S):
    """창별 진폭(최대-최소)이 세션 중앙값의 factor배를 넘으면 잡음 창으로 표시 (단위와 무관)"""
    w = int(win_s * fs); n = x.shape[-1] // w
    ptp = np.ptp(x[:, :n * w].reshape(x.shape[0], n, w), axis=-1).max(0)
    return ptp > factor * np.median(ptp)


def extract(eeg, fs, device="epoc_x", channel_names=None):
    """원시 뇌파 -> 창별 특징 dict
    E: ln(β/α) 채널 평균 (집중 점수 재료), X: LSTM 입력 [ln θ, ln α, ln β, ln(β/α)],
    load: 전두 ln θ, mw: 알파(딴생각) ln α, asym: 오른쪽 - 왼쪽 ln α (EPOC X), bad: 잡음 창"""
    cfg = DEVICES[device]
    names = channel_names or cfg["channels"]
    x = preprocess(np.atleast_2d(np.asarray(eeg, float)), fs)
    bp = band_powers_ch(x, fs) + 1e-12                      # (창, 채널, 3)
    idx = lambda chs: [names.index(c) for c in chs if c in names]
    avg = bp.mean(1); lb = np.log(avg)
    out = dict(E=lb[:, 2] - lb[:, 1],
               X=np.c_[lb, lb[:, 2] - lb[:, 1]].astype(np.float32),
               load=np.log(bp[:, idx(cfg["frontal"]), 0].mean(1)),
               mw=np.log(bp[:, idx(cfg["posterior"]), 1].mean(1)),
               asym=None, bad=artifact_mask(x, fs, cfg["artifact_factor"])[:len(avg)])
    if cfg["left"]:
        out["asym"] = np.log(bp[:, idx(cfg["right"]), 1].mean(1)) - np.log(bp[:, idx(cfg["left"]), 1].mean(1))
    return out


def states(feat, ref, z_load=1.0, z_mw=1.0):
    """보정 구간 기준(ref: dict(load=(중앙값, 폭), mw=(...)))으로 상태 표시.
    부하 높음: 전두 세타가 평소보다 z_load 폭 이상 높음 / 딴생각 의심: 알파가 평소보다 z_mw 폭 이상 높음.
    판정은 바꾸지 않고 대시보드 표시와 저장에만 쓴다. 기준 1.0은 초기값."""
    zl = (feat["load"] - ref["load"][0]) / ref["load"][1]
    zm = (feat["mw"] - ref["mw"][0]) / ref["mw"][1]
    return dict(load_z=zl, mw_z=zm, high_load=zl >= z_load, mind_wander=zm >= z_mw)
