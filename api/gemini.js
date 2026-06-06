// /api/gemini — 공개 챗봇 프록시 (비로그인 사용 가능)
// 보호: origin 허용목록 + 입력 길이 제한 + 간이 rate limit
//   ※ 서버리스 특성상 in-memory limit은 best-effort.
//     강한 보호가 필요하면 Vercel KV / Upstash Redis 도입 권장.

const ALLOWED_HOSTS = ['o1chu.my', 'www.o1chu.my', 'planmanager-six.vercel.app', 'localhost', '127.0.0.1'];

function _originOk(req) {
  const ref = req.headers.origin || req.headers.referer || '';
  if (!ref) return false; // 브라우저 요청은 origin/referer가 있어야 함
  try { return ALLOWED_HOSTS.includes(new URL(ref).hostname); }
  catch { return false; }
}

// ── 간이 rate limit (인스턴스 메모리 기준) ──
const _hits = new Map(); // ip -> { count, resetAt }
const LIMIT = 20;        // 분당 요청 수
const WINDOW = 60 * 1000;
function _rateLimited(ip) {
  const now = Date.now();
  const rec = _hits.get(ip);
  if (!rec || now > rec.resetAt) { _hits.set(ip, { count: 1, resetAt: now + WINDOW }); return false; }
  rec.count++;
  return rec.count > LIMIT;
}

const MAX_MSG_LEN = 500;
const MAX_HISTORY = 20;
const MAX_HIST_LEN = 1000;

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();
  if (!_originOk(req)) return res.status(403).json({ error: 'Forbidden' });

  const ip = (req.headers['x-forwarded-for'] || '').split(',')[0].trim() || 'unknown';
  if (_rateLimited(ip)) return res.status(429).json({ error: '요청이 너무 많아요. 잠시 후 다시 시도해주세요.' });

  let { message, history = [] } = req.body || {};
  if (!message || typeof message !== 'string') return res.status(400).json({ error: 'message required' });

  // 입력 길이 제한 (비용·악용 방지)
  message = message.slice(0, MAX_MSG_LEN);
  if (!Array.isArray(history)) history = [];
  history = history.slice(-MAX_HISTORY)
    .filter(h => h && typeof h.text === 'string' && (h.role === 'user' || h.role === 'model'))
    .map(h => ({ role: h.role, text: h.text.slice(0, MAX_HIST_LEN) }));

  const SYSTEM = `당신은 "오일추" 앱의 AI 도우미예요. 오직 오일추 앱에 관한 질문만 답변하세요.
오일추는 드래그앤드롭으로 할 일을 날짜에 배치하는 일정 관리 웹앱이에요. 앱 주소: o1chu.my
주요 기능: 드래그앤드롭 일정 배치, 기한 설정, D-Day 카운터, 구글 캘린더 연동, 클라우드 동기화, 테마샵, 창작마당, PWA/앱 지원.
사용법 안내, 기능 설명, 오류 해결 등 오일추 관련 질문에만 친절하고 간결하게 한국어로 답하세요.
오일추와 무관한 질문(수학 문제, 일반 지식, 코딩, 다른 앱 등)은 "저는 오일추 도우미라서 앱 관련 질문만 답할 수 있어요 😊 오일추 사용법이나 기능에 대해 물어봐 주세요!"라고만 답하세요.`;

  const contents = [
    ...history.map(h => ({ role: h.role, parts: [{ text: h.text }] })),
    { role: 'user', parts: [{ text: message }] }
  ];

  try {
    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${process.env.GEMINI_API_KEY}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          system_instruction: { parts: [{ text: SYSTEM }] },
          contents
        })
      }
    );
    const data = await response.json();
    const text = data.candidates?.[0]?.content?.parts?.[0]?.text ?? '죄송해요, 답변을 생성할 수 없어요.';
    res.json({ text });
  } catch (e) {
    res.status(500).json({ error: '서버 오류가 발생했어요.' });
  }
}
