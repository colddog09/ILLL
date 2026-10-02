"""EEGMAT으로 집중도 산출과 변화점 탐지 점검
1) 휴지 대비 과제에서 CI(=EI 표준화)가 올라가는가
2) 과제 -> 휴지로 이어 붙인 기록에서 하락 시작(경계 약 62초)을 잡는가
사용: python eval_eegmat.py <csv 폴더> [Fp1,Fp2]
"""
import os as _os, sys as _sys
_sys.path.insert(0, _os.path.dirname(_os.path.dirname(_os.path.abspath(__file__))))

import glob, os, sys
import numpy as np
from scipy.stats import wilcoxon
from focus import load, preprocess, band_powers, log_ei, baseline, focus_index, detect_onset

root = sys.argv[1]
ch = sys.argv[2].split(",") if len(sys.argv) > 2 else None
d_ci, hits, errs = [], 0, []
files = sorted(glob.glob(os.path.join(root, "Subject*_1.*")))
for p1 in files:
    E = {}
    for k, p in (("rest", p1), ("task", p1.replace("_1.", "_2."))):
        x, fs, _ = load(p, ch)
        E[k] = log_ei(band_powers(preprocess(x, fs), fs))
    mu, sd = baseline(E["rest"][:30])                 # 휴지 앞 60초를 기준으로
    ci_rest = focus_index(E["rest"][30:], mu, sd)
    ci_task = focus_index(E["task"], mu, sd)
    d_ci.append(ci_task.mean() - ci_rest.mean())
    seq = np.r_[ci_task, ci_rest[:len(ci_task)]]      # 과제 60초 -> 휴지 60초
    est, _ = detect_onset(seq)
    if est is not None:
        hits += 1; errs.append(est - len(ci_task) * 2.0)
d = np.array(d_ci)
print(f"subjects {len(d)}  channels {'all 19' if ch is None else ch}")
print(f"[1] task CI - rest CI: mean {d.mean():.2f}, median {np.median(d):.2f}, "
      f"positive {np.mean(d > 0):.0%}, Wilcoxon p={wilcoxon(d).pvalue:.3g}")
if errs:
    e = np.array(errs)
    print(f"[2] drop detected {hits}/{len(files)}, onset error median {np.median(e):+.0f}s, "
          f"|error|<=10s {np.mean(np.abs(e) <= 10):.0%} of detected")
else:
    print(f"[2] drop detected 0/{len(files)}")
