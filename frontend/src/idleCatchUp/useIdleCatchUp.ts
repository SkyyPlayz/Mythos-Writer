/**
 * PLAN-IDLE-CATCH-UP — the shell's host hook for the idle catch-up gate.
 *
 * Purpose: owns window listeners + settings sync; never enqueues jobs itself.
 *
 * - Settings: the gate is configured from the primitive `enabled` / `minutes`
 *   values, so a new settings object with the same values does nothing.
 * - Activity: while `active`, editable `input` / `beforeinput` / `keydown`
 *   (capture, passive) call `gate.noteActivity()`. Pointer, wheel and keys on
 *   non-editable targets never count. Typing stops FURTHER submissions only;
 *   a background scan that already started may finish.
 * - Leaving the shell (`active=false` or unmount) detaches the host. Staged
 *   work stays staged — detach never clears it.
 * - A project switch clears staged work (`vault-switch`), shell or not.
 */

import { useEffect } from 'react';
import { idleCatchUpGate, type IdleCatchUpGate } from './idleCatchUpGate';
import { normalizeIdleCatchUp, type IdleCatchUpSettings } from './settings.aug';

const ACTIVITY_EVENTS = ['input', 'beforeinput', 'keydown'] as const;

/** `HTMLInputElement.type` values that take typed text (empty/unknown normalizes to `text`). */
const TEXT_INPUT_TYPES: ReadonlySet<string> = new Set([
  '',
  'text',
  'search',
  'email',
  'url',
  'tel',
  'password',
  'number',
]);

/** True when an event on `target` is the user typing into something editable. */
export function isEditableTarget(target: EventTarget | null): boolean {
  if (!target || typeof Element === 'undefined' || !(target instanceof Element)) return false;
  if (target instanceof HTMLTextAreaElement) return !target.readOnly && !target.disabled;
  if (target instanceof HTMLInputElement) {
    return TEXT_INPUT_TYPES.has(target.type.toLowerCase()) && !target.readOnly && !target.disabled;
  }
  if (target instanceof HTMLElement && target.isContentEditable) return true;
  // jsdom has no `isContentEditable`; the nearest `contenteditable` ancestor
  // decides, so a `contenteditable="false"` island inside an editor (a TipTap
  // node view) does not count as typing.
  const host = target.closest('[contenteditable]');
  return host !== null && host.getAttribute('contenteditable') !== 'false';
}

export function useIdleCatchUp(
  settings: IdleCatchUpSettings | undefined,
  active: boolean,
  gate: IdleCatchUpGate = idleCatchUpGate,
): void {
  const { enabled, minutes } = normalizeIdleCatchUp(settings);

  // (a) Settings sync — keyed on the values, not the object identity.
  useEffect(() => {
    gate.configure({ enabled, minutes });
  }, [gate, enabled, minutes]);

  // (b) Host + typing listeners, only while the shell is active.
  useEffect(() => {
    if (!active) return undefined;
    const detach = gate.attach();
    const onActivity = (e: Event) => {
      if (isEditableTarget(e.target)) gate.noteActivity();
    };
    const opts: AddEventListenerOptions = { capture: true, passive: true };
    for (const type of ACTIVITY_EVENTS) window.addEventListener(type, onActivity, opts);
    return () => {
      for (const type of ACTIVITY_EVENTS) window.removeEventListener(type, onActivity, opts);
      detach();
    };
  }, [gate, active]);

  // (c) Project switch drops staged work for the old vault, shell or not.
  useEffect(() => {
    const api = (typeof window !== 'undefined' ? window.api : undefined) as Window['api'] | undefined;
    const unsubscribe = api?.onProjectSwitched?.(() => gate.clearStaged('vault-switch'));
    return () => {
      if (typeof unsubscribe === 'function') unsubscribe();
    };
  }, [gate]);
}

/** Root mount: renders nothing; hosts the gate for the main window. */
export function IdleCatchUpRoot({ settings, active }: { settings: AppSettings; active: boolean }): null {
  useIdleCatchUp(settings.idleCatchUp, active);
  return null;
}
