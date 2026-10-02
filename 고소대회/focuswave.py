"""FocusWave 전체 흐름 (기기별, 분야별)

1. 보정: 처음 착용 시 기기별(가능하면 분야별) 집중 과제 -> 평소 값, LSTM 표준화 값, 상태 기준
2. 공부 전: 기기, 분야, 공부 전 피로도, 설문 1~3번 -> 오늘 권장 공부 시간
3. 공부 중: 2초마다 집중 점수 CI = (ln(β/α) - mu) / sigma, LSTM 저하 확률, 부하, 딴생각 표시
4. 공부 후: 하락 판정(LSTM 후보 + CI 역치 확인), 설문 4~8번 -> 기록, 계수 b, 평소 값 갱신
5. 휴식: 피로 누적, 휴대폰, 휴식 방법을 반영한 휴식 추천, 다음 공부 첫 60초로 회복률 계산

수면, 카페인, 피로도 등 설문 요인은 권장 공부 시간(계수 b)에만 쓰고, 집중 점수와 판정에는 쓰지 않는다.
부하, 딴생각 표시는 선행 연구 근거가 있는 상태 표시이며 판정에는 쓰지 않는다 (features.py 참고).
"""
import os
import numpy as np

from features import extract, states, DEVICES
from focus import focus_index, detect_onset, confirm_below, baseline, STEP_S
from fine_tune import Personalizer, Session
from rest import RestAdvisor, Rest
from lstm_detector import Detector

HERE = os.path.dirname(os.path.abspath(__file__))
DETECT_METHOD = "hybrid"   # "hybrid": LSTM 후보 시점 이후 CI가 역치 아래로 HOLD_S초 이상이면 확정 / "lstm" / "ci"
K_SOURCE = "ratio"         # "ratio": 평소 값보다 β/α가 기기별 k_ratio만큼 낮으면 저하 -> k = ln(1 - k_ratio) / sigma
                           # "survey": 설문 4번과 가장 잘 맞는 k로 (기기, 분야)별 한 번 고정
K_DEFAULT = -1.0
K_TUNE_MIN = 10
K_CANDIDATES = np.arange(-0.5, -2.01, -0.25)
HOLD_S = 20.0
CONFIRM_WITH_SURVEY = True  # 계획서 2-나: 뇌파 하락 + (4번 집중 자가평가 1~3 또는 정답률 하락) 중 하나 이상일 때만 확정


class FocusWave:
    def __init__(self, model_dir=HERE, overrides=None):
        import config
        config.apply(overrides, globals())          # 설정값은 config.py 한곳에서 관리
        self.p = Personalizer()
        self.rest = RestAdvisor()
        self.det = {d: Detector.load(os.path.join(model_dir, c["model"]))
                    for d, c in DEVICES.items() if os.path.exists(os.path.join(model_dir, c["model"]))}
        self.det_ref, self.state_ref, self.labeled = {}, {}, {}

    # ---- 1. 보정
    def calibrate(self, eeg, fs, device="epoc_x", domain="*", channel_names=None):
        f = extract(eeg, fs, device, channel_names)
        ok = ~f["bad"]
        self.p.set_calibration(f["E"][ok], device, domain)
        self.det_ref[(device, domain)] = (f["X"][ok].mean(0), f["X"][ok].std(0) + 1e-8)
        self.state_ref[(device, domain)] = dict(load=baseline(f["load"][ok]), mw=baseline(f["mw"][ok]))

    def _ref(self, table, device, domain):
        return table.get((device, domain), table.get((device, "*")))

    def _k(self, s):
        if K_SOURCE == "ratio":
            return float(np.log(1 - DEVICES[s.device]["k_ratio"]) / self.p.baseline_for(*s.key)[1])
        return self.p.k_for(s.key, K_DEFAULT)

    # ---- 2. 공부 전
    def start_session(self, survey: Session):
        return self.p.recommend(survey)

    # ---- 3. 공부 중 (대시보드 실시간 갱신용)
    def live(self, survey: Session, eeg_so_far, fs, channel_names=None):
        f = extract(eeg_so_far, fs, survey.device, channel_names)
        mu, sd = self.p.baseline_for(*survey.key)
        out = dict(ci=focus_index(f["E"], mu, sd), bad=f["bad"],
                   **states(f, self._ref(self.state_ref, survey.device, survey.domain)))
        if survey.device in self.det:
            d = self.det[survey.device]; d.mu, d.sd = self._ref(self.det_ref, survey.device, survey.domain)
            out["prob"] = d.proba(f["X"])
        return out

    # ---- 4. 공부 후
    def end_session(self, survey: Session, eeg, fs, post=None, channel_names=None, method=None):
        for key, v in (post or {}).items():
            setattr(survey, key, v)
        f = extract(eeg, fs, survey.device, channel_names)
        mu, sd = self.p.baseline_for(*survey.key)
        ci = focus_index(f["E"], mu, sd)
        k = self._k(survey)
        method = method or (DETECT_METHOD if survey.device in self.det else "ci")
        onset_ci, _ = detect_onset(ci, k=k, hold_s=HOLD_S)
        onset_lstm = onset_hybrid = prob = None
        info = dict(k=k, onset_ci_min=None if onset_ci is None else onset_ci / 60)
        if survey.device in self.det:
            d = self.det[survey.device]; d.mu, d.sd = self._ref(self.det_ref, survey.device, survey.domain)
            onset_lstm, prob = d.detect(f["X"])
            if onset_lstm is not None and confirm_below(ci, int(onset_lstm / STEP_S), hold_s=HOLD_S, k=k)[0]:
                onset_hybrid = onset_lstm
            info.update(onset_lstm_min=None if onset_lstm is None else onset_lstm / 60,
                        onset_hybrid_min=None if onset_hybrid is None else onset_hybrid / 60)
            y = Detector.survey_labels(len(f["X"]), survey.focus_self, survey.drift_when)
            if y is not None:                                   # 설문 라벨로 기기별 개인 파인튜닝
                L = self.labeled.setdefault(survey.device, []); L.append((f["X"], y))
                ok, f_old, f_new = d.finetune(L)
                info["finetune"] = None if f_old is None else dict(promoted=ok, f1_old=f_old, f1_new=f_new)
        onset_s = {"lstm": onset_lstm, "hybrid": onset_hybrid}.get(method, onset_ci)
        info["used"] = method
        if onset_s is not None and CONFIRM_WITH_SURVEY:
            worse_self = None if survey.focus_self is None else survey.focus_self <= 3
            worse_acc = self.p.accuracy_dropped(survey)           # 문제를 안 풀었거나 기록이 적으면 None (건너뜀)
            info.update(worse_self=worse_self, worse_acc=worse_acc)
            if worse_self is False and worse_acc is not True:     # 본인 평가도, 정답률도 괜찮으면 확정하지 않음
                info["cancelled_by_survey"] = onset_s / 60
                onset_s = None
        # 평소 값 갱신에서 뺄 구간: 판정된 하락 이후 + 역치 아래 창 + 설문상 흐트러진 이후 + 잡음 창
        drop = ci < k
        if onset_s is not None:
            drop[int(onset_s / STEP_S):] = True
        if survey.focus_self is not None and survey.focus_self <= 3 and survey.drift_when in ("초반", "중반", "후반"):
            drop[int({"초반": 0, "중반": 1 / 3, "후반": 2 / 3}[survey.drift_when] * len(ci)):] = True
        survey.length_min = len(ci) * STEP_S / 60
        survey.onset_min = None if onset_s is None else onset_s / 60
        survey.onset_lstm_s = onset_lstm
        # 하락 없이 끝났으면 여유도: 마지막 5분 집중 점수가 역치보다 얼마나 위에 있었는지 (k 기준 비율)
        if onset_s is None:
            tail = ci[-int(300 / STEP_S):][~f["bad"][-int(300 / STEP_S):]] if len(ci) else ci
            survey.headroom = float((np.median(tail) - k) / abs(k)) if len(tail) else None
            info["headroom"] = survey.headroom
        else:
            # 하락 깊이는 기록만 남긴다 (줄이는 폭은 하락이 공부 끝에서 얼마나 멀었는지로 정함)
            i0 = int(onset_s / STEP_S)
            after = ci[i0:][~f["bad"][i0:]]
            survey.drop_depth = float(max(0.0, (k - np.median(after)) / abs(k))) if len(after) else None
            info["drop_depth"] = survey.drop_depth
        survey.E, survey.drop_mask, survey.bad_mask = f["E"], drop, f["bad"]
        self.p.add_session(survey)
        if K_SOURCE == "survey" and survey.key not in self.p.k_tuned:
            t = self.tune_k(survey.key, method)
            if t:
                info["k_tuned"] = t
        st = states(f, self._ref(self.state_ref, survey.device, survey.domain))
        info["drop_earliness"] = survey.drop_earliness
        return dict(ci=ci, prob=prob, onset_min=survey.onset_min, focus_min=survey.target,
                    drift_match=survey.drift_matches(), fatigue_delta=survey.fatigue_delta,
                    high_load_ratio=float(st["high_load"].mean()), mind_wander_ratio=float(st["mind_wander"].mean()),
                    states=st, asym=f["asym"], info=info)

    def tune_k(self, key, method):
        """설문 기반 개인 역치 (K_SOURCE="survey"): 설문 4번(1~3 하락 있음)과 F1이 가장 높은 k로 고정.
        8번 장비 방해가 큰 세션은 제외한다."""
        from sklearn.metrics import f1_score
        ses = [s for s in self.p.sessions if s.key == key and s.focus_self is not None and s.E is not None
               and (s.device_disturb or 0) < self.p.DISTURB_LOW_CONF]
        if len(ses) < K_TUNE_MIN:
            return None
        mu, sd = self.p.baseline_for(*key)
        y, best = [int(s.focus_self <= 3) for s in ses], None
        for kc in K_CANDIDATES:
            pred = []
            for s in ses:
                ci = focus_index(s.E, mu, sd)
                hit = (s.onset_lstm_s is not None and confirm_below(ci, int(s.onset_lstm_s / STEP_S), hold_s=HOLD_S, k=kc)[0]
                       ) if method == "hybrid" else detect_onset(ci, k=kc, hold_s=HOLD_S)[0] is not None
                pred.append(int(hit))
            f1 = f1_score(y, pred, zero_division=0)
            if best is None or (f1, -abs(kc + 1)) > best[0]:
                best = ((f1, -abs(kc + 1)), float(kc), f1)
        self.p.k[key] = best[1]; self.p.k_tuned.add(key)
        return dict(k=best[1], f1=round(best[2], 3), sessions=len(ses))

    # ---- 5. 휴식
    def next_rest(self, fatigue_delta=None):
        return self.rest.recommend(fatigue_delta)

    def end_rest(self, rest: Rest, before: Session, before_out, after: Session, after_out):
        """휴식 기록 확정: 휴식 뒤 공부(after)까지 끝난 다음에 호출한다.
        rest에는 9~11번 답, before/after는 휴식 전후 공부 세션과 end_session 결과."""
        rest.domain, rest.fatigue_delta = before.domain, before.fatigue_delta
        return self.rest.add(rest, before_out["ci"], after_out["ci"], after.focus_self,
                             before.fatigue_post, after.fatigue_pre, before.accuracy, after.accuracy)


# ---------------------------------------------------------------- 가상 세션 시험
def _fake_eeg(fs, minutes, onset_min, rng, n_ch=14, depth=0.6):
    t = np.arange(int(fs * minutes * 60)) / fs
    decay = np.clip((t - onset_min * 60) / 300, 0, 1)
    sig = ((1 - depth * decay) * np.sin(2 * np.pi * 17 * t) + np.sin(2 * np.pi * 6 * t)
           + (1 + depth * decay) * np.sin(2 * np.pi * 10 * t))
    return sig + rng.normal(scale=1.0, size=(n_ch, t.size))


if __name__ == "__main__":
    rng = np.random.default_rng(3)
    app = FocusWave()
    app.calibrate(_fake_eeg(128, 3, 99, rng), 128, "epoc_x")
    # LSTM은 실제 EMOTIV 뇌파로 학습되어 가상 신호에 맞지 않으므로 이 시험의 판정은 CI 방식으로 한다
    prev = prev_out = rest = None
    for i in range(8):
        s = Session(date="d", start_hour=9, caffeine_3h=False, drowsy_med=False, sleep_bin="6~7시간",
                    device="epoc_x", domain="산술", fatigue_pre=2 if i == 0 else int(rng.integers(2, 4)))
        rec, why = app.start_session(s)
        drop = i not in (5, 6)
        true = 12 if drop else 99
        # 세션 7: 뇌파는 떨어지지만 본인은 잘 됐다고 답함 -> 하락으로 확정하지 않아야 함
        eeg_drop = 12 if i == 6 else true
        solved = i != 2                                   # 3번 세션은 문제를 안 풂 -> 정답률 건너뜀
        correct = 12 if drop else (8 if i == 5 else 17)   # 6번 세션: 집중은 잘 됐는데 정답률이 낮음 -> 다음에 안내
        post = dict(focus_self=2 if drop else 4, drift_when="중반" if drop else None, duration_feel="적당했다",
                    fatigue_post=4 if drop else 3, device_disturb=1,
                    solved=solved, n_questions=20 if solved else None, n_correct=correct if solved else None)
        out = app.end_session(s, _fake_eeg(128, 20, eeg_drop, rng), 128, method="ci", post=post)
        if prev is not None:
            r = app.end_rest(rest, prev, prev_out, s, out)
            rest_txt = f" | 직전 휴식 {rest.rest_min:g}분 회복 점수 {r['score']:.2f} {r['parts']}"
        else:
            rest_txt = ""
        L, _ = app.next_rest(out["fatigue_delta"])
        rest = Rest(date="d", rest_min=L, rest_feel="적당했다" if L >= 4 else "짧았다", phone=False)
        note = " (본인 평가가 좋아 하락 취소)" if "cancelled_by_survey" in out["info"] else ""
        acc = "안 풂" if s.accuracy is None else f"{s.accuracy:.0%}"
        tip = " | 안내: 정답률 하락" if why.get("accuracy_note") else ""
        print(f"{i + 1} 권장 {rec:4.1f}분{tip} | 자가평가 {s.focus_self}, 정답률 {acc} | 하락 "
              f"{'없음' if out['onset_min'] is None else round(out['onset_min'], 1)}{note}{rest_txt}")
        prev, prev_out = s, out
