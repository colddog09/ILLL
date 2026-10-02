"""세션 단위 저장 형식
sessions/<user_id>/<YYYY-MM-DD>_<HHMM>_<기기>_<분야>/
  eeg.npz        원시 뇌파 (채널 x 샘플), fs, 채널 이름
  features.npz   2초 창별 ln(β/α), CI, LSTM 확률, 부하/딴생각 점수, 좌우 알파 차이, 저하 표시, 잡음 표시
  meta.json      설문 답(공부 전, 공부 후), 판정 결과, 권장 시간과 근거, 사용한 설정값, 코드 버전
rests/<user_id>.jsonl  휴식 기록 한 줄씩 (9~11번 답, 회복률)
원시 뇌파는 비공개 저장소, meta와 features는 DB에 올리는 것을 전제로 나눴다.
"""
import json, os
from dataclasses import asdict
import numpy as np

import fine_tune, focus, rest, features
VERSION = "focuswave-0.4"
_j = lambda o: o.item() if hasattr(o, "item") else (o.tolist() if hasattr(o, "tolist") else str(o))


def _settings():
    fw = __import__("focuswave")
    return dict(detect_method=fw.DETECT_METHOD, k_source=fw.K_SOURCE, hold_s=fw.HOLD_S,
                k_ratio={d: c["k_ratio"] for d, c in features.DEVICES.items()}, ratio="ln(beta/alpha)",
                bands=features.BANDS3, units=fine_tune.UNITS, knots=fine_tune.KNOTS, time_bounds=fine_tune.TIME_BOUNDS,
                sleep_bins=fine_tune.SLEEP_BINS, feel_nudge=fine_tune.FEEL_NUDGE,
                margin=fine_tune.Personalizer.MARGIN_MIN, max_step=fine_tune.Personalizer.MAX_STEP_MIN)


def save_session(root, user_id, session, eeg, fs, channels, out, recommendation=None, extra=None):
    d = os.path.join(root, "sessions", user_id,
                     f"{session.date}_{session.start_hour:02d}00_{session.device}_{session.domain}")
    os.makedirs(d, exist_ok=True)
    np.savez_compressed(os.path.join(d, "eeg.npz"), eeg=np.asarray(eeg, np.float32), fs=fs, channels=np.array(channels))
    arrays = dict(E=session.E, ci=out["ci"], drop=session.drop_mask, bad=session.bad_mask,
                  load_z=out["states"]["load_z"], mw_z=out["states"]["mw_z"])
    for k in ("prob", "asym"):
        if out.get(k) is not None:
            arrays[k] = out[k]
    np.savez_compressed(os.path.join(d, "features.npz"), **arrays)
    meta = {k: v for k, v in asdict(session).items() if k not in ("E", "drop_mask", "bad_mask")}
    meta.update(time_group=session.time_group, focus_min=session.target, drift_match=session.drift_matches(),
                fatigue_delta=session.fatigue_delta, info=out["info"],
                high_load_ratio=out["high_load_ratio"], mind_wander_ratio=out["mind_wander_ratio"],
                recommendation=recommendation, settings=_settings(), version=VERSION, extra=extra or {})
    with open(os.path.join(d, "meta.json"), "w", encoding="utf-8") as f:
        json.dump(meta, f, ensure_ascii=False, indent=2, default=_j)
    return d


def save_rest(root, user_id, r: rest.Rest):
    os.makedirs(os.path.join(root, "rests"), exist_ok=True)
    with open(os.path.join(root, "rests", f"{user_id}.jsonl"), "a", encoding="utf-8") as f:
        f.write(json.dumps(asdict(r), ensure_ascii=False, default=_j) + "\n")


def load_session(d):
    with open(os.path.join(d, "meta.json"), encoding="utf-8") as f:
        meta = json.load(f)
    return meta, dict(np.load(os.path.join(d, "eeg.npz"))), dict(np.load(os.path.join(d, "features.npz")))


if __name__ == "__main__":
    from focuswave import FocusWave, _fake_eeg
    rng = np.random.default_rng(0)
    app = FocusWave(); app.calibrate(_fake_eeg(250, 3, 99, rng, 2), 250, "fx2")
    s = fine_tune.Session(date="2026-10-01", start_hour=9, caffeine_3h=True, drowsy_med=False, sleep_bin="6~7시간",
                          device="fx2", domain="언어", fatigue_pre=2)
    rec = app.start_session(s)
    eeg = _fake_eeg(250, 20, 12, rng, 2)
    out = app.end_session(s, eeg, 250, post=dict(focus_self=3, drift_when="중반", duration_feel="적당했다",
                                                 fatigue_post=4, device_disturb=1))
    d = save_session("/home/claude/store", "user01", s, eeg, 250, ["Fp1", "Fp2"], out, recommendation=rec)
    save_rest("/home/claude/store", "user01", rest.Rest(date="2026-10-01", rest_min=4, rest_feel="적당했다", phone=False,
                                                        domain="언어", fatigue_delta=s.fatigue_delta))
    meta, e, f = load_session(d)
    print(os.path.basename(d), "| eeg", e["eeg"].shape, "| 저장 항목", sorted(f), "| 피로 누적", meta["fatigue_delta"], "|", meta["version"])
