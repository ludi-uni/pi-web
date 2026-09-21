import { describe, it, expect } from 'vitest';
import { buildResult, collectSignals } from './result-model.js';

const bashExec = (command, exitCode, cancelled = false) => ({
  type: 'message',
  message: { role: 'bashExecution', command, exitCode, cancelled },
});

const toolCall = (id, name) => ({
  type: 'message',
  message: { role: 'assistant', content: [{ type: 'toolCall', id, name, arguments: {} }] },
});

const toolResult = (toolCallId, isError) => ({
  type: 'message',
  message: { role: 'toolResult', toolCallId, isError, content: [] },
});

const text = (t) => ({
  type: 'message',
  message: { role: 'assistant', content: [{ type: 'text', text: t }] },
});

describe('collectSignals', () => {
  it('collects bashExecution exit codes', () => {
    const s = collectSignals([bashExec('ls', 0), bashExec('make', 1)]);
    expect(s).toHaveLength(2);
    expect(s[0].ok).toBe(true);
    expect(s[1].ok).toBe(false);
  });

  it('collects toolResult isError paired with its call', () => {
    const s = collectSignals([toolCall('c1', 'bash'), toolResult('c1', true)]);
    expect(s).toHaveLength(1);
    expect(s[0].ok).toBe(false);
  });

  it('ignores a toolCall with no result yet', () => {
    const s = collectSignals([toolCall('c1', 'bash')]);
    expect(s).toHaveLength(0);
  });
});

describe('buildResult', () => {
  it('returns unknown when there are no signals and no changes', () => {
    const r = buildResult({ entries: [text('hello')] });
    expect(r.status).toBe('unknown');
    expect(r.hasData).toBe(false);
  });

  it('returns success when commands ran with no failures', () => {
    const r = buildResult({ entries: [bashExec('make', 0), bashExec('go test', 0)] });
    expect(r.status).toBe('success');
    expect(r.commands).toEqual({ total: 2, failed: 0 });
  });

  it('returns failed when the last signal is a failure', () => {
    const r = buildResult({ entries: [bashExec('make', 0), bashExec('go test', 1)] });
    expect(r.status).toBe('failed');
  });

  it('returns partial when an earlier failure recovered', () => {
    const r = buildResult({ entries: [bashExec('go test', 1), bashExec('go test ./ok', 0)] });
    expect(r.status).toBe('partial');
  });

  it('does not infer failure from assistant prose', () => {
    // "the build failed" in text must NOT mark the session failed.
    const r = buildResult({ entries: [text('the build failed badly')] });
    expect(r.status).toBe('unknown');
  });

  it('maps git status fields', () => {
    const r = buildResult({
      entries: [],
      git: { isRepo: true, branch: 'main', changed: 3, insertions: 10, deletions: 2 },
    });
    expect(r.isRepo).toBe(true);
    expect(r.files).toBe(3);
    expect(r.insertions).toBe(10);
    expect(r.deletions).toBe(2);
    // Files changed with no failures → success.
    expect(r.status).toBe('success');
  });

  it('counts tool errors separately', () => {
    const r = buildResult({
      entries: [toolCall('c1', 'bash'), toolResult('c1', true), bashExec('ls', 0)],
    });
    expect(r.toolErrors).toBe(1);
    expect(r.status).toBe('partial');
  });
});
