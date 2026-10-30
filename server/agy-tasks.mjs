// Antigravity Runner: executes tasks via Antigravity CLI (agy) in background
// Each task runs within its own conversation/brain context in ~/.gemini/antigravity-cli/brain/<conversation_id>
import { spawn, execSync, execFile } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const MAX_TEXT = 4000, MAX_IMAGES = 4, MAX_IMAGE = 3_500_000;

/** Locate agy executable on the system */
export function findAgy() {
  const localApp = process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local');
  const candidates = [
    path.join(localApp, 'agy', 'bin', 'agy.exe'),
    path.join(localApp, 'agy', 'bin', 'agy.cmd'),
    path.join(os.homedir(), '.gemini', 'antigravity-cli', 'bin', 'agy.exe'),
    path.join(os.homedir(), '.gemini', 'antigravity-cli', 'bin', 'agy.cmd'),
  ];

  for (const c of candidates) {
    if (fs.existsSync(c)) return { file: c };
  }

  // Try where.exe or which
  try {
    const cmd = process.platform === 'win32' ? 'where.exe agy' : 'which agy';
    const out = execSync(cmd, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
    const firstLine = out.split(/\r?\n/)[0]?.trim();
    if (firstLine && fs.existsSync(firstLine)) {
      return { file: firstLine };
    }
  } catch { /* not in path */ }

  return null;
}

/** Parses one line of NDJSON from agy stdout */
export function parseStreamLine(line) {
  if (!line || !line.trim()) return null;
  let j;
  try { j = JSON.parse(line.trim()); } catch { return null; }

  if (j.event === 'init') {
    return {
      type: 'init',
      conversationId: j.conversation_id,
      cwd: j.init?.cwd || ''
    };
  }

  if (j.event === 'step_update' && j.step_update) {
    const u = j.step_update;
    if (u.step_type === 'tool') {
      return {
        type: 'tool',
        conversationId: u.conversation_id,
        state: u.state,
        toolName: u.tool_name || u.tool_info?.name || '',
        toolInfo: u.tool_info || null
      };
    }
    if (u.step_type === 'agent_response') {
      return {
        type: 'delta',
        conversationId: u.conversation_id,
        state: u.state,
        delta: u.text_delta || ''
      };
    }
    return {
      type: 'step',
      conversationId: u.conversation_id,
      stepType: u.step_type,
      state: u.state
    };
  }

  if (j.event === 'result') {
    const r = j.result || {};
    return {
      type: 'result',
      conversationId: r.conversation_id || j.conversation_id,
      status: r.status,
      response: r.response || ''
    };
  }

  return null;
}

/**
 * createAgyTasks: Task manager executing agy in background.
 * @param {Object} options
 * @param {string} options.dataDir
 * @param {Function} [options.agyBin]
 * @param {Function} [options.env]
 * @param {Function} [options.onStart]
 * @param {Function} [options.onUpdate]
 * @param {Function} [options.onDone]
 * @param {number} [options.max=5]
 * @param {number} [options.perHour=20]
 */
export function createAgyTasks({
  dataDir,
  agyBin,
  env,
  onStart,
  onUpdate,
  onDone,
  max = 5,
  perHour = 20
}) {
  const running = new Map(); // id -> task
  const recent = [];         // timestamps for rate limiting
  const imgDir = path.join(dataDir, 'task-images');

  const pub = (t) => ({
    id: t.id,
    dir: t.dir,
    text: t.text.slice(0, 200),
    at: t.at,
    from: t.from || null,
    sid: t.sid || t.conversationId || null,
    conversationId: t.conversationId || null,
    tool: t.currentTool || null
  });

  /**
   * Start a task.
   * @param {Object} req { dir, text, images, from }
   */
  function start({ dir, text, images = [], from = null }) {
    text = String(text || '').trim().slice(0, MAX_TEXT);
    if (!text) return { ok: false, code: 'empty' };
    if (running.size >= max) return { ok: false, code: 'busy' };

    const now = Date.now();
    while (recent.length && now - recent[0] > 3600e3) recent.shift();
    if (recent.length >= perHour) return { ok: false, code: 'tooMany' };

    const bin = (agyBin ? agyBin() : null) || findAgy();
    if (!bin || !bin.file) return { ok: false, code: 'noAgy' };

    if (!dir || !fs.existsSync(dir)) return { ok: false, code: 'noDir' };

    const id = `${now.toString(36)}${Math.random().toString(36).slice(2, 6)}`;
    const files = [];

    for (const [i, d] of images.slice(0, MAX_IMAGES).entries()) {
      const m = /^data:image\/(jpeg|png|webp);base64,([A-Za-z0-9+/=]+)$/.exec(String(d || ''));
      if (!m || d.length > MAX_IMAGE) continue;
      fs.mkdirSync(imgDir, { recursive: true });
      const f = path.join(imgDir, `${id}-${i + 1}.${m[1] === 'jpeg' ? 'jpg' : m[1]}`);
      fs.writeFileSync(f, Buffer.from(m[2], 'base64'), { mode: 0o600 });
      files.push(f);
    }

    const prompt = files.length
      ? `${text}\n\nAttached image(s):\n${files.join('\n')}`
      : text;

    const convId = from?.conversationId || from?.sid;
    const args = ['-p', prompt, '--output-format', 'stream-json'];
    if (convId) {
      args.push('--conversation', convId);
    }

    let proc;
    try {
      proc = spawn(bin.file, args, {
        cwd: dir,
        env: env ? env() : process.env,
        stdio: ['ignore', 'pipe', 'pipe'],
        windowsHide: true,
        detached: false
      });
    } catch {
      return { ok: false, code: 'noAgy' };
    }

    const t = {
      id,
      pid: proc.pid,
      proc,
      dir,
      text,
      at: now,
      from,
      sid: convId || null,
      conversationId: convId || null,
      currentTool: null,
      result: '',
      error: '',
      buf: ''
    };

    running.set(id, t);
    recent.push(now);

    proc.stdout.on('data', (chunk) => {
      t.buf += String(chunk);
      let nl;
      while ((nl = t.buf.indexOf('\n')) >= 0) {
        const line = t.buf.slice(0, nl);
        t.buf = t.buf.slice(nl + 1);
        const parsed = parseStreamLine(line);
        if (parsed) {
          if (parsed.type === 'init' && parsed.conversationId) {
            t.conversationId = parsed.conversationId;
            t.sid = parsed.conversationId;
          } else if (parsed.type === 'tool') {
            t.currentTool = parsed.toolName;
          } else if (parsed.type === 'result') {
            t.result = parsed.response;
            if (parsed.status && parsed.status !== 'SUCCESS') {
              t.error = parsed.response || parsed.status;
            }
          }
          onUpdate?.(t, parsed);
        }
      }
      if (t.buf.length > 2e6) t.buf = '';
    });

    proc.stderr.on('data', (chunk) => {
      t.error = String(chunk).trim().split('\n').pop().slice(0, 300);
    });

    proc.on('error', (e) => {
      t.error = String(e.message || e).slice(0, 300);
    });

    proc.on('exit', (code) => {
      running.delete(id);
      if (code && !t.error && !t.result) t.error = `exit ${code}`;
      onDone?.(t);
    });

    onStart?.(t);
    return { ok: true, task: pub(t) };
  }

  /** Stop a running task and all child processes */
  function stop(id) {
    const t = running.get(id);
    if (!t) return false;

    if (process.platform === 'win32') {
      try {
        execFile('taskkill', ['/pid', String(t.pid), '/T', '/F'], () => {});
      } catch {
        try { t.proc.kill(); } catch { /* gone */ }
      }
    } else {
      try {
        process.kill(-t.pid, 'SIGTERM');
      } catch {
        try { t.proc.kill(); } catch { /* gone */ }
      }
    }
    return true;
  }

  return {
    start,
    stop,
    list: () => [...running.values()].map(pub)
  };
}
