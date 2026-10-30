import { test } from 'node:test';
import assert from 'node:assert/strict';
import { findAgy, parseStreamLine, createAgyTasks } from '../../server/agy-tasks.mjs';

test('Antigravity runner: findAgy() locates agy executable', () => {
  const agy = findAgy();
  assert.ok(agy, 'agy binary should be located');
  assert.ok(agy.file, 'agy.file should have a path');
});

test('Antigravity runner: parseStreamLine() handles init, step_update and result events', () => {
  const initLine = JSON.stringify({ event: 'init', conversation_id: 'conv-1234-abcd', init: { cwd: 'D:\\Project' } });
  const initParsed = parseStreamLine(initLine);
  assert.equal(initParsed.type, 'init');
  assert.equal(initParsed.conversationId, 'conv-1234-abcd');

  const toolLine = JSON.stringify({
    event: 'step_update',
    step_update: {
      conversation_id: 'conv-1234-abcd',
      state: 'ACTIVE',
      step_type: 'tool',
      tool_name: 'run_command',
      tool_info: { name: 'run_command', parameters: { CommandLine: 'npm test' } }
    }
  });
  const toolParsed = parseStreamLine(toolLine);
  assert.equal(toolParsed.type, 'tool');
  assert.equal(toolParsed.toolName, 'run_command');

  const deltaLine = JSON.stringify({
    event: 'step_update',
    step_update: {
      conversation_id: 'conv-1234-abcd',
      state: 'ACTIVE',
      step_type: 'agent_response',
      text_delta: 'All tests passed!'
    }
  });
  const deltaParsed = parseStreamLine(deltaLine);
  assert.equal(deltaParsed.type, 'delta');
  assert.equal(deltaParsed.delta, 'All tests passed!');

  const resultLine = JSON.stringify({
    event: 'result',
    result: {
      conversation_id: 'conv-1234-abcd',
      status: 'SUCCESS',
      response: 'Done with task!'
    }
  });
  const resultParsed = parseStreamLine(resultLine);
  assert.equal(resultParsed.type, 'result');
  assert.equal(resultParsed.response, 'Done with task!');
});

test('Antigravity runner: createAgyTasks validations', () => {
  const tasks = createAgyTasks({ dataDir: process.cwd() });
  const rEmpty = tasks.start({ dir: process.cwd(), text: '' });
  assert.equal(rEmpty.ok, false);
  assert.equal(rEmpty.code, 'empty');

  const rNoDir = tasks.start({ dir: 'Z:\\NonExistentPathXYZ', text: 'Hello' });
  assert.equal(rNoDir.ok, false);
  assert.equal(rNoDir.code, 'noDir');
});
