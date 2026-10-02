"""민감도 분석: 근거 없이 정한 초기값을 절반, 두 배로 바꿨을 때 추천 결과가 얼마나 달라지는가
가상 사용자로 시뮬레이션한다 (뇌파 대신 실제 집중 유지 시간을 직접 만들어 넣음).
- 공부 시간: 사용자 40명 x 25세션. 실제 집중 유지 시간 T = 개인 기본값 + 수면 효과 + 피로 효과 + 잡음
  지표: 마지막 15세션의 |권장 - (T - 1.5)| 평균(오차), 권장이 T를 넘은 비율(넘김)
- 휴식: 사용자 40명 x 30회. 사람마다 충분한 최소 휴식 L*가 다르고, 길이 L의 회복 확률은 L*에 가까울수록 0.5
  지표: 마지막 15회의 |추천 - L*| 평균, 추천이 L*보다 짧았던 비율
사용: python sensitivity.py
"""
import os, sys
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
import numpy as np
import config, fine_tune as ft, rest as rs

BINS = list(ft.SLEEP_BINS)


def sim_study(overrides, seeds=(0, 1, 2), users=40, n=25):
    config.apply(overrides)
    err, over = [], []
    for seed in seeds:
        rng = np.random.default_rng(seed)
        for u in range(users):
            T0, bs, bf = rng.uniform(12, 40), rng.uniform(0, 4), rng.uniform(0, 3)
            p = ft.Personalizer()
            for i in range(n):
                s = ft.Session(date=f"d{i}", start_hour=9, caffeine_3h=False, drowsy_med=False,
                               sleep_bin=BINS[rng.integers(0, 4)], fatigue_pre=int(rng.integers(1, 6)))
                R, _ = p.recommend(s)
                T = T0 + bs * (s.sleep_h - 6.5) - bf * (s.fatigue_pre - 3) + rng.normal(0, 2)
                s.length_min = R
                if T < R and rng.random() > 0.1:                       # 하락 관측 (10%는 놓침)
                    s.onset_min = max(1.0, T + rng.normal(0, 0.5)); s.focus_self = 2
                    s.duration_feel = "길었다" if R - T > 3 else "적당했다"
                else:
                    s.headroom = float(np.clip((T - R) / 6, 0, 1.5)); s.focus_self = 4
                    s.duration_feel = "짧았다" if T - R > 5 else "적당했다"
                p.add_session(s)
                if i >= n - 15:
                    err.append(abs(R - (T - 1.5))); over.append(R > T)
    return float(np.mean(err)), float(np.mean(over))


def sim_rest(overrides, seeds=(0, 1, 2), users=40, n=30):
    config.apply(overrides)
    err, short = [], []
    for seed in seeds:
        rng = np.random.default_rng(seed)
        for u in range(users):
            Lstar, adv = rng.choice([2.0, 3.0, 4.0, 5.0, 6.0]), rs.RestAdvisor()
            for i in range(n):
                L, _ = adv.recommend()
                ok = rng.random() < 1 / (1 + np.exp(-(L - Lstar) / 0.6))
                adv.rests.append(rs.Rest(date="d", rest_min=L, rest_feel="적당했다" if ok else "짧았다", success=bool(ok)))
                if i >= n - 15:
                    err.append(abs(L - Lstar)); short.append(L < Lstar)
    return float(np.mean(err)), float(np.mean(short))


STUDY = {
    "안전 여유(분)": (0.75, 3.0), "기본 변경폭(분)": (1.0, 4.0), "직전값 가중치": (0.25, 0.75), "릿지 강도": (0.5, 2.0),
    "회귀 시작 세션 수": (3, 10), "공부 시간 느낌 보정(분)": ({"짧았다": .5, "적당했다": 0, "길었다": -.5}, {"짧았다": 2, "적당했다": 0, "길었다": -2}),
    "여유 보너스(분)": (2.0, 8.0), "여유도 상한": (0.75, 3.0), "늘리는 한도(분)": ((0.5, 2.0), (2.0, 8.0)),
    "줄이는 한도(분)": ((0.5, 2.0), (2.0, 8.0)), "느낌 충돌 시 유지 횟수": (2, 6),
}
REST = {"시작 단계 횟수": (1, 6), "길이별 시험 횟수": (2, 6), "최근 기록 수": (3, 10), "추천 성공률 기준": (0.5, 0.85),
        "재시험 주기": (3, 10), "휴식 느낌 보정(분)": ({"짧았다": .5, "적당했다": 0, "길었다": -.5}, {"짧았다": 2, "적당했다": 0, "길었다": -2})}


def run(table, sim, labels):
    e0, o0 = sim({})
    print(f"기본 설정: {labels[0]} {e0:.2f}분, {labels[1]} {o0:.0%}")
    print(f"| 값 | 절반 쪽 {labels[0]} | 두 배 쪽 {labels[0]} | 절반 쪽 {labels[1]} | 두 배 쪽 {labels[1]} | 판정 |")
    for name, (lo, hi) in table.items():
        (el, ol), (eh, oh) = sim({name: lo}), sim({name: hi})
        sens = max(abs(el - e0), abs(eh - e0)) / e0 > 0.15 or max(abs(ol - o0), abs(oh - o0)) > 0.05
        print(f"| {name} | {el:.2f} ({(el - e0) / e0:+.0%}) | {eh:.2f} ({(eh - e0) / e0:+.0%}) | {ol:.0%} | {oh:.0%} | "
              f"{'민감' if sens else '둔감'} |")
    config.apply({})


if __name__ == "__main__":
    print("[공부 시간 추천]")
    run(STUDY, sim_study, ("오차", "넘김"))
    print("\n[휴식 추천]")
    run(REST, sim_rest, ("오차", "부족"))
