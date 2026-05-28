export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();

  const { message, history = [] } = req.body;
  if (!message) return res.status(400).json({ error: 'message required' });

  const SYSTEM = `당신은 "오일추" 앱의 친절한 AI 도우미예요.
오일추는 드래그앤드롭으로 할 일을 날짜에 배치하는 일정 관리 웹앱이에요.
주요 기능: 드래그앤드롭 일정 배치, D-Day 카운터, 구글 캘린더 연동, 클라우드 동기화, 테마샵, PWA 지원, macOS·Windows 앱 다운로드.
사용자가 오일추 사용법이나 기능에 대해 물으면 친절하고 간결하게 한국어로 답해줘.
앱 주소는 o1chu.my, 다운로드는 o1chu.my/download.`;

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
