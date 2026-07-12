const { desktopCapturer } = require('electron');
const { execFile } = require('node:child_process');
const { loadConfig } = require('./config.cjs');
const settings = require('./settings.cjs');

// 屏幕感知:取活动窗口标题 + 截图 → 视觉模型分析。
// 结果有缓存(窗口 2s,截图分析 30s),避免频繁调 PowerShell/API。

let activeWindowCache = { text: '', ts: 0 };
let screenCache = { text: '', ts: 0 };
const WINDOW_CACHE_MS = 2000;
const SCREEN_CACHE_MS = 30000;

// 取前台窗口的标题 + 进程名(格式:"标题|进程名"),Windows 专用。
function getActiveWindow() {
  return new Promise((resolve) => {
    if (Date.now() - activeWindowCache.ts < WINDOW_CACHE_MS) {
      return resolve(activeWindowCache.text);
    }
    const ps = `
[Console]::OutputEncoding=[System.Text.Encoding]::UTF8
Add-Type @"
  using System;
  using System.Runtime.InteropServices;
  using System.Text;
  public class U {
    [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
    [DllImport("user32.dll")] public static extern int GetWindowText(IntPtr h, StringBuilder t, int n);
    [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr h, out uint pid);
  }
"@
$h=[U]::GetForegroundWindow();
$b=New-Object System.Text.StringBuilder(256);
[U]::GetWindowText($h,$b,256);
$p=0;[U]::GetWindowThreadProcessId($h,[ref]$p);
$a=(Get-Process -Id $p).ProcessName;
"$b|$a"
`;
    execFile('powershell', ['-NoProfile', '-Command', ps], { timeout: 3000, windowsHide: true, encoding: 'utf-8' }, (err, stdout) => {
      if (err || !stdout) { resolve(''); return; }
      const text = stdout.trim();
      activeWindowCache = { text, ts: Date.now() };
      resolve(text);
    });
  });
}

// 截屏 + 视觉模型分析(豆包 vision 等),返回一句中文描述。
async function captureAndAnalyze(modelOverride) {
  try {
    const sources = await desktopCapturer.getSources({
      types: ['screen'],
      thumbnailSize: { width: 1920, height: 1080 },
    });
    if (!sources.length) return '';

    const cfg = loadConfig();
    const s = settings.getAll();
    // 云端配置:优先设置窗口填的 cloudBaseURL/cloudApiKey,其次 secret.json / 环境变量
    const baseURL = (s.cloudBaseURL || cfg.baseURL || '').replace(/\/+$/, '');
    const apiKey = s.cloudApiKey || cfg.apiKey;
    const model = modelOverride || s.visionModel || cfg.visionModel;
    const quality = s.screenshotQuality ?? 70;
    const prompt = s.screenshotPrompt || '用中文详细描述这张屏幕截图。包括:正在运行的应用程序、打开的窗口标题、大致内容(文字/图片/代码等)、以及当前可能在进行什么操作。描述要具体,直接说,不要前缀。';
    const buf = sources[0].thumbnail.toJPEG(quality);
    const b64 = buf.toString('base64');

    const res = await fetch(`${baseURL}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model,
        messages: [{
          role: 'user',
          content: [
            { type: 'text', text: prompt },
            { type: 'image_url', image_url: { url: `data:image/jpeg;base64,${b64}` } },
          ],
        }],
        max_tokens: 200,
      }),
    });

    if (!res.ok) return '';
    const data = await res.json();
    const text = data.choices?.[0]?.message?.content || '';
    screenCache = { text, ts: Date.now() };
    return text;
  } catch {
    return '';
  }
}

// 取缓存的屏幕分析(不重新截图),过期返回空。
function getCachedAnalysis() {
  if (Date.now() - screenCache.ts < SCREEN_CACHE_MS) return screenCache.text;
  return '';
}

module.exports = { getActiveWindow, captureAndAnalyze, getCachedAnalysis };
