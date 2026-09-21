import { describe, it, expect } from 'vitest';
import { classifyCommand, collectCommandResults, summarizeCommands } from './command-result.js';

describe('classifyCommand', () => {
  it('classifies test commands', () => {
    for (const c of ['go test ./...', 'npm test', 'npx vitest run', 'pytest tests/', 'cargo test']) {
      expect(classifyCommand(c), c).toBe('test');
    }
  });
  it('classifies build commands', () => {
    for (const c of ['go build ./...', 'npm run build', 'vite build', 'cargo build']) {
      expect(classifyCommand(c), c).toBe('build');
    }
  });
  it('classifies lint/format', () => {
    expect(classifyCommand('npm run lint')).toBe('lint');
    expect(classifyCommand('eslint src/')).toBe('lint');
    expect(classifyCommand('gofmt -w .')).toBe('format');
    expect(classifyCommand('prettier --write .')).toBe('format');
  });
  it('classifies git read-only', () => {
    expect(classifyCommand('git status')).toBe('git');
    expect(classifyCommand('git diff HEAD')).toBe('git');
  });
  it('defaults ambiguous to other', () => {
    expect(classifyCommand('rg foo')).toBe('other');
    expect(classifyCommand('')).toBe('other');
    expect(classifyCommand('ls -la')).toBe('other');
  });
});

const bashExec = (command, exitCode, extra = {}) => ({
  type: 'message',
  id: `e-${command}`,
  message: { role: 'bashExecution', command, exitCode, timestamp: 1000, ...extra },
});

const bashTool = (id, command, isError, outText = '') => [
  {
    type: 'message',
    id: `call-${id}`,
    timestamp: '2026-01-01T00:00:00.000Z',
    message: {
      role: 'assistant',
      timestamp: 1000,
      content: [{ type: 'toolCall', id, name: 'bash', arguments: { command } }],
    },
  },
  {
    type: 'message',
    id: `res-${id}`,
    timestamp: '2026-01-01T00:00:02.000Z',
    message: {
      role: 'toolResult',
      toolCallId: id,
      isError,
      timestamp: 2000,
      content: [{ type: 'text', text: outText }],
    },
  },
];

describe('collectCommandResults', () => {
  it('collects bashExecution with exitCode + category', () => {
    const rs = collectCommandResults([bashExec('go test ./...', 0), bashExec('npm run build', 1)]);
    expect(rs).toHaveLength(2);
    expect(rs[0].category).toBe('test');
    expect(rs[0].succeeded).toBe(true);
    expect(rs[1].category).toBe('build');
    expect(rs[1].failed).toBe(true);
    expect(rs[1].source).toBe('bash_execution');
  });

  it('collects bash toolCall→toolResult with exit code + duration', () => {
    const rs = collectCommandResults(bashTool('c1', 'go test', true, 'FAIL\nCommand exited with code 1'));
    expect(rs).toHaveLength(1);
    expect(rs[0].category).toBe('test');
    expect(rs[0].failed).toBe(true);
    expect(rs[0].exitCode).toBe(1);
    expect(rs[0].durationMs).toBe(1000); // 2000-1000
    expect(rs[0].source).toBe('tool_result');
  });

  it('marks cancelled bashExecution', () => {
    const rs = collectCommandResults([bashExec('sleep 99', null, { cancelled: true })]);
    expect(rs[0].cancelled).toBe(true);
    expect(rs[0].failed).toBe(true);
  });

  it('skips toolCalls with no result', () => {
    const rs = collectCommandResults([
      {
        type: 'message',
        message: { role: 'assistant', content: [{ type: 'toolCall', id: 'x', name: 'bash', arguments: { command: 'ls' } }] },
      },
    ]);
    expect(rs).toHaveLength(0);
  });
});

describe('summarizeCommands', () => {
  it('counts recovered vs final failure', () => {
    // fail then succeed → recovered=1, finalFailure=false
    const rs = collectCommandResults([bashExec('go test', 1), bashExec('go test', 0)]);
    const s = summarizeCommands(rs);
    expect(s.failed).toBe(1);
    expect(s.finalFailure).toBe(false);
    expect(s.recoveredErrors).toBe(1);
  });
  it('final failure when last is a failure', () => {
    const rs = collectCommandResults([bashExec('go build', 0), bashExec('go test', 1)]);
    const s = summarizeCommands(rs);
    expect(s.finalFailure).toBe(true);
    expect(s.recoveredErrors).toBe(0);
  });
  it('groups by category', () => {
    const rs = collectCommandResults([bashExec('go test', 0), bashExec('go build', 0), bashExec('npm run lint', 0)]);
    const s = summarizeCommands(rs);
    expect(s.byCategory.test).toHaveLength(1);
    expect(s.byCategory.build).toHaveLength(1);
    expect(s.byCategory.lint).toHaveLength(1);
  });
});
