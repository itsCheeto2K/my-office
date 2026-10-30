import { test } from 'node:test';
import assert from 'node:assert/strict';
import { formatAgyPayloadForOffice, formatOfficeResponseForAgy } from '../../hooks/agy-hook.mjs';

test('Antigravity Hook: formatAgyPayloadForOffice converts toolCall to office schema', () => {
  const agyInput = {
    conversationId: 'conv-1234',
    workspacePaths: ['D:\\Project\\Test'],
    toolCall: {
      name: 'run_command',
      args: { CommandLine: 'npm test' }
    }
  };

  const officePayload = formatAgyPayloadForOffice(agyInput);
  assert.equal(officePayload.session_id, 'conv-1234');
  assert.equal(officePayload.tool_name, 'run_command');
  assert.deepEqual(officePayload.tool_input, { CommandLine: 'npm test' });
  assert.equal(officePayload.cwd, 'D:\\Project\\Test');
});

test('Antigravity Hook: formatOfficeResponseForAgy maps allow/deny decisions', () => {
  const allowRes = { hookSpecificOutput: { decision: { behavior: 'allow' } } };
  assert.deepEqual(formatOfficeResponseForAgy(allowRes), { decision: 'allow' });

  const denyRes = { hookSpecificOutput: { decision: { behavior: 'deny', message: 'Denied' } } };
  assert.deepEqual(formatOfficeResponseForAgy(denyRes), { decision: 'deny', reason: 'Denied' });

  const emptyRes = null;
  assert.deepEqual(formatOfficeResponseForAgy(emptyRes), { decision: 'allow' });
});
