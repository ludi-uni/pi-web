import { describe, expect, it, afterEach } from 'vitest';
import { render, cleanup } from '@testing-library/svelte';
import ToolCall from './ToolCall.svelte';

afterEach(cleanup);

function model({ entries = [], renderedTools = null } = {}) {
  return { entries, renderedTools };
}

describe('ToolCall', () => {
  it('renders a custom tool as escaped JSON when no pre-rendered HTML exists', () => {
    const call = { id: 'call-1', name: 'custom_tool', arguments: { value: '<x>' } };
    const { container } = render(ToolCall, { props: { call, model: model() } });
    expect(container.querySelector('.tool-name')?.textContent).toBe('custom_tool');
    // textContent decodes entities, so the raw chars appear (proving they were escaped in HTML).
    expect(container.querySelector('pre')?.textContent).toContain('"value": "<x>"');
  });

  it('renders pre-rendered custom-tool HTML', () => {
    const call = { id: 'call-1', name: 'custom_tool', arguments: {} };
    const { container } = render(ToolCall, {
      props: {
        call,
        model: model({ renderedTools: { 'call-1': { callHtml: '<span>custom rendered</span>' } } }),
      },
    });
    expect(container.textContent).toContain('custom rendered');
  });

  it('renders a bash command', () => {
    const call = { id: 'b', name: 'bash', arguments: { command: 'ls -la' } };
    const { container } = render(ToolCall, { props: { call, model: model() } });
    expect(container.querySelector('.tool-command')?.textContent).toContain('ls -la');
  });

  it('renders an ask_user_question card with clickable options', () => {
    const call = {
      id: 'q',
      name: 'ask_user_question',
      arguments: {
        questions: [{ question: 'Pick one', options: [{ label: 'A' }, { label: 'B' }] }],
      },
    };
    const { container } = render(ToolCall, { props: { call, model: model() } });
    expect(container.querySelector('.ask-question-card')).not.toBeNull();
    const opts = container.querySelectorAll('.ask-question-option-action');
    expect(opts.length).toBe(2);
    expect(opts[0].dataset.answer).toBe('A');
  });

  it('renders ask_question question_text payloads', () => {
    const call = {
      id: 'q',
      name: 'ask_question',
      arguments: {
        questions: [
          {
            id: 'action',
            label: 'Action',
            question_text: 'What should I do?',
            options: [{ value: 'keep', label: 'Keep current' }],
            allowOther: false,
          },
        ],
      },
    };
    const { container } = render(ToolCall, { props: { call, model: model() } });
    expect(container.querySelector('.ask-question-text')?.textContent).toContain(
      'What should I do?',
    );
    expect(container.querySelector('.ask-question-header')?.textContent).toBe('Action');
    expect(container.querySelector('.ask-question-option-action')?.dataset.answer).toBe(
      'Keep current',
    );
  });

  it('renders completed ask_question array answers', () => {
    const call = {
      id: 'q',
      name: 'ask_question',
      arguments: {
        questions: [
          {
            id: 'action',
            question_text: 'What should I do?',
            options: [{ value: 'keep', label: 'Keep current' }],
          },
        ],
      },
    };
    const entries = [
      {
        type: 'message',
        id: 'result',
        message: {
          role: 'toolResult',
          toolCallId: 'q',
          content: [],
          details: { answers: [{ id: 'action', value: 'keep', label: 'Keep current' }] },
        },
      },
    ];
    const { container } = render(ToolCall, { props: { call, model: model({ entries }) } });
    expect(container.querySelector('.ask-question-option.selected')?.textContent).toContain(
      'Keep current',
    );
    expect(container.querySelector('.ask-question-answer')?.textContent).toContain('Keep current');
  });

  it('marks multi-select questions as needing submit', () => {
    const call = {
      id: 'q',
      name: 'pi_web_ask_user_question',
      arguments: {
        questions: [{ question: 'Pick many', multiSelect: true, options: [{ label: 'A' }] }],
      },
    };
    const { container } = render(ToolCall, { props: { call, model: model() } });
    expect(container.querySelector('.ask-question-card')?.dataset.needsSubmit).toBe('true');
    expect(container.querySelector('.ask-question-block')?.dataset.multiSelect).toBe('true');
  });

  // ── Mobile per-call collapse ─────────────────────────────────────────────
  // live=false (export/share) or non-mobile → never collapsible.
  // live=true + mobile + success → collapsible; pending/error stay expanded.

  it('does not collapse when live is false (export/share)', () => {
    const call = { id: 'c', name: 'bash', arguments: { command: 'ls' } };
    const entries = [
      {
        type: 'message',
        id: 'r',
        message: {
          role: 'toolResult',
          toolCallId: 'c',
          content: [{ type: 'text', text: 'ok' }],
        },
      },
    ];
    const { container } = render(ToolCall, {
      props: { call, model: model({ entries }), live: false },
    });
    expect(container.querySelector('.tool-execution--collapsible')).toBeNull();
    expect(container.querySelector('.tool-execution')).not.toBeNull();
  });

  it('does not collapse on desktop even when live is true', () => {
    const call = { id: 'c', name: 'bash', arguments: { command: 'ls' } };
    const entries = [
      {
        type: 'message',
        id: 'r',
        message: {
          role: 'toolResult',
          toolCallId: 'c',
          content: [{ type: 'text', text: 'ok' }],
        },
      },
    ];
    const { container } = render(ToolCall, {
      props: { call, model: model({ entries }), live: true },
    });
    // jsdom default viewport is >900px, so isMobileLayout() is false.
    expect(container.querySelector('.tool-execution--collapsible')).toBeNull();
  });

  it('keeps pending tool calls expanded', () => {
    const call = { id: 'c', name: 'bash', arguments: { command: 'ls' } };
    const { container } = render(ToolCall, {
      props: { call, model: model(), live: true },
    });
    // No result → statusClass is 'pending', which must not collapse.
    expect(container.querySelector('.tool-execution--collapsible')).toBeNull();
    expect(container.querySelector('.tool-execution.pending')).not.toBeNull();
  });

  it('keeps error tool calls expanded', () => {
    const call = { id: 'c', name: 'bash', arguments: { command: 'ls' } };
    const entries = [
      {
        type: 'message',
        id: 'r',
        message: {
          role: 'toolResult',
          toolCallId: 'c',
          isError: true,
          content: [{ type: 'text', text: 'failed' }],
        },
      },
    ];
    const { container } = render(ToolCall, {
      props: { call, model: model({ entries }), live: true },
    });
    expect(container.querySelector('.tool-execution--collapsible')).toBeNull();
    expect(container.querySelector('.tool-execution.error')).not.toBeNull();
  });
});
