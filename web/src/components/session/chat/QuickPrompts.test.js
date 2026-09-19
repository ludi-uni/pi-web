import { describe, expect, it, vi, afterEach } from 'vitest';
import { render, cleanup, fireEvent } from '@testing-library/svelte';
import QuickPrompts from './QuickPrompts.svelte';

afterEach(cleanup);

describe('QuickPrompts', () => {
  it('renders default prompt chips', () => {
    const { container } = render(QuickPrompts, { props: { textarea: null } });
    const chips = container.querySelectorAll('.quick-prompt-chip');
    expect(chips.length).toBe(5);
    expect(chips[0].textContent.trim()).toBe('続けて');
    expect(chips[1].textContent.trim()).toBe('テストして');
    expect(chips[2].textContent.trim()).toBe('差分を確認');
    expect(chips[3].textContent.trim()).toBe('修正して');
    expect(chips[4].textContent.trim()).toBe('コミットして');
  });

  it('disables chips when textarea is null', () => {
    const { container } = render(QuickPrompts, { props: { textarea: null } });
    const chips = container.querySelectorAll('.quick-prompt-chip');
    for (const chip of chips) {
      expect(chip.disabled).toBe(true);
    }
  });

  it('inserts prompt text into empty textarea', () => {
    const textarea = document.createElement('textarea');
    const { container } = render(QuickPrompts, { props: { textarea } });
    const chip = container.querySelectorAll('.quick-prompt-chip')[1]; // テストして
    fireEvent.click(chip);
    expect(textarea.value).toBe('テストして');
  });

  it('appends prompt to existing text with newline separator', () => {
    const textarea = document.createElement('textarea');
    textarea.value = 'existing text';
    const { container } = render(QuickPrompts, { props: { textarea } });
    const chip = container.querySelectorAll('.quick-prompt-chip')[0]; // 続けて
    fireEvent.click(chip);
    expect(textarea.value).toBe('existing text\n続けて');
  });

  it('does not add extra newline when text already ends with one', () => {
    const textarea = document.createElement('textarea');
    textarea.value = 'existing text\n';
    const { container } = render(QuickPrompts, { props: { textarea } });
    const chip = container.querySelectorAll('.quick-prompt-chip')[0];
    fireEvent.click(chip);
    expect(textarea.value).toBe('existing text\n続けて');
  });

  it('moves cursor to end after insertion', () => {
    const textarea = document.createElement('textarea');
    textarea.value = 'abc';
    const { container } = render(QuickPrompts, { props: { textarea } });
    const chip = container.querySelectorAll('.quick-prompt-chip')[0];
    fireEvent.click(chip);
    expect(textarea.selectionStart).toBe(textarea.value.length);
    expect(textarea.selectionEnd).toBe(textarea.value.length);
  });

  it('dispatches input event so autoResize and updateSendEnabled run', () => {
    const textarea = document.createElement('textarea');
    const onInput = vi.fn();
    textarea.addEventListener('input', onInput);
    const { container } = render(QuickPrompts, { props: { textarea } });
    const chip = container.querySelectorAll('.quick-prompt-chip')[0];
    fireEvent.click(chip);
    expect(onInput).toHaveBeenCalled();
  });

  it('calls onInsert callback with the prompt', () => {
    const textarea = document.createElement('textarea');
    const onInsert = vi.fn();
    const { container } = render(QuickPrompts, { props: { textarea, onInsert } });
    const chip = container.querySelectorAll('.quick-prompt-chip')[2]; // 差分を確認
    fireEvent.click(chip);
    expect(onInsert).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'diff', label: '差分を確認' }),
    );
  });

  it('does not send the form directly', () => {
    const textarea = document.createElement('textarea');
    const form = document.createElement('form');
    form.appendChild(textarea);
    const onSubmit = vi.fn((e) => e.preventDefault());
    form.addEventListener('submit', onSubmit);
    const { container } = render(QuickPrompts, { props: { textarea } });
    const chip = container.querySelectorAll('.quick-prompt-chip')[0];
    fireEvent.click(chip);
    expect(onSubmit).not.toHaveBeenCalled();
  });
});
