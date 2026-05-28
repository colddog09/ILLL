const { app, BrowserWindow, shell, session } = require('electron');
const path = require('path');

// Chrome처럼 보이도록 User Agent 설정 (Google OAuth 차단 방지)
const CHROME_UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';

function createWindow() {
  const win = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 800,
    minHeight: 600,
    title: '오일추',
    icon: path.join(__dirname, 'icon.png'),
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      partition: 'persist:o1chu',   // 로그인 세션 유지
      userAgent: CHROME_UA,
    },
    titleBarStyle: 'default',
    backgroundColor: '#f9fafb',
  });

  win.loadURL('https://o1chu.my', { userAgent: CHROME_UA });

  // Google OAuth 팝업은 앱 내 새 창으로 처리
  win.webContents.setWindowOpenHandler(({ url }) => {
    const isOAuth = url.includes('accounts.google.com') ||
                    url.includes('supabase.co') ||
                    url.startsWith('https://o1chu.my');

    if (isOAuth) {
      // Electron 내부 창으로 열기
      return {
        action: 'allow',
        overrideBrowserWindowOptions: {
          width: 500,
          height: 700,
          webPreferences: {
            nodeIntegration: false,
            contextIsolation: true,
            partition: 'persist:o1chu',
            userAgent: CHROME_UA,
          },
        },
      };
    }

    // 그 외 외부 링크는 기본 브라우저로
    shell.openExternal(url);
    return { action: 'deny' };
  });
}

app.whenReady().then(() => {
  // 세션 UA 전역 설정
  session.fromPartition('persist:o1chu').setUserAgent(CHROME_UA);

  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
