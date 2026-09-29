import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  __resetPartnerBusyStoreForTests,
  __setPartnerHandBusyForTests,
  enqueuePartnerMessage,
  getPartnerHandBusy,
  getPartnerMsgQueue,
  runHeartbeatAutomationStub,
  setPartnerDrainHandler,
} from './partnerBusyStore';

describe('partnerBusyStore — Mid-task QUEUED + Heartbeat Run now', () => {
  beforeEach(() => {
    __resetPartnerBusyStoreForTests();
    vi.useFakeTimers();
  });

  it('enqueue only while handBusy', () => {
    expect(enqueuePartnerMessage('hello')).toBe(false);
    __setPartnerHandBusyForTests('archivist');
    expect(enqueuePartnerMessage('hello')).toBe(true);
    expect(getPartnerMsgQueue()).toHaveLength(1);
    expect(getPartnerMsgQueue()[0]?.text).toBe('hello');
  });

  it('Vault cleanup Run now sets busy then drains queue in order', () => {
    const drained: string[] = [];
    setPartnerDrainHandler((items) => {
      drained.push(...items.map((i) => i.text));
    });
    runHeartbeatAutomationStub('dedupe', 'archivist', 100);
    expect(getPartnerHandBusy()).toBe('archivist');
    expect(enqueuePartnerMessage('first')).toBe(true);
    expect(enqueuePartnerMessage('second')).toBe(true);
    vi.advanceTimersByTime(100);
    expect(getPartnerHandBusy()).toBeNull();
    expect(getPartnerMsgQueue()).toHaveLength(0);
    expect(drained).toEqual(['first', 'second']);
  });
});
