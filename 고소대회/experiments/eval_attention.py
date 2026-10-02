"""Mental Attention State 데이터셋(Kaggle: inancigdem/eeg-data-for-mental-attention-state-detection)으로
FocusWave 집중도 산출과 하락 탐지를 시험한다.

데이터: EMOTIV 14채널 128Hz, o.data의 4~17번 열이 EEG
진행: 0~10분 집중 -> 10~20분 비집중 -> 이후 졸림 (공개 저장소 설명 기준)
정답 하락 시점: 10분

사용: python eval_attention.py <eeg_record*.mat 폴더> [채널 예: AF3,AF4]
"""
import os as _os, sys as _sys
_sys.path.insert(0, _os.path.dirname(_os.path.dirname(_os.path.abspath(__file__))))

import glob, os, sys
import numpy as np
from scipy.io import loadmat

from focus import preprocess, band_powers, log_ei, baseline, focus_index, detect_onset, STEP_S

FS = 128
CH = ["AF3", "F7", "F3", "FC5", "T7", "P7", "O1", "O2", "P8", "T8", "FC6", "F4", "F8", "AF4"]
TRUE_ONSET_MIN = 10.0        # 집중 -> 비집중
TRUE_DROWSY_MIN = 20.0       # 비집중 -> 졸림
CALIB = (1.0, 4.0)            # 초기 보정 구간(분): 집중 구간 중 1~4분
K_LIST = [-0.5, -1.0, -1.5, -2.0]


def load(path, channels=None):
    o = loadmat(path, squeeze_me=True, struct_as_record=False)["o"]
    eeg = np.asarray(o.data, float)[:, 3:17].T            # 4~17번 열 (0부터 세면 3~16)
    if channels:
        eeg = eeg[[CH.index(c) for c in channels]]
    return eeg


def run(path, channels=None):
    E = log_ei(band_powers(preprocess(load(path, channels), FS), FS))
    per_min = int(60 / STEP_S)
    mu, sd = baseline(E[int(CALIB[0] * per_min):int(CALIB[1] * per_min)])
    ci = focus_index(E, mu, sd)
    seg = lambda a, b: ci[int(a * per_min):int(b * per_min)]
    res = dict(focused=np.median(seg(CALIB[1], 10)), unfocused=np.median(seg(10, 20)),
               drowsy=np.median(seg(20, 30)) if len(ci) > 20 * per_min else np.nan)
    trial = ci[int(CALIB[1] * per_min):int(20 * per_min)]       # 보정 이후 ~ 20분
    for k in K_LIST:
        est, _ = detect_onset(trial, k=k)
        res[k] = None if est is None else CALIB[1] + est / 60
        est2, _ = detect_onset(ci[int(CALIB[1] * per_min):int(30 * per_min)], k=k)   # 보정 이후 ~ 30분
        res[("drowsy", k)] = None if est2 is None else CALIB[1] + est2 / 60
    return res


if __name__ == "__main__":
    root = sys.argv[1]
    channels = sys.argv[2].split(",") if len(sys.argv) > 2 else None
    files = sorted(glob.glob(os.path.join(root, "*.mat")),
                   key=lambda p: int("".join(filter(str.isdigit, os.path.basename(p))) or 0))
    rows = []
    for f in files:
        try:
            r = run(f, channels); rows.append(r)
            print(f"{os.path.basename(f):>18}: CI 집중 {r['focused']:+.2f} 비집중 {r['unfocused']:+.2f} "
                  f"졸림 {r['drowsy']:+.2f} | k=-1 탐지 {r[-1.0] if r[-1.0] is None else round(r[-1.0], 1)}분")
        except Exception as e:
            print(f"{os.path.basename(f)}: 건너뜀 ({e})")
    if not rows:
        sys.exit("파일 없음")
    f_, u_, d_ = (np.array([r[s] for r in rows]) for s in ("focused", "unfocused", "drowsy"))
    print(f"\n파일 {len(rows)}개, 채널 {'14개 전체' if not channels else channels}")
    print(f"[집중도] 중앙값 CI 집중 {np.median(f_):+.2f}, 비집중 {np.median(u_):+.2f}, 졸림 {np.nanmedian(d_):+.2f}")
    print(f"         비집중이 집중보다 낮은 파일 {np.mean(u_ < f_):.0%}, 졸림이 집중보다 낮은 파일 "
          f"{np.nanmean(d_ < f_):.0%}")
    for k in K_LIST:
        est = [r[k] for r in rows]
        hit = [e for e in est if e is not None]
        err = np.abs(np.array(hit) - TRUE_ONSET_MIN) if hit else np.array([])
        print(f"[하락 탐지 k={k:+.1f}] 탐지 {len(hit)}/{len(rows)}, 오차 중앙값 "
              f"{np.median(err) if len(err) else float('nan'):.1f}분, ±2분 이내 {np.mean(err <= 2) if len(err) else 0:.0%}")
    for k in K_LIST:
        hit = [r[("drowsy", k)] for r in rows if r[("drowsy", k)] is not None]
        err = np.abs(np.array(hit) - TRUE_DROWSY_MIN) if hit else np.array([])
        print(f"[졸림 시작 탐지 k={k:+.1f}] 탐지 {len(hit)}/{len(rows)}, 오차 중앙값 "
              f"{np.median(err) if len(err) else float('nan'):.1f}분, ±3분 이내 {np.mean(err <= 3) if len(err) else 0:.0%}")
