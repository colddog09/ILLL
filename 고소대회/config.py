"""FocusWave 설정값 한곳 모음

값마다 근거(source)와 조정 방법(tune)을 적는다. apply()가 각 모듈에 값을 넣는다.
source: 선행연구 / 공개데이터(Mental Attention 34세션으로 맞춤) / 계획서 / 관례 / 가정 / 초기값(근거 없이 정한 값)
tune  : 고정 / 개인자동(사용하면서 개인별로 학습됨) / 수집후공통(데이터 수집 후 모든 사람 공통으로 한 번 정함)
        / 설계선택(정답이 없는 보수성 문제, 7-2-2 비교 실험으로 고르거나 근거와 함께 유지)
"""
P = {}


def p(name, target, value, source, tune, note=""):
    P[name] = dict(target=target, value=value, source=source, tune=tune, note=note)


# ---------------------------------------------------------------- 신호, 집중 점수
p("창 길이(초)", "focus.STEP_S", 2.0, "계획서", "고정", "2초 창")
p("주파수 대역", "features.BANDS3", {"theta": (4.0, 8.0), "alpha": (8.0, 13.0), "beta": (13.0, 22.0)},
  "선행연구", "고정", "Pope 등 1995 대역")
p("역치 비율 EPOC X", "features.DEVICES.epoc_x.k_ratio", 0.40, "공개데이터", "수집후공통",
  "평소 β/α보다 40% 낮으면 저하 후보. 34세션에서 헛탐지 0, 탐지 31/34")
p("역치 비율 FX2", "features.DEVICES.fx2.k_ratio", 0.40, "공개데이터", "수집후공통", "AF3, AF4로 대신 확인한 값")
p("잡음 배수 EPOC X", "features.DEVICES.epoc_x.artifact_factor", 6.0, "초기값", "수집후공통", "창 진폭이 중앙값의 몇 배면 잡음")
p("잡음 배수 FX2", "features.DEVICES.fx2.artifact_factor", 4.0, "초기값", "수집후공통", "이마 전극이라 더 엄격")
p("하락 유지 시간(초)", "focuswave.HOLD_S", 20.0, "계획서", "수집후공통", "계획서 20~30초")
p("판정 방식", "focuswave.DETECT_METHOD", "hybrid", "공개데이터", "수집후공통", "LSTM 후보 + 역치 확인, 헛탐지 0")
p("설문으로 하락 확정", "focuswave.CONFIRM_WITH_SURVEY", True, "계획서", "고정", "계획서 2-나 라벨 정의")
p("설문 역치 조정 시작 세션 수", "focuswave.K_TUNE_MIN", 10, "초기값", "설계선택", "K_SOURCE=survey일 때")
# ---------------------------------------------------------------- LSTM
p("LSTM 입력 길이", "lstm_detector.SEQ", 30, "계획서", "고정", "2초 x 30 = 60초")
p("LSTM 확률 기준", "lstm_detector.THRESH", 0.5, "초기값", "수집후공통")
p("개인 모델 채택 최소 개선", None, 0.02, "초기값", "설계선택", "lstm_detector.Detector.finetune(min_gain)")
# ---------------------------------------------------------------- 권장 공부 시간
p("첫 권장 공부 시간(분)", "fine_tune.Personalizer.INIT_STUDY_MIN", 25.0, "관례", "고정", "뽀모도로")
p("회귀 시작 세션 수", "fine_tune.Personalizer.MIN_SESSIONS_FOR_MODEL", 5, "계획서", "설계선택", "계획서 최근 3~5회")
p("안전 여유(분)", "fine_tune.Personalizer.MARGIN_MIN", 1.5, "계획서", "설계선택", "계획서 1~2분")
p("기본 변경폭(분)", "fine_tune.Personalizer.MAX_STEP_MIN", 2.0, "계획서", "설계선택", "여유도, 이른 정도 정보가 없을 때")
p("직전값 가중치", "fine_tune.Personalizer.ALPHA", 0.5, "초기값", "설계선택", "계획서는 가중평균만 명시")
p("릿지 강도", "fine_tune.Personalizer.RIDGE", 1.0, "초기값", "수집후공통")
p("느낌 충돌 시 유지 횟수", "fine_tune.Personalizer.CONFLICT_HOLD", 3, "초기값", "설계선택")
p("장비 방해 기준", "fine_tune.Personalizer.DISTURB_LOW_CONF", 4, "초기값", "설계선택")
p("장비 방해 세션 비중", "fine_tune.Personalizer.DISTURB_WEIGHT", 0.5, "초기값", "설계선택")
p("정답률 하락 기준", "fine_tune.Personalizer.ACC_DROP", 0.10, "초기값", "수집후공통", "평소보다 10%p 낮으면")
p("정답률 하락 시 보정(분)", "fine_tune.Personalizer.ACC_NUDGE", -1.0, "초기값", "설계선택")
p("공부 시간 느낌 보정(분)", "fine_tune.FEEL_NUDGE", {"짧았다": 1.0, "적당했다": 0.0, "길었다": -1.0}, "초기값", "설계선택")
p("여유 보너스(분)", "fine_tune.HEADROOM_BONUS_MIN", 4.0, "초기값", "수집후공통", "하락 없이 끝났을 때 더 버틸 수 있었던 시간 추정")
p("여유도 상한", "fine_tune.HEADROOM_CAP", 1.5, "초기값", "설계선택")
p("늘리는 한도(분)", "fine_tune.STEP_UP_RANGE", (1.0, 4.0), "초기값", "설계선택")
p("줄이는 한도(분)", "fine_tune.STEP_DOWN_RANGE", (1.0, 4.0), "초기값", "설계선택")
p("수면 구간 중간값(시간)", "fine_tune.SLEEP_BINS", {"5시간 미만": 4.5, "5~6시간": 5.5, "6~7시간": 6.5, "7시간 이상": 7.5},
  "가정", "고정", "설문표 4구간")
p("시간대 경계(시)", "fine_tune.TIME_BOUNDS", (12, 14, 18), "초기값", "고정", "팀 확정 필요")
p("꺾은선 경계", "fine_tune.KNOTS", {"sleep": [0.0], "caffeine": [1.0, 2.0]}, "초기값", "고정")
p("카페인, 타우린 약동학", "fine_tune.PK", {"caffeine": dict(half_life_h=5.0, tmax_h=1.0),
                                       "taurine": dict(half_life_h=1.0, tmax_h=1.5)}, "선행연구", "고정")
# ---------------------------------------------------------------- 휴식
p("휴식 후보(분)", "rest.LENGTHS", [2.0, 4.0, 6.0], "계획서", "고정")
p("시작 휴식(분)", "rest.POMODORO_MIN", 5.0, "관례", "고정", "뽀모도로")
p("시작 단계 횟수", "rest.POMODORO_FIRST", 3, "초기값", "설계선택")
p("길이별 시험 횟수", "rest.MIN_TRIALS", 3, "초기값", "설계선택")
p("최근 기록 수", "rest.RECENT", 5, "계획서", "설계선택", "계획서 최근 3~5회")
p("추천 성공률 기준", "rest.SUCCESS_RATE", 2 / 3, "초기값", "설계선택")
p("재시험 주기", "rest.RETEST_EVERY", 5, "초기값", "설계선택")
p("회복 측정 구간(초)", "rest.WINDOW_S", 60.0, "초기값", "수집후공통")
p("뇌파 회복 기준", "rest.RECOVERY_OK", 0.8, "초기값", "수집후공통")
p("회복 점수 기준", "rest.SCORE_OK", 0.7, "초기값", "수집후공통")
p("피로 누적 보정", "rest.FATIGUE_NUDGE", (2, 1.0), "초기값", "설계선택", "공부 전후 피로 차이 2 이상이면 +1분")
p("휴식 느낌 보정(분)", "rest.FEEL_NUDGE", {"짧았다": 1.0, "적당했다": 0.0, "길었다": -1.0}, "초기값", "설계선택")


def _set(target, value):
    import importlib
    mod, *path = target.split(".")
    obj = importlib.import_module(mod)
    for k in path[:-1]:
        obj = obj[k] if isinstance(obj, dict) else getattr(obj, k)
    if isinstance(obj, dict):
        obj[path[-1]] = value
    else:
        setattr(obj, path[-1], value)


def apply(overrides=None, focuswave_globals=None):
    """설정값을 각 모듈에 넣는다. overrides: {이름: 값}으로 일부만 바꿔 넣기 (민감도 분석용)
    focuswave_globals: focuswave.py를 직접 실행할 때 그 파일의 전역 변수에도 넣기 위함"""
    for name, d in P.items():
        if not d["target"]:
            continue
        v = (overrides or {}).get(name, d["value"])
        if d["target"].startswith("focuswave.") and focuswave_globals is not None:
            focuswave_globals[d["target"].split(".", 1)[1]] = v
        else:
            _set(d["target"], v)


def table():
    """근거별 정리표 (발표, 문서용)"""
    rows = sorted(P.items(), key=lambda kv: ["선행연구", "공개데이터", "계획서", "관례", "가정", "초기값"].index(kv[1]["source"]))
    return "\n".join(f"| {n} | {d['value']} | {d['source']} | {d['tune']} | {d['note']} |" for n, d in rows)


if __name__ == "__main__":
    apply()
    from collections import Counter
    print("근거별 개수:", dict(Counter(d["source"] for d in P.values())))
    print("조정 방법별 개수:", dict(Counter(d["tune"] for d in P.values())))
