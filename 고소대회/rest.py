"""FocusWave 쉬는 시간 추천

회복 점수 (계획서 6-4: 뇌파 단독이 아닌 다중 지표, 반응시간은 받지 않아 제외, 같은 비중 평균)
  1) 뇌파 회복률 (아래), 2) 휴식 뒤 공부의 4번 집중 자가평가 (1 -> 0, 5 -> 1),
  2-1) 정답률 회복 = 휴식 뒤 공부 정답률 / 휴식 전 공부 정답률 (둘 다 문제를 풀었을 때만),
  3) 휴식 충분 여부 = 9번 (짧았다 0, 적당했다 1, 길었다 1),
  4) 피로 회복 = (휴식 전 공부의 공부 후 피로도 - 다음 공부 전 피로도) / (휴식 전 공부 후 피로도 - 1)
  회복 성공 = 있는 항목들의 평균 >= 0.7 (초기값). 4번은 다음 공부가 끝나야 알 수 있어 그때 확정한다.

뇌파 회복률 (휴식 중 뇌파 측정 없음)
  CI_end    = 휴식 직전 공부 마지막 60초의 집중 점수 중앙값
  CI_resume = 휴식 후 다시 공부를 시작한 첫 60초의 집중 점수 중앙값
  회복률    = (CI_resume - CI_end) / (0 - CI_end)   (0 = 평소 수준, 0~1로 자름)
  회복 성공 = 회복률 >= 0.8 또는 CI_resume >= 0

추천
  - 처음 3회는 뽀모도로 기법의 5분 휴식 (2, 4, 6분 집계에는 넣지 않고 따로 기록)
  - 그 뒤 2, 4, 6분을 각각 3회씩 시험(탐색)
  - 이후 최근 5회 성공률이 2/3 이상인 가장 짧은 휴식을 추천, 없으면 가장 긴 휴식
  - 추천 5번마다 한 단계 짧은 휴식을 한 번 다시 시험 (한 번 실패한 길이도 다시 확인)
  - 9번 휴식 시간 느낌: 짧았다 +1분, 길었다 -1분
  - 10번 휴대폰, 11번 휴식 방법: 조건별 회복 성공률로 보여줌
초기값(0.8, 60초, 3회, 2/3, ±1분)은 모두 실측 데이터로 조정해야 한다.
"""
from dataclasses import dataclass
from typing import List, Optional

import numpy as np

from focus import STEP_S

LENGTHS = [2.0, 4.0, 6.0]
POMODORO_MIN = 5.0     # 처음에는 뽀모도로 기법의 5분 휴식으로 시작
POMODORO_FIRST = 3     # 처음 이 횟수만큼 5분 휴식 후 2, 4, 6분 시험(탐색)으로 넘어감 (초기값)
WINDOW_S = 60.0
RECOVERY_OK = 0.8       # 뇌파 항목만으로 판단할 때의 기준
SCORE_OK = 0.7          # 여러 항목 평균 회복 점수 기준 (초기값)
ENOUGH = {"짧았다": 0.0, "적당했다": 1.0, "길었다": 1.0}
MIN_TRIALS = 3
RECENT = 5
SUCCESS_RATE = 2 / 3
FEEL_NUDGE = {"짧았다": +1.0, "적당했다": 0.0, "길었다": -1.0}
RETEST_EVERY = 5      # 추천 5번마다 한 단계 짧은 휴식을 한 번 다시 시험
FATIGUE_NUDGE = (2, 1.0)   # 공부 전후 피로도 차이가 2 이상이면 휴식 +1분 (초기값)
PHONE_GAP = 0.2            # 휴대폰 본 휴식의 회복 성공률이 이만큼 낮으면 안내
HELP_SCORE = {"도움 o": 1.0, "보통": 0.5, "도움 X": 0.0}


def recovery(ci_before_rest, ci_after_rest, window_s=WINDOW_S, step_s=STEP_S):
    """휴식 직전 공부 CI 배열과 휴식 후 공부 CI 배열로 회복률과 성공 여부"""
    n = max(1, int(window_s / step_s))
    end = float(np.median(np.asarray(ci_before_rest)[-n:]))
    resume = float(np.median(np.asarray(ci_after_rest)[:n]))
    denom = max(0.0 - end, 0.5)                      # 거의 안 떨어졌으면 분모가 0에 가까워지는 것 방지
    ratio = float(np.clip((resume - end) / denom, 0, 1))
    return dict(ci_end=end, ci_resume=resume, ratio=ratio, success=ratio >= RECOVERY_OK or resume >= 0)


@dataclass
class Rest:
    date: str
    rest_min: float
    rest_feel: Optional[str] = None      # 9번
    phone: Optional[bool] = None         # 10번
    method: str = "기본"                 # 11번 대상: 기본이 아닌 방법(운동, 눈감기, 자연경관 등)
    method_help: Optional[str] = None    # 도움 o / 보통 / 도움 X
    domain: Optional[str] = None         # 직전 공부 분야
    fatigue_delta: Optional[int] = None  # 직전 공부의 공부 후 - 공부 전 피로도
    ratio: Optional[float] = None        # 뇌파 회복률
    score: Optional[float] = None        # 여러 항목 평균 회복 점수
    parts: Optional[dict] = None
    success: Optional[bool] = None


class RestAdvisor:
    def __init__(self):
        self.rests: List[Rest] = []
        self.n_recommend = 0

    @staticmethod
    def bucket(minutes):
        """목록에 없는 길이는 가장 가까운 길이로 묶어 집계. 처음 5분 휴식은 따로 두어 집계하지 않는다."""
        if abs(minutes - POMODORO_MIN) < 1e-6:
            return None
        return min(LENGTHS, key=lambda L: abs(L - minutes))

    def add(self, rest: Rest, ci_before_rest, ci_after_rest, focus_self_after=None,
            fatigue_post_before=None, fatigue_pre_after=None, acc_before=None, acc_after=None):
        """휴식 기록 확정. 휴식 뒤 공부까지 끝난 다음에 호출한다."""
        r = recovery(ci_before_rest, ci_after_rest)
        parts = {"뇌파": r["ratio"]}
        if focus_self_after is not None:
            parts["집중 자가평가"] = float(np.clip((focus_self_after - 1) / 4, 0, 1))
        if acc_before and acc_after is not None:
            parts["정답률"] = float(np.clip(acc_after / acc_before, 0, 1))
        if rest.rest_feel in ENOUGH:
            parts["휴식 충분"] = ENOUGH[rest.rest_feel]
        if fatigue_post_before is not None and fatigue_pre_after is not None and fatigue_post_before > 1:
            parts["피로"] = float(np.clip((fatigue_post_before - fatigue_pre_after) / (fatigue_post_before - 1), 0, 1))
        score = float(np.mean(list(parts.values())))
        rest.ratio, rest.score, rest.parts = r["ratio"], score, parts
        rest.success = score >= SCORE_OK if len(parts) > 1 else r["success"]
        self.rests.append(rest)
        return dict(r, score=score, parts=parts, success=rest.success)

    def _by_length(self, L, phone_free=False):
        return [r for r in self.rests if self.bucket(r.rest_min) == L and r.success is not None
                and (not phone_free or r.phone is False)]

    def _phone_free_ready(self):
        """휴대폰 안 본 휴식만으로 길이별 시험 횟수가 채워졌으면 그 기록으로 추천 (계획서의 휴식 조건에 가까움)"""
        return all(len(self._by_length(L, True)) >= MIN_TRIALS for L in LENGTHS)

    def method_stats(self):
        """11번: 기본이 아닌 휴식 방법별 회복 성공률과 도움 점수 평균"""
        out = {}
        for r in self.rests:
            if r.method == "기본" or r.success is None:
                continue
            d = out.setdefault(r.method, dict(success=[], help=[]))
            d["success"].append(float(r.success))
            if r.method_help in HELP_SCORE:
                d["help"].append(HELP_SCORE[r.method_help])
        return {m: dict(n=len(d["success"]), success=round(np.mean(d["success"]), 2),
                        help=round(np.mean(d["help"]), 2) if d["help"] else None) for m, d in out.items()}

    def advice(self):
        """대시보드 안내 문장 (10번 휴대폰, 11번 휴식 방법)"""
        tips, g = [], self.condition_stats()
        if "휴대폰 봄" in g and "휴대폰 안 봄" in g and g["휴대폰 봄"][1] >= 3 and g["휴대폰 안 봄"][1] >= 3:
            on, off = g["휴대폰 봄"][0] / g["휴대폰 봄"][1], g["휴대폰 안 봄"][0] / g["휴대폰 안 봄"][1]
            if off - on >= PHONE_GAP:
                tips.append(f"휴대폰을 안 볼 때 회복 성공률이 더 높다 ({off:.0%} vs {on:.0%})")
        ms = {m: v for m, v in self.method_stats().items() if v["n"] >= 3}
        if ms:
            best = max(ms, key=lambda m: (ms[m]["success"], ms[m]["help"] or 0))
            tips.append(f"가장 회복이 잘 된 휴식 방법: {best} (성공률 {ms[best]['success']:.0%})")
        return tips

    def stats(self):
        """휴식 길이별 회복 성공률 (대시보드용). 처음 5분 휴식은 따로 표시"""
        pomo = [r for r in self.rests if abs(r.rest_min - POMODORO_MIN) < 1e-6 and r.success is not None]
        out = {"5분(시작 단계)": (sum(r.success for r in pomo), len(pomo))} if pomo else {}
        for L in LENGTHS:
            rs = self._by_length(L)[-RECENT:]
            out[f"{L:g}분"] = (sum(r.success for r in rs), len(rs))
        return out

    def condition_stats(self):
        """10번 휴대폰, 11번 휴식 방법별 회복 성공률"""
        groups = {}
        for r in self.rests:
            if r.success is None:
                continue
            keys = []
            if r.phone is not None:
                keys.append("휴대폰 봄" if r.phone else "휴대폰 안 봄")
            keys.append(f"방법: {r.method}")
            for k in keys:
                s, n = groups.get(k, (0, 0))
                groups[k] = (s + r.success, n + 1)
        return groups

    def recommend(self, fatigue_delta=None):
        """fatigue_delta: 방금 끝난 공부의 공부 후 - 공부 전 피로도 (피로가 많이 쌓였으면 조금 길게)"""
        rec, info = self._recommend_base()
        if fatigue_delta is not None and fatigue_delta >= FATIGUE_NUDGE[0] and not info["basis"].startswith(("탐색", "재시험", "시작 단계")):
            rec += FATIGUE_NUDGE[1]
            info["fatigue_nudge"] = FATIGUE_NUDGE[1]
        info["advice"] = self.advice()
        return rec, info

    def _recommend_base(self):
        n_pomo = sum(abs(r.rest_min - POMODORO_MIN) < 1e-6 for r in self.rests)
        if n_pomo < POMODORO_FIRST and len(self.rests) == n_pomo:
            return POMODORO_MIN, dict(basis=f"시작 단계: 뽀모도로 5분 휴식 ({n_pomo + 1}/{POMODORO_FIRST}회)")
        for L in LENGTHS:                                   # 탐색: 시험 횟수가 부족한 길이부터
            if len(self._by_length(L)) < MIN_TRIALS:
                return L, dict(basis=f"탐색 중 ({L:g}분 {len(self._by_length(L))}/{MIN_TRIALS}회)")
        self.n_recommend += 1
        best, met = LENGTHS[-1], False
        pf = self._phone_free_ready()
        for L in LENGTHS:
            rs = self._by_length(L, pf)[-RECENT:]
            if sum(r.success for r in rs) / len(rs) >= SUCCESS_RATE:
                best, met = L, True
                break
        i = LENGTHS.index(best)
        if i > 0 and self.n_recommend % RETEST_EVERY == 0:
            L = LENGTHS[i - 1]
            return L, dict(basis=f"재시험: {L:g}분으로도 회복되는지 한 번 확인")
        last = self.rests[-1] if self.rests else None
        nudge = FEEL_NUDGE.get(last.rest_feel, 0.0) if last else 0.0
        rec = float(np.clip(best + nudge, 1.0, LENGTHS[-1] + 2))
        s, n = self.stats()[f"{best:g}분"]
        basis = (f"{best:g}분 휴식 회복 성공 {s}/{n}회, 기준을 넘는 가장 짧은 휴식" if met else
                 f"기준을 넘는 길이가 없어 가장 긴 {best:g}분 (성공 {s}/{n}회)")
        return rec, dict(basis=basis, feel=last.rest_feel if last else None, nudge=nudge)


if __name__ == "__main__":
    rng = np.random.default_rng(0)
    adv = RestAdvisor()
    for i in range(24):
        L, why = adv.recommend()
        phone = bool(rng.random() < 0.4)
        tau = 3.5 if phone else 2.0                           # 가정: 휴대폰을 보면 회복이 느림
        true_ratio = 1 - np.exp(-L / tau)
        before = -3 + rng.normal(0, 0.8, 90)
        after = -3 + 3 * true_ratio + rng.normal(0, 0.8, 90)
        feel = "짧았다" if true_ratio < 0.7 else "적당했다"
        r = adv.add(Rest(date="2026-10-01", rest_min=L, rest_feel=feel, phone=phone), before, after)
        if i % 4 == 3 or i < 2:
            print(f"휴식 {i + 1:2d}: {L:g}분 ({why['basis']}) -> 회복률 {r['ratio']:.2f}, 성공 {r['success']}")
    print("길이별 성공률:", adv.stats())
    print("조건별 성공률:", adv.condition_stats())
    print("다음 추천:", adv.recommend())
