"""FocusWave 파인튜닝 (설문표 기준)

공부 시작 전: 기기(EPOC X / FX2), 분야(산술 / 언어 / 논리), 공부 전 피로도(1~5)
공부 시작 전 설문: 1 수면(4구간, 하루 첫 세션만) / 2 최근 3시간 카페인(예/아니오)
                  2-1~2-3 (2번이 예일 때) 무엇을, 몇 개, 몇 분 전에 / 3 졸린 약(예/아니오)
공부 끝난 직후:   4 집중 자가평가(1~5) / 5 흐트러진 시점 / 6 공부 시간 느낌 / 7 피로도(1~5) / 8 장비 방해(1~5)
쉬는 시간 직후:   9~11번은 rest.py에서 처리

권장 시간 예측 (사용자별 릿지 회귀, 기록 5회 이상부터)
  T_hat = w0 + b_sleep*(수면 - 평소 수면) + b_caf*A_caf + b_tau*A_tau + b_med*약 + c_시간대
  A_caf, A_tau: 공부하는 동안 몸에 남은 카페인, 타우린 평균량 (1구획 흡수-배출 모델)
공부 시간 느낌(6번): 짧았다 +1분, 길었다 -1분을 후보에 더한다. 뇌파와 반대인 경우가 3번 연속이면 한 번 유지.
"""
from dataclasses import dataclass, field
from typing import List, Optional

import numpy as np

from scipy.optimize import brentq

from focus import baseline

# ---------------------------------------------------------------- 체내 잔류량
PK = {
    "caffeine": dict(half_life_h=5.0, tmax_h=1.0),   # J Int Soc Sports Nutr (2024): 반감기 약 5시간, 최고점 15~120분
    "taurine": dict(half_life_h=1.0, tmax_h=1.5),    # Ghandforoush-Sattari 등 (2010)
}
# 1회 제공량 기준. 카페인은 식약처 2020년 조사 평균, 타우린은 라벨 값을 등록해야 반영된다.
PRODUCTS = {
    "아메리카노(커피전문점)": dict(caffeine_mg=132.0, taurine_mg=None),
    "캔커피": dict(caffeine_mg=88.2, taurine_mg=None),
    "커피믹스": dict(caffeine_mg=55.8, taurine_mg=None),
    "인스턴트 커피(블랙 2g)": dict(caffeine_mg=54.5, taurine_mg=None),
    "에너지음료(평균)": dict(caffeine_mg=80.2, taurine_mg=None),
    "핫식스 355mL": dict(caffeine_mg=86.0, taurine_mg=1400.0),   # 나무위키 기준, 라벨 확인 필요
}
DEFAULT_INTAKE = ("아메리카노(커피전문점)", 1, 60.0)   # 2번 예인데 상세 답이 없을 때 가정값


def register_product(name, caffeine_mg, taurine_mg=None):
    """목록에 없는 제품을 라벨 보고 직접 등록"""
    PRODUCTS[name] = dict(caffeine_mg=caffeine_mg, taurine_mg=taurine_mg)


def _ka(ke, tmax):
    return brentq(lambda ka: np.log(ka / ke) / (ka - ke) - tmax, ke * 1.0001, 100.0)


def residual(dose_mg, t_h, substance):
    """섭취 후 t_h시간 뒤 체내 잔류량(mg)"""
    p = PK[substance]
    ke = np.log(2) / p["half_life_h"]
    ka = _ka(ke, p["tmax_h"])
    t = np.maximum(np.asarray(t_h, float), 0)
    return dose_mg * ka / (ka - ke) * (np.exp(-ke * t) - np.exp(-ka * t))


@dataclass
class Intake:
    product: str
    count: float
    minutes_before: float       # 공부 시작 몇 분 전에 마셨는지


def residual_at(intakes, t_min, substance):
    """공부 시작 후 t_min(분) 시점들의 잔류량 배열"""
    t = np.asarray(t_min, float)
    total = np.zeros_like(t)
    for it in intakes:
        dose = PRODUCTS[it.product][f"{substance}_mg"]
        if dose:
            total += residual(dose * it.count, (it.minutes_before + t) / 60, substance)
    return total


def mean_residual(intakes, study_min, substance):
    return float(residual_at(intakes, np.linspace(0, max(study_min, 1), 61), substance).mean())

# ---------------------------------------------------------------- 설문 선택지
SLEEP_BINS = {"5시간 미만": 4.5, "5~6시간": 5.5, "6~7시간": 6.5, "7시간 이상": 7.5}  # 구간 중간값(가정)
DRIFT_OPTIONS = ["초반", "중반", "후반", "잘 모르겠음"]
DOMAINS = ["산술", "언어", "논리"]
DEVICE_LIST = ["epoc_x", "fx2"]
FEEL_NUDGE = {"짧았다": +1.0, "적당했다": 0.0, "길었다": -1.0}   # 6번 보정(분), 초기값

# 요인 1단위: 계수 b는 이 단위만큼 바뀔 때 집중 유지 시간이 몇 분 변하는지
UNITS = {"sleep": 1.0, "caffeine": 100.0, "taurine": 1000.0}
UNIT_TEXT = {"sleep": "1시간", "caffeine": "100mg", "taurine": "1000mg"}   # UNITS를 바꾸면 같이 수정

# 구간별 선형(꺾은선): x축을 경계(KNOTS, 위 단위 기준)에서 나누고 구간마다 기울기를 따로 추정한다.
# 특징 max(0, x - 경계)의 계수가 그 경계를 넘을 때 기울기가 바뀌는 양이다. 릿지가 이 변화를 0 쪽으로 당겨
# 기록이 적을 때는 직선에 가깝고, 쌓일수록 꺾이는 모양이 드러난다.
KNOTS = {
    "sleep": [0.0],             # 평소보다 덜 잔 쪽 / 더 잔 쪽
    "caffeine": [1.0, 2.0],     # 잔류 카페인 0~100mg / 100~200mg / 200mg~
}


def hinge_features(var, x):
    """변수 값 x(스칼라 또는 배열) -> {이름: 값} (원래 값 + 경계별 max(0, x - 경계))"""
    out = {var: x}
    for j, k in enumerate(KNOTS.get(var, [])):
        out[f"{var}_h{j}"] = np.maximum(0, np.asarray(x, float) - k)
    return out


def segment_slopes(coef_by_name, var):
    """구간별 기울기 [(구간 시작, 구간 끝, 기울기)]"""
    knots = KNOTS.get(var, [])
    edges = [-np.inf] + knots + [np.inf]
    slope, out = coef_by_name.get(var, 0.0), []
    for j in range(len(edges) - 1):
        if j > 0:
            slope += coef_by_name.get(f"{var}_h{j - 1}", 0.0)
        out.append((edges[j], edges[j + 1], float(slope)))
    return out

# 여유도에 따른 연장 (초기값, 실측 데이터로 조정)
HEADROOM_BONUS_MIN = 4.0     # 여유도 1(끝까지 평소 수준)당 집중 유지 시간에 더하는 분
HEADROOM_CAP = 1.5           # 여유도 상한
STEP_UP_RANGE = (1.0, 4.0)   # 늘어나는 쪽 한도: 여유도 0이면 +1분, 여유도 상한(1.5)이면 +4분
STEP_DOWN_RANGE = (1.0, 4.0) # 줄어드는 쪽 한도: 끝나기 직전 하락이면 -1분, 시작하자마자 하락이면 -4분


def headroom_bonus(r):
    return 0.0 if r is None else HEADROOM_BONUS_MIN * float(np.clip(r, 0, HEADROOM_CAP))


def step_up_limit(base, r):
    """늘어나는 쪽 한도: 여유도 정보가 없으면 기본 base분, 있으면 여유도에 비례해 1~4분"""
    if r is None:
        return base
    lo, hi = STEP_UP_RANGE
    return lo + (hi - lo) * float(np.clip(r, 0, HEADROOM_CAP)) / HEADROOM_CAP


def step_down_limit(base, e):
    """줄어드는 쪽 한도: 이른 정도 e(0~1)가 없으면 기본 base분, 있으면 e에 비례해 1~4분"""
    if e is None:
        return base
    lo, hi = STEP_DOWN_RANGE
    return lo + (hi - lo) * float(np.clip(e, 0, 1))


TIME_GROUPS = ["오전", "점심 직후", "오후", "저녁"]
TIME_BOUNDS = (12, 14, 18)       # 초안


def time_group_of(hour):
    a, b, c = TIME_BOUNDS
    return TIME_GROUPS[0] if hour < a else TIME_GROUPS[1] if hour < b else \
        TIME_GROUPS[2] if hour < c else TIME_GROUPS[3]


# ---------------------------------------------------------------- 기록
@dataclass
class Session:
    date: str                           # 'YYYY-MM-DD', 수면을 같은 날 세션에 재사용
    start_hour: int
    caffeine_3h: bool                   # 2번
    drowsy_med: bool                    # 3번
    intakes: List[Intake] = field(default_factory=list)   # 2-1~2-3번
    sleep_bin: Optional[str] = None     # 1번, 하루 첫 세션만. 비우면 같은 날 값 사용
    device: str = "epoc_x"              # "epoc_x" / "fx2"
    domain: str = "산술"                # "산술" / "언어" / "논리" (세션 태그)
    fatigue_pre: Optional[int] = None   # 공부 전 피로도 1~5 (권장 시간 입력)
    # 공부 후 채워짐
    length_min: float = 0.0
    onset_min: Optional[float] = None
    focus_self: Optional[int] = None    # 4번
    drift_when: Optional[str] = None    # 5번 (4번이 1~3일 때만)
    duration_feel: Optional[str] = None # 6번
    fatigue_post: Optional[int] = None  # 7번 공부 후 피로도. 공부 전과의 차이를 피로 누적으로 사용
    solved: Optional[bool] = None       # 공부 후: 문제를 풀었나요? 아니오면 정답률 항목을 건너뜀
    n_questions: Optional[int] = None   # 예일 때: 푼 문제 수
    n_correct: Optional[int] = None     # 예일 때: 맞은 문제 수
    device_disturb: Optional[int] = None  # 8번
    onset_lstm_s: Optional[float] = None  # LSTM 후보 시점(초), 개인 역치 조정에 사용
    headroom: Optional[float] = None      # 하락 없이 끝났을 때 여유도 r = (마지막 5분 CI 중앙값 - k) / |k|
    drop_depth: Optional[float] = None    # 하락했을 때 깊이 (기록만, 줄이는 폭에는 안 씀)
    E: Optional[np.ndarray] = None
    drop_mask: Optional[np.ndarray] = None
    bad_mask: Optional[np.ndarray] = None
    sleep_h: Optional[float] = None     # 내부에서 채움

    @property
    def time_group(self):
        return time_group_of(self.start_hour)

    @property
    def key(self):
        """평소 값, 역치를 따로 관리하는 단위: (기기, 분야)"""
        return (self.device, self.domain)

    @property
    def accuracy(self):
        """정답률. 문제를 안 풀었거나 답이 없으면 None (해당 항목은 건너뜀)"""
        if not self.solved or not self.n_questions or self.n_correct is None:
            return None
        return float(np.clip(self.n_correct / self.n_questions, 0, 1))

    @property
    def drop_earliness(self):
        """하락이 공부 끝에서 얼마나 멀리 일어났는지 e = (공부한 시간 - 하락 시점) / 공부한 시간, 0~1"""
        if self.onset_min is None or not self.length_min:
            return None
        return float(np.clip((self.length_min - self.onset_min) / self.length_min, 0, 1))

    @property
    def fatigue_delta(self):
        if self.fatigue_pre is None or self.fatigue_post is None:
            return None
        return self.fatigue_post - self.fatigue_pre

    def intake_list(self):
        """2번이 예인데 상세 답이 없으면 가정값(아메리카노 1잔, 60분 전)을 쓴다"""
        if not self.caffeine_3h:
            return []
        return self.intakes or [Intake(*DEFAULT_INTAKE)]

    @property
    def target(self):
        """집중 유지 시간 T: 하락 인정 시 n.
        하락 없이 끝났으면 공부한 시간 + 여유 보너스(끝까지 여유 있게 집중했을수록 더 버틸 수 있었다고 봄)"""
        if self.onset_min is not None:
            return self.onset_min
        return self.length_min + headroom_bonus(self.headroom)

    def drift_matches(self):
        """5번 체감 시점과 뇌파 하락 시점 n이 같은 구간(3등분)인지. 비교 불가면 None"""
        if self.onset_min is None or self.drift_when not in DRIFT_OPTIONS[:3] or not self.length_min:
            return None
        part = DRIFT_OPTIONS[min(2, int(3 * self.onset_min / self.length_min))]
        return part == self.drift_when


# ---------------------------------------------------------------- 파인튜닝
class Personalizer:
    MIN_SESSIONS_FOR_MODEL = 5
    MARGIN_MIN = 1.5
    MAX_STEP_MIN = 2.0
    ALPHA = 0.5
    RIDGE = 1.0
    CONFLICT_HOLD = 3               # 뇌파와 6번 답이 반대인 경우가 연속 몇 번이면 한 번 유지
    DISTURB_LOW_CONF = 4            # 8번이 이 이상이면 신뢰도 낮음
    DISTURB_WEIGHT = 0.5            # 그 세션의 계수 학습 비중 (초기값)
    ACC_DROP = 0.10                 # 평소 정답률보다 이만큼 낮으면 정답률 하락 (초기값)
    ACC_NUDGE = -1.0                # 집중은 유지됐는데 정답률만 떨어졌을 때 다음 권장 시간 보정(분)

    INIT_STUDY_MIN = 25.0           # 기록이 없을 때 첫 권장 공부 시간 (뽀모도로 25분)

    def __init__(self, init_study_min=None):
        self.sessions: List[Session] = []
        self.rec = {}
        self.init = self.INIT_STUDY_MIN if init_study_min is None else init_study_min
        self.coef = self.cols = None
        self.base = {}                  # (기기, 분야) -> (mu, sigma)
        self.calib = {}                 # (기기, 분야 또는 "*") -> 보정 구간 E
        self.conflicts = {}             # (분야, 시간대)별 연속 충돌 횟수
        self.k = {}                     # (기기, 분야) -> 개인 저하 역치 (설문 기반 조정 모드에서 사용)
        self.k_tuned = set()

    # ---- 설문 처리
    def resolve_sleep(self, s: Session):
        if s.sleep_bin is not None:
            s.sleep_h = SLEEP_BINS[s.sleep_bin]
        else:
            same_day = [x for x in self.sessions if x.date == s.date and x.sleep_h is not None]
            s.sleep_h = same_day[-1].sleep_h if same_day else (
                np.mean([x.sleep_h for x in self.sessions]) if self.sessions else 6.5)
        return s

    def set_calibration(self, E_calib, device="epoc_x", domain="*"):
        """보정 구간 E로 (기기, 분야) 평소 값을 정한다. 분야를 안 주면 그 기기의 공통 보정값이 된다."""
        self.calib[(device, domain)] = np.asarray(E_calib, float)
        self.base[(device, domain)] = baseline(self.calib[(device, domain)])

    def baseline_for(self, device, domain):
        """(기기, 분야) 평소 값. 없으면 그 기기의 공통 보정값을 쓴다."""
        for key in ((device, domain), (device, "*")):
            if key in self.base:
                return self.base[key]
        raise ValueError(f"{device} 보정이 필요하다")

    def k_for(self, key, default):
        return self.k.get(key, default)

    def accuracy_baseline(self, domain, before=None, min_n=3):
        """같은 분야의 평소 정답률(중앙값). before 세션 이전 기록만, min_n개 미만이면 None"""
        ses = self.sessions if before is None else self.sessions[:self.sessions.index(before)] if before in self.sessions else self.sessions
        acc = [s.accuracy for s in ses if s.domain == domain and s.accuracy is not None]
        return float(np.median(acc)) if len(acc) >= min_n else None

    def accuracy_dropped(self, s):
        """정답률이 같은 분야 평소보다 ACC_DROP 넘게 낮은지. 비교할 수 없으면 None"""
        base = self.accuracy_baseline(s.domain, before=s)
        return None if (s.accuracy is None or base is None) else s.accuracy < base - self.ACC_DROP

    # ---- 특징
    def _row(self, s, study_min=None):
        sleep_mean = np.mean([x.sleep_h for x in self.sessions])
        L = study_min or s.length_min or self.init
        r = {}
        r.update(hinge_features("sleep", (s.sleep_h - sleep_mean) / UNITS["sleep"]))
        r.update(hinge_features("caffeine", mean_residual(s.intake_list(), L, "caffeine") / UNITS["caffeine"]))
        r.update(hinge_features("taurine", mean_residual(s.intake_list(), L, "taurine") / UNITS["taurine"]))
        r["med"] = float(s.drowsy_med)
        fat = [x.fatigue_pre for x in self.sessions if x.fatigue_pre is not None]
        r["fatigue"] = (s.fatigue_pre - np.mean(fat)) if (s.fatigue_pre is not None and fat) else 0.0
        r = {k: float(v) for k, v in r.items()}
        for g in TIME_GROUPS[1:]:
            r[f"tg_{g}"] = float(s.time_group == g)
        for d in DOMAINS[1:]:                       # 산술을 기준(0)으로 분야별 차이
            r[f"dom_{d}"] = float(s.domain == d)
        r["dev_fx2"] = float(s.device == "fx2")     # 기기 차이 보정
        return r

    def _ridge(self, rows, y, w=None):
        """가중 릿지 회귀. w: 세션별 비중 (8번 장비 방해가 큰 세션은 낮게)"""
        self.cols = list(rows[0])
        X = np.array([[r[c] for c in self.cols] for r in rows])
        Xc = np.c_[np.ones(len(X)), X]
        w = np.ones(len(X)) if w is None else np.asarray(w, float)
        P = self.RIDGE * np.eye(Xc.shape[1]); P[0, 0] = 0
        return np.linalg.solve(Xc.T @ (Xc * w[:, None]) + P, Xc.T @ (np.asarray(y) * w))

    def weight(self, s):
        return self.DISTURB_WEIGHT if (s.device_disturb or 0) >= self.DISTURB_LOW_CONF else 1.0

    def fit(self):
        """계수 b: 세션마다 (조건, 집중 유지 시간 T)를 점으로 보고 가장 잘 맞는 기울기를 구한다.
        수면, 카페인, 타우린, 졸린 약, 시간대는 오직 여기(권장 공부 시간)에만 쓰이고,
        집중 점수, 저하 판정, 역치에는 쓰이지 않는다."""
        self.coef = self._ridge([self._row(s) for s in self.sessions],
                                [s.target for s in self.sessions], [self.weight(s) for s in self.sessions])

    def _x(self, s, study_min=None):
        r = self._row(s, study_min)
        return np.r_[1.0, [r.get(c, 0.0) for c in self.cols]]

    def add_session(self, s: Session):
        self.resolve_sleep(s)
        self.sessions.append(s)
        if len(self.sessions) >= self.MIN_SESSIONS_FOR_MODEL:
            self.fit()
        self._update_baseline()

    def _update_baseline(self):
        """(기기, 분야)마다 보정값 + 그 조합 세션의 저하 아닌, 품질 정상 구간으로 평소 값 재계산"""
        keys = {s.key for s in self.sessions if s.E is not None}
        for key in keys:
            calib = self.calib.get(key, self.calib.get((key[0], "*")))
            E, keep = ([calib], [np.ones(len(calib), bool)]) if calib is not None else ([], [])
            for s in self.sessions:
                if s.key != key or s.E is None:
                    continue
                k = np.ones(len(s.E), bool)
                for m in (s.drop_mask, s.bad_mask):
                    if m is not None:
                        k &= ~m
                E.append(s.E); keep.append(k)
            E, keep = np.concatenate(E), np.concatenate(keep)
            self.base[key] = baseline(E, drop_mask=~keep)

    # ---- 다음 공부 시간
    def recommend(self, planned: Session):
        self.resolve_sleep(planned)
        key = (planned.domain, planned.time_group)      # 계획서의 과목 x 시간대 추천
        prev = self.rec.get(key, self.init)
        same = [s for s in self.sessions if (s.domain, s.time_group) == key]
        if self.coef is not None:
            onset, basis = float(self._x(planned, prev) @ self.coef), "조건 회귀"
        elif same:
            onset, basis = float(np.median([s.target for s in same[-5:]])), f"최근 {min(len(same), 5)}회 중앙값"
        else:
            return prev, dict(basis="데이터 없음, 초기값", confidence="낮음")
        cand = onset - self.MARGIN_MIN
        # 6번 공부 시간 느낌 (같은 시간대 직전 세션)
        feel = same[-1].duration_feel if same else None
        nudge = FEEL_NUDGE.get(feel, 0.0)
        # 집중은 유지(하락 없음)됐는데 정답률만 떨어진 경우: 조금 줄이고 공부 방법 점검을 안내
        acc_flag = bool(same and same[-1].onset_min is None and self.accuracy_dropped(same[-1]))
        if acc_flag:
            nudge += self.ACC_NUDGE
        conflict = nudge * (cand - prev) < 0          # 뇌파는 줄이자, 본인은 늘리자 (또는 반대)
        self.conflicts[key] = self.conflicts.get(key, 0) + 1 if conflict else 0
        held = self.conflicts[key] >= self.CONFLICT_HOLD
        if held:
            new, self.conflicts[key] = prev, 0
        else:
            new = self.ALPHA * prev + (1 - self.ALPHA) * (cand + nudge)
            last = same[-1] if same else None
            up = step_up_limit(self.MAX_STEP_MIN, last.headroom if last and last.onset_min is None else None)
            down = step_down_limit(self.MAX_STEP_MIN, last.drop_earliness if last else None)
            new = float(np.clip(new, prev - down, prev + up))
        self.rec[key] = new
        conf = "높음" if len(same) >= 5 else ("보통" if len(same) >= 3 else "낮음")
        if same and (same[-1].device_disturb or 0) >= self.DISTURB_LOW_CONF:
            conf = "낮음 (장비 방해)"
        return new, dict(basis=basis, predicted_onset=round(onset, 1), candidate=round(cand, 1),
                         feel=feel, nudge=nudge, held_for_trial=held, previous=prev, confidence=conf,
                         last_headroom=None if not same else same[-1].headroom,
                         last_drop_earliness=None if not same else same[-1].drop_earliness,
                         accuracy_note="집중은 유지됐지만 정답률이 평소보다 낮았다. 문제 난이도나 분량, 공부 방법을 점검해 보자."
                         if acc_flag else None)

    # ---- 계수 보여주기
    def _coef_dict(self):
        return dict(zip(self.cols, self.coef[1:]))

    def effects(self):
        """구간별 기울기(분). 예: 잔류 카페인 0~100mg 구간에서 100mg당 몇 분"""
        if self.coef is None:
            return {}
        cd = self._coef_dict()
        fmt = lambda v, var: "-∞" if v == -np.inf else "∞" if v == np.inf else f"{v * UNITS[var]:g}"
        out = {"기본(분)": round(float(self.coef[0]), 2)}
        for var, label in (("sleep", "수면(평소 대비, 시간)"), ("caffeine", "잔류 카페인(mg)"), ("taurine", "잔류 타우린(mg)")):
            for lo, hi, sl in segment_slopes(cd, var):
                out[f"{label} {fmt(lo, var)}~{fmt(hi, var)} 구간, {UNIT_TEXT[var]}당(분)"] = round(sl, 2)
        out["졸린 약 먹은 날(분)"] = round(float(cd["med"]), 2)
        out["공부 전 피로도 1단계당(분)"] = round(float(cd["fatigue"]), 2)
        for d in DOMAINS[1:]:
            out[f"{d} (산술 대비, 분)"] = round(float(cd[f"dom_{d}"]), 2)
        out["FX2 (EPOC X 대비, 분)"] = round(float(cd["dev_fx2"]), 2)
        for g in TIME_GROUPS[1:]:
            out[f"{g} (오전 대비, 분)"] = round(float(cd[f"tg_{g}"]), 2)
        return out

    def explain_effects(self, min_abs_min=0.5, top=3):
        if self.coef is None:
            return [f"기록이 {self.MIN_SESSIONS_FOR_MODEL}회 이상 쌓이면 영향을 보여준다 "
                    f"(현재 {len(self.sessions)}회)."]
        cd, items = self._coef_dict(), []
        dir_ = lambda v: "길어짐" if v > 0 else "짧아짐"
        (_, _, s_less), (_, _, s_more) = segment_slopes(cd, "sleep")
        if abs(s_less) >= min_abs_min:      # 덜 잔 구간: 1시간 덜 자면 -s_less
            items.append((abs(s_less), f"평소보다 1시간 덜 자면 집중이 약 {abs(s_less):.0f}분 {dir_(-s_less)}"))
        if abs(s_more) >= min_abs_min:
            items.append((abs(s_more), f"평소보다 1시간 더 자면 집중이 약 {abs(s_more):.0f}분 {dir_(s_more)}"))
        names = ["100mg까지", "100~200mg 사이", "200mg 넘게"]
        for (lo, hi, sl), nm in zip(segment_slopes(cd, "caffeine"), names):
            if abs(sl) >= min_abs_min:
                items.append((abs(sl), f"몸에 남은 카페인이 {nm}에서는 100mg당 약 {abs(sl):.0f}분 {dir_(sl)}"))
        if abs(cd["fatigue"]) >= min_abs_min:
            items.append((abs(cd["fatigue"]), f"공부 전 피로도가 1단계 높으면 집중이 약 {abs(cd['fatigue']):.0f}분 {dir_(cd['fatigue'])}"))
        if abs(cd["med"]) >= min_abs_min:
            items.append((abs(cd["med"]), f"졸린 약을 먹은 날은 집중이 약 {abs(cd['med']):.0f}분 {dir_(cd['med'])}"))
        items.sort(reverse=True)
        return [t for _, t in items[:top]] or ["아직 뚜렷하게 영향을 주는 요인이 없다."]

    def drift_agreement(self):
        """5번 체감 시점과 뇌파 하락 시점이 맞은 비율 (비교 가능한 세션만)"""
        m = [s.drift_matches() for s in self.sessions]
        m = [x for x in m if x is not None]
        return (sum(m) / len(m), len(m)) if m else (None, 0)


if __name__ == "__main__":
    # 가정한 참값(비선형): 덜 자면 1시간당 -4분, 더 자는 건 1시간당 +0.5분,
    # 잔류 카페인은 100mg까지 100mg당 +3분, 그 이상은 효과 없음, 졸린 약 -3분
    def truth(s, a_caf):
        ds = s.sleep_h - 6.5
        return 20 + (4 * ds if ds < 0 else 0.5 * ds) + 3 * min(a_caf, 1.0) - 3 * s.drowsy_med

    def simulate(n, seed, knots):
        global KNOTS
        KNOTS = knots
        rng = np.random.default_rng(seed)
        p, bins = Personalizer(), list(SLEEP_BINS)
        sess = []
        for i in range(n):
            caf = bool(rng.random() < 0.6)
            intakes = [Intake("아메리카노(커피전문점)", int(rng.integers(1, 4)), float(rng.uniform(10, 150)))] if caf else []
            s = Session(date=f"d{i}", start_hour=[9, 16][i % 2], caffeine_3h=caf, drowsy_med=bool(rng.random() < 0.2),
                        sleep_bin=bins[rng.integers(0, 4)], intakes=intakes, length_min=45)
            p.resolve_sleep(s)
            s.onset_min = float(truth(s, mean_residual(s.intake_list(), 45, "caffeine") / 100) + rng.normal(0, 1.5))
            sess.append(s)
        for s in sess[:n - 10]:
            p.add_session(s)
        err = [abs(float(p._x(s, 45) @ p.coef) - truth(s, mean_residual(s.intake_list(), 45, "caffeine") / 100))
               for s in sess[n - 10:]]
        return p, float(np.mean(err))

    for n in (15, 30, 60):
        _, e_lin = simulate(n, 1, {})
        p, e_pw = simulate(n, 1, {"sleep": [0.0], "caffeine": [1.0, 2.0]})
        print(f"기록 {n - 10:2d}회 학습: 예측 오차 직선 {e_lin:.2f}분 -> 꺾은선 {e_pw:.2f}분")
    print("구간별 기울기:", p.effects())
    print("대시보드:", p.explain_effects())
