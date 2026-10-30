#!/usr/bin/env node
// Antigravity Hook: forwards PreToolUse events from agy to MyOffice for interactive user approval
// In: Antigravity hook stdin JSON
// Out: Antigravity decision stdout JSON { "decision": "allow" | "deny" }

export function formatAgyPayloadForOffice(p) {
  if (!p) return {};
  return {
    session_id: p.conversationId || '',
    tool_name: p.toolCall?.name || 'tool',
    tool_input: p.toolCall?.args || {},
    cwd: (Array.isArray(p.workspacePaths) && p.workspacePaths[0]) ? p.workspacePaths[0] : process.cwd(),
    conversation_id: p.conversationId || ''
  };
}

export function formatOfficeResponseForAgy(res) {
  if (!res) return { decision: 'allow' };
  const d = res.hookSpecificOutput?.decision || res.decision;
  if (d?.behavior === 'deny') {
    return {
      decision: 'deny',
      reason: d.message || 'Denied from MyOffice'
    };
  }
  return { decision: 'allow' };
}

// If invoked as a CLI script
if (process.argv[1] && import.meta.url.endsWith(process.argv[1].replace(/\\/g, '/'))) {
  const port = process.env.OFFICE_PORT || 4310;
  const url = `http://127.0.0.1:${port}/hook/permission`;

  const chunks = [];
  for await (const chunk of process.stdin) {
    chunks.push(chunk);
  }

  let agyInput = null;
  try {
    const raw = Buffer.concat(chunks).toString('utf8');
    if (raw.trim()) agyInput = JSON.parse(raw.trim());
  } catch { /* unparseable */ }

  if (!agyInput) {
    process.stdout.write(JSON.stringify({ decision: 'allow' }));
    process.exit(0);
  }

  const officePayload = formatAgyPayloadForOffice(agyInput);
  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(officePayload),
      signal: AbortSignal.timeout(50000)
    });
    const text = await response.text();
    let resJson = null;
    try { if (text.trim()) resJson = JSON.parse(text.trim()); } catch { /* text */ }
    const out = formatOfficeResponseForAgy(resJson);
    process.stdout.write(JSON.stringify(out));
  } catch {
    // If office is closed or request timed out, fall back to allow
    process.stdout.write(JSON.stringify({ decision: 'allow' }));
  }
}
