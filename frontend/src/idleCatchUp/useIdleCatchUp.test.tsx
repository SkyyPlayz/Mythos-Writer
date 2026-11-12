// PLAN-IDLE-CATCH-UP — useIdleCatchUp host hook: settings sync, editable-only
// activity listeners, attach/detach lifecycle (staged work is never cleared
// by leaving the shell) and the project-switch clear.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, renderHook } from '@testing-library/react';
import { IdleCatchUpGate, idleCatchUpGate } from './idleCatchUpGate';
import type { IdleCatchUpSettings } from './settings.aug';
import { IdleCatchUpRoot, isEditableTarget, useIdleCatchUp } from './useIdleCatchUp';

type HookProps = { settings: IdleCatchUpSettings | undefined; active: boolean };

let originalApi: unknown;

function makeGate() {
  const gate = new IdleCatchUpGate({ getJobs: () => undefined, getVaultRoot: async () => '/vault' });
  const configure = vi.spyOn(gate, 'configure');
  const noteActivity = vi.spyOn(gate, 'noteActivity');
  const clearStaged = vi.spyOn(gate, 'clearStaged');
  const detach = vi.fn();
  const attach = vi.spyOn(gate, 'attach').mockImplementation(() => detach);
  return { gate, configure, noteActivity, clearStaged, attach, detach };
}

function mount(gate: IdleCatchUpGate, initialProps: HookProps) {
  return renderHook(({ settings, active }: HookProps) => useIdleCatchUp(settings, active, gate), { initialProps });
}

function add<T extends HTMLElement>(el: T): T {
  document.body.appendChild(el);
  return el;
}

beforeEach(() => {
  originalApi = (window as any).api;
});

afterEach(() => {
  cleanup();
  (window as any).api = originalApi;
  document.body.innerHTML = '';
  vi.restoreAllMocks();
});

describe('isEditableTarget', () => {
  it('accepts textareas, text-like inputs and contenteditable content', () => {
    expect(isEditableTarget(document.createElement('textarea'))).toBe(true);
    for (const type of ['text', 'search', 'email', 'url', 'tel', 'password', 'number']) {
      const input = document.createElement('input');
      input.type = type;
      expect(isEditableTarget(input)).toBe(true);
    }
    expect(isEditableTarget(document.createElement('input'))).toBe(true);

    const editor = add(document.createElement('div'));
    editor.setAttribute('contenteditable', 'true');
    const para = document.createElement('p');
    editor.appendChild(para);
    expect(isEditableTarget(editor)).toBe(true);
    expect(isEditableTarget(para)).toBe(true);
  });

  it('rejects read-only / disabled fields, non-text inputs, buttons, body and null', () => {
    const ro = document.createElement('textarea');
    ro.readOnly = true;
    const disabled = document.createElement('input');
    disabled.disabled = true;
    const checkbox = document.createElement('input');
    checkbox.type = 'checkbox';
    const range = document.createElement('input');
    range.type = 'range';
    expect(isEditableTarget(ro)).toBe(false);
    expect(isEditableTarget(disabled)).toBe(false);
    expect(isEditableTarget(checkbox)).toBe(false);
    expect(isEditableTarget(range)).toBe(false);
    expect(isEditableTarget(document.createElement('button'))).toBe(false);
    expect(isEditableTarget(document.body)).toBe(false);
    expect(isEditableTarget(window)).toBe(false);
    expect(isEditableTarget(null)).toBe(false);
  });

  it('treats a contenteditable="false" island inside an editor as not editable', () => {
    const editor = add(document.createElement('div'));
    editor.setAttribute('contenteditable', 'true');
    const island = document.createElement('div');
    island.setAttribute('contenteditable', 'false');
    const chip = document.createElement('span');
    island.appendChild(chip);
    editor.appendChild(island);
    expect(isEditableTarget(island)).toBe(false);
    expect(isEditableTarget(chip)).toBe(false);
  });
});

describe('useIdleCatchUp — settings sync', () => {
  it('configures the gate on mount and again only when a value changes', () => {
    const { gate, configure } = makeGate();
    const { rerender } = mount(gate, { settings: { enabled: true, minutes: 2 }, active: true });
    expect(configure).toHaveBeenCalledTimes(1);
    expect(configure).toHaveBeenLastCalledWith({ enabled: true, minutes: 2 });

    // Same values, new object identity: no reconfigure.
    rerender({ settings: { enabled: true, minutes: 2 }, active: true });
    expect(configure).toHaveBeenCalledTimes(1);

    rerender({ settings: { enabled: true, minutes: 5 }, active: true });
    expect(configure).toHaveBeenCalledTimes(2);
    expect(configure).toHaveBeenLastCalledWith({ enabled: true, minutes: 5 });

    rerender({ settings: { enabled: false, minutes: 5 }, active: true });
    expect(configure).toHaveBeenCalledTimes(3);
    expect(configure).toHaveBeenLastCalledWith({ enabled: false, minutes: 5 });
  });

  it('configures defaults when settings are missing, even while inactive', () => {
    const { gate, configure, attach } = makeGate();
    mount(gate, { settings: undefined, active: false });
    expect(configure).toHaveBeenCalledWith({ enabled: true, minutes: 2 });
    expect(attach).not.toHaveBeenCalled();
  });
});

describe('useIdleCatchUp — activity listeners', () => {
  it('counts keydown / input / beforeinput in a textarea and in contenteditable content', () => {
    const { gate, noteActivity } = makeGate();
    mount(gate, { settings: undefined, active: true });

    const textarea = add(document.createElement('textarea'));
    fireEvent.keyDown(textarea, { key: 'a' });
    expect(noteActivity).toHaveBeenCalledTimes(1);
    fireEvent.input(textarea);
    expect(noteActivity).toHaveBeenCalledTimes(2);
    textarea.dispatchEvent(new Event('beforeinput', { bubbles: true }));
    expect(noteActivity).toHaveBeenCalledTimes(3);

    const editor = add(document.createElement('div'));
    editor.setAttribute('contenteditable', 'true');
    const para = document.createElement('p');
    editor.appendChild(para);
    fireEvent.keyDown(para, { key: 'b' });
    expect(noteActivity).toHaveBeenCalledTimes(4);
  });

  it('ignores keydown on a button or the body, and never counts pointer / wheel', () => {
    const { gate, noteActivity } = makeGate();
    mount(gate, { settings: undefined, active: true });

    const button = add(document.createElement('button'));
    fireEvent.keyDown(button, { key: 'Enter' });
    fireEvent.keyDown(document.body, { key: 'x' });

    const textarea = add(document.createElement('textarea'));
    fireEvent.pointerMove(textarea);
    fireEvent.pointerDown(textarea);
    fireEvent.wheel(textarea);
    fireEvent.mouseMove(document.body);
    expect(noteActivity).not.toHaveBeenCalled();
  });

  it('catches editable keydown even when a handler stops propagation (capture phase)', () => {
    const { gate, noteActivity } = makeGate();
    mount(gate, { settings: undefined, active: true });
    const textarea = add(document.createElement('textarea'));
    textarea.addEventListener('keydown', (e) => e.stopPropagation());
    fireEvent.keyDown(textarea, { key: 'a' });
    expect(noteActivity).toHaveBeenCalledTimes(1);
  });
});

describe('useIdleCatchUp — host lifecycle', () => {
  it('attaches while active; active=false detaches and removes listeners without clearing staged work', () => {
    const { gate, attach, detach, noteActivity, clearStaged } = makeGate();
    const { rerender } = mount(gate, { settings: undefined, active: true });
    expect(attach).toHaveBeenCalledTimes(1);
    expect(detach).not.toHaveBeenCalled();

    rerender({ settings: undefined, active: false });
    expect(detach).toHaveBeenCalledTimes(1);
    expect(clearStaged).not.toHaveBeenCalled();

    const textarea = add(document.createElement('textarea'));
    fireEvent.keyDown(textarea, { key: 'a' });
    expect(noteActivity).not.toHaveBeenCalled();

    rerender({ settings: undefined, active: true });
    expect(attach).toHaveBeenCalledTimes(2);
    fireEvent.keyDown(textarea, { key: 'a' });
    expect(noteActivity).toHaveBeenCalledTimes(1);
  });

  it('unmount detaches; a remount re-attaches', () => {
    const { gate, attach, detach, clearStaged, noteActivity } = makeGate();
    const first = mount(gate, { settings: undefined, active: true });
    first.unmount();
    expect(detach).toHaveBeenCalledTimes(1);
    expect(clearStaged).not.toHaveBeenCalled();

    const textarea = add(document.createElement('textarea'));
    fireEvent.keyDown(textarea, { key: 'a' });
    expect(noteActivity).not.toHaveBeenCalled();

    mount(gate, { settings: undefined, active: true });
    expect(attach).toHaveBeenCalledTimes(2);
    fireEvent.keyDown(textarea, { key: 'a' });
    expect(noteActivity).toHaveBeenCalledTimes(1);
  });

  it('keeps staged items across detach (real gate)', async () => {
    const enqueue = vi.fn(async () => ({ jobId: 'j1' }));
    const gate = new IdleCatchUpGate({
      getJobs: () => ({ enqueue }),
      getVaultRoot: async () => '/vault',
    });
    const { rerender } = renderHook(({ active }: { active: boolean }) => useIdleCatchUp({ enabled: true, minutes: 2 }, active, gate), {
      initialProps: { active: true },
    });
    // The first attach starts idle; typing starts the window so the item waits.
    gate.noteActivity();
    const onStaged = vi.fn();
    void gate.enqueueWhenIdle('manuscript-scan', undefined, { onStaged });
    await vi.waitFor(() => expect(onStaged).toHaveBeenCalled());
    expect(gate.stagedCount()).toBe(1);

    rerender({ active: false });
    expect(gate.stagedCount()).toBe(1);
    expect(enqueue).not.toHaveBeenCalled();
    gate.clearStaged('cleared');
  });
});

describe('useIdleCatchUp — project switch', () => {
  it('clears staged work with vault-switch on project switch and unsubscribes on unmount', () => {
    const switched: Array<() => void> = [];
    const unsubscribe = vi.fn();
    const onProjectSwitched = vi.fn((cb: () => void) => {
      switched.push(cb);
      return unsubscribe;
    });
    (window as any).api = { onProjectSwitched };

    const { gate, clearStaged } = makeGate();
    // Subscribed independent of `active`.
    const { unmount } = mount(gate, { settings: undefined, active: false });
    expect(onProjectSwitched).toHaveBeenCalledTimes(1);

    expect(switched).toHaveLength(1);
    switched[0]();
    expect(clearStaged).toHaveBeenCalledWith('vault-switch');

    unmount();
    expect(unsubscribe).toHaveBeenCalledTimes(1);
  });

  it('does not throw when window.api or onProjectSwitched is missing', () => {
    const { gate } = makeGate();
    (window as any).api = undefined;
    expect(() => mount(gate, { settings: undefined, active: true }).unmount()).not.toThrow();
    (window as any).api = {};
    expect(() => mount(gate, { settings: undefined, active: true }).unmount()).not.toThrow();
  });
});

describe('IdleCatchUpRoot', () => {
  it('renders nothing and configures the window gate from settings.idleCatchUp', () => {
    const configure = vi.spyOn(idleCatchUpGate, 'configure').mockImplementation(() => {});
    const attach = vi.spyOn(idleCatchUpGate, 'attach');
    const { container } = render(
      <IdleCatchUpRoot settings={{ idleCatchUp: { enabled: false, minutes: 3 } } as unknown as AppSettings} active={false} />,
    );
    expect(container.innerHTML).toBe('');
    expect(configure).toHaveBeenCalledWith({ enabled: false, minutes: 3 });
    expect(attach).not.toHaveBeenCalled();
  });
});
