// Agent:把「/」命令转交给本机的 Claude Code(claude CLI,无头模式)。
// - 任务经 stdin 传入,argv 全静态 → 无命令行注入/引号问题。
// - stream-json 事件流式回调:system(session_id)/assistant(text/thinking/tool_use)/result。
// - 首轮建会话并记下 session_id,之后 --resume 续接,保证上下文连续。
// - abort():用 taskkill 杀整个进程树,实现「^C 及时终止」。
// - 同类工具调用合并:Bash×5、Read×3 等,不堆叠重复行。
const { spawn, execFile } = require('node:child_process');
const { loadConfig } = require('./config.cjs');

const CLAUDE = process.platform === 'win32' ? 'claude.cmd' : 'claude';

let sessionId = null; // 跨「/」命令续接的 Claude 会话
let child = null;
let aborted = false;

function runAgent(task, onToken) {
  return new Promise((resolve) => {
    aborted = false;
    const cfg = loadConfig();
    const args = [
      '-p',
      '--output-format', 'stream-json',
      '--verbose',
      '--permission-mode', 'bypassPermissions', // 完全自主,无护栏(按用户要求)
    ];
    if (cfg.agentModel) args.push('--model', cfg.agentModel);
    if (sessionId) args.push('--resume', sessionId);

    child = spawn(CLAUDE, args, { cwd: cfg.agentCwd, shell: true, windowsHide: true });
    child.stdin.write(task); // 任务走 stdin,避免注入
    child.stdin.end();

    let buf = '';
    let full = '';
    let sawText = false;
    let lastTool = null;   // 上一次工具名称
    let toolCount = 0;     // 连续同类工具已出现多少次(还未刷出)

    function flushTools() {
      if (toolCount <= 0) return;
      const label = `\n🔧 ${lastTool}${toolCount > 1 ? ` ×${toolCount}` : ''}…`;
      onToken(label, 'status');
      toolCount = 0;
    }

    child.stdout.on('data', (chunk) => {
      buf += chunk.toString('utf8');
      let i;
      while ((i = buf.indexOf('\n')) !== -1) {
        const line = buf.slice(0, i).trim();
        buf = buf.slice(i + 1);
        if (!line) continue;
        let ev;
        try { ev = JSON.parse(line); } catch { continue; }
        if (ev.type === 'system' && ev.session_id) {
          sessionId = ev.session_id;
        } else if (ev.type === 'assistant' && ev.message) {
          for (const b of ev.message.content || []) {
            if (b.type === 'text' && b.text) {
              // 文本出现 → 先把积攒的工具标记刷出来,再出内容
              flushTools();
              const piece = (sawText ? '\n' : '') + b.text;
              full += piece;
              sawText = true;
              onToken(piece, 'content');
            } else if (b.type === 'thinking') {
              onToken('', 'reasoning'); // 只提示「思考中」,不堆思维链
            } else if (b.type === 'tool_use') {
              // 连续同名工具合并:不堆叠,切换时刷出
              if (b.name === lastTool) {
                toolCount++;
              } else {
                flushTools();
                lastTool = b.name;
                toolCount = 1;
              }
            }
          }
        } else if (ev.type === 'result' && ev.session_id) {
          // result 前把剩余工具刷干净
          flushTools();
          sessionId = ev.session_id;
        }
      }
    });

    child.on('error', (err) => {
      child = null;
      onToken(`\n(启动 claude 失败:${err.message})`, 'status');
      resolve(full || '(失败)');
    });
    child.on('close', () => {
      child = null;
      // 最后兜底:如有未刷工具标记,补刷
      flushTools();
      if (aborted) resolve(full ? full + '\n(已终止)' : '(已终止)');
      else resolve(full || '(完成,无输出)');
    });
  });
}

// 终止当前 agent 运行(杀进程树)
function abort() {
  if (!child || !child.pid) return;
  aborted = true;
  if (process.platform === 'win32') {
    execFile('taskkill', ['/pid', String(child.pid), '/T', '/F']);
  } else {
    child.kill('SIGINT');
  }
}

// 清空会话续接(供「忘记」用)
function resetSession() { sessionId = null; }

module.exports = { runAgent, abort, resetSession };
