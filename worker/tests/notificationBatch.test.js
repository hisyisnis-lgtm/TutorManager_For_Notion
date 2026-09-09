import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { sendNotificationBatch } from '../../01_automation/notification_batch.mjs';

const first = Object.freeze({
  key: '1'.repeat(64), to: '01000000001', templateId: 'fixture-template',
  variables: { '#{이름}': '가상학생1', '#{시간}': '14:00' },
});
const second = Object.freeze({
  key: '2'.repeat(64), to: '01000000002', templateId: 'fixture-template',
  variables: { '#{이름}': '가상학생2', '#{시간}': '15:00' },
});
const accepted = Object.freeze({ ok: true, state: 'accepted' });
const rejected = () => Object.assign(new Error('provider-private-response 01000000001 fixture-api-secret'), {
  result: { ok: false, state: 'failed' },
});

function memoryLedger(initial = []) {
  const states = new Map(initial);
  return {
    states,
    get: vi.fn(key => states.get(key)),
    record: vi.fn((key, state) => { states.set(key, state); }),
  };
}

function expectPrivateOutput(error) {
  const output = [String(error || ''), JSON.stringify(error || {}),
    ...['log', 'warn', 'error'].flatMap(method => console[method].mock.calls.map(args => args.map(String).join(' '))),
  ].join('\n');
  for (const value of [first.key, second.key, first.to, second.to, '가상학생', 'fixture-api-secret', 'provider-private-response']) {
    expect(output).not.toContain(value);
  }
}

beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('Unexpected external request'); }));
  for (const method of ['log', 'warn', 'error']) vi.spyOn(console, method).mockImplementation(() => {});
});

afterEach(() => {
  expect(fetch).not.toHaveBeenCalled();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('sendNotificationBatch', () => {
  it('records pending before each POST and returns only confirmed acceptance counts', async () => {
    const ledger = memoryLedger();
    const events = [];
    ledger.record.mockImplementation((key, state) => { events.push(state); ledger.states.set(key, state); });
    const sendKakao = vi.fn(async () => {
      events.push('POST');
      expect(ledger.states.get(first.key)).toBe('pending');
      return accepted;
    });
    const buttons = [{ name: '교재', linkType: 'WL', linkMo: 'https://fixture.invalid/material' }];
    await expect(sendNotificationBatch({ notifications: [{ ...first, buttons }], ledger, sendKakao }))
      .resolves.toEqual({ sent: 1, alreadyAccepted: 0, failed: 0, unknown: 0 });
    expect(events).toEqual(['pending', 'POST', 'accepted']);
    expect(sendKakao).toHaveBeenCalledWith(first.to, first.templateId, first.variables, buttons);
    expect(ledger.states.get(first.key)).toBe('accepted');
    expectPrivateOutput();
  });

  it('continues after rejection and retries only that recipient in the next batch', async () => {
    const ledger = memoryLedger();
    const sendKakao = vi.fn().mockRejectedValueOnce(rejected()).mockResolvedValue(accepted);
    const run = () => sendNotificationBatch({ notifications: [first, second], ledger, sendKakao });
    const failure = await run().then(() => null, error => error);
    expect(failure).toBeInstanceOf(Error);
    expect(failure.counts).toEqual({ sent: 1, alreadyAccepted: 0, failed: 1, unknown: 0 });
    expect(sendKakao).toHaveBeenCalledTimes(2);
    expect(ledger.record.mock.calls).toEqual([
      [first.key, 'pending'], [first.key, 'failed'], [second.key, 'pending'], [second.key, 'accepted'],
    ]);
    expectPrivateOutput(failure);
    sendKakao.mockClear();
    ledger.record.mockClear();
    await expect(run()).resolves.toEqual({ sent: 1, alreadyAccepted: 1, failed: 0, unknown: 0 });
    expect(sendKakao).toHaveBeenCalledTimes(1);
    expect(sendKakao).toHaveBeenCalledWith(first.to, first.templateId, first.variables, undefined);
    expect(ledger.record.mock.calls).toEqual([[first.key, 'pending'], [first.key, 'accepted']]);
  });

  it('records unknown after a lost response and keeps it on hold in the next batch', async () => {
    const ledger = memoryLedger();
    const sendKakao = vi.fn().mockRejectedValueOnce(new Error('ECONNRESET fixture-api-secret')).mockResolvedValue(accepted);
    const run = () => sendNotificationBatch({ notifications: [first, second], ledger, sendKakao });
    const failure = await run().then(() => null, error => error);
    expect(failure.counts).toEqual({ sent: 1, alreadyAccepted: 0, failed: 0, unknown: 1 });
    expect(ledger.states.get(first.key)).toBe('unknown');
    expect(sendKakao).toHaveBeenCalledTimes(2);
    expectPrivateOutput(failure);
    sendKakao.mockClear();
    ledger.record.mockClear();
    await expect(run()).rejects.toMatchObject({ counts: { sent: 0, alreadyAccepted: 1, failed: 0, unknown: 1 } });
    expect(sendKakao).not.toHaveBeenCalled();
    expect(ledger.record).not.toHaveBeenCalled();
  });

  it.each(['pending', 'unknown'])('never POSTs a recovered %s checkpoint', async state => {
    const ledger = memoryLedger([[first.key, state]]);
    const sendKakao = vi.fn().mockResolvedValue(accepted);
    await expect(sendNotificationBatch({ notifications: [first], ledger, sendKakao }))
      .rejects.toMatchObject({ counts: { sent: 0, alreadyAccepted: 0, failed: 0, unknown: 1 } });
    expect(sendKakao).not.toHaveBeenCalled();
    expect(ledger.record).not.toHaveBeenCalled();
    expect(ledger.states.get(first.key)).toBe(state);
  });

  it('skips accepted history and counts each delivery key once even with duplicate recipients', async () => {
    const ledger = memoryLedger([[first.key, 'accepted']]);
    const sendKakao = vi.fn().mockResolvedValue(accepted);
    await expect(sendNotificationBatch({ notifications: [first, first, second, second], ledger, sendKakao }))
      .resolves.toEqual({ sent: 1, alreadyAccepted: 1, failed: 0, unknown: 0 });
    expect(sendKakao).toHaveBeenCalledTimes(1);
    expect(ledger.get).toHaveBeenCalledTimes(2);
    expect(ledger.record.mock.calls).toEqual([[second.key, 'pending'], [second.key, 'accepted']]);
  });

  it('does not immediately retry a duplicate key after its first rejection', async () => {
    const ledger = memoryLedger();
    const sendKakao = vi.fn().mockRejectedValue(rejected());
    await expect(sendNotificationBatch({ notifications: [first, first], ledger, sendKakao }))
      .rejects.toMatchObject({ counts: { sent: 0, alreadyAccepted: 0, failed: 1, unknown: 0 } });
    expect(sendKakao).toHaveBeenCalledTimes(1);
    expect(ledger.record.mock.calls).toEqual([[first.key, 'pending'], [first.key, 'failed']]);
  });

  it('does not POST if writing the pending checkpoint fails', async () => {
    const ledger = memoryLedger();
    const recordFailure = new Error('fixture-ledger-failure');
    ledger.record.mockImplementation(() => { throw recordFailure; });
    const sendKakao = vi.fn().mockResolvedValue(accepted);
    await expect(sendNotificationBatch({ notifications: [first, second], ledger, sendKakao })).rejects.toBe(recordFailure);
    expect(sendKakao).not.toHaveBeenCalled();
    expect(ledger.record.mock.calls).toEqual([[first.key, 'pending']]);
  });

  it('does not turn accepted delivery into failed when its final checkpoint cannot be written', async () => {
    const ledger = memoryLedger();
    const recordFailure = new Error('fixture-ledger-failure');
    ledger.record.mockImplementation((key, state) => {
      if (state === 'accepted') throw recordFailure;
      ledger.states.set(key, state);
    });
    const sendKakao = vi.fn().mockResolvedValue(accepted);
    await expect(sendNotificationBatch({ notifications: [first, second], ledger, sendKakao })).rejects.toBe(recordFailure);
    expect(sendKakao).toHaveBeenCalledTimes(1);
    expect(ledger.record.mock.calls).toEqual([[first.key, 'pending'], [first.key, 'accepted']]);
    expect(ledger.states.get(first.key)).toBe('pending');
    expect(ledger.states.has(second.key)).toBe(false);
  });

  it.each([undefined, null, {}, { ok: true }, { state: 'accepted' }, { ok: false, state: 'failed' }])(
    'holds an unconfirmed resolved result instead of counting it as accepted: %j', async result => {
      const ledger = memoryLedger();
      const sendKakao = vi.fn().mockResolvedValue(result);
      await expect(sendNotificationBatch({ notifications: [first], ledger, sendKakao }))
        .rejects.toMatchObject({ counts: { sent: 0, alreadyAccepted: 0, failed: 0, unknown: 1 } });
      expect(ledger.states.get(first.key)).toBe('unknown');
    },
  );

  it.each(['to', 'templateId'])('counts a missing %s as a recipient failure and continues the remaining recipients', async field => {
    const ledger = memoryLedger();
    const sendKakao = vi.fn(async (to, templateId) => {
      if (!to || !templateId) throw rejected();
      return accepted;
    });
    await expect(sendNotificationBatch({ notifications: [{ ...first, [field]: '' }, second], ledger, sendKakao }))
      .rejects.toMatchObject({ counts: { sent: 1, alreadyAccepted: 0, failed: 1, unknown: 0 } });
    expect(sendKakao).toHaveBeenCalledTimes(2);
    expect(ledger.states.get(first.key)).toBe('failed');
    expect(ledger.states.get(second.key)).toBe('accepted');
  });

  it.each([null, [], {}, { key: 'not-a-key' }, { key: 'g'.repeat(64) }, { key: 'A'.repeat(64) }])(
    'validates the entire list before POSTing when a later item is invalid: %j', async invalid => {
      const ledger = memoryLedger();
      const sendKakao = vi.fn().mockResolvedValue(accepted);
      await expect(sendNotificationBatch({ notifications: [first, invalid], ledger, sendKakao })).rejects.toThrow();
      expect(sendKakao).not.toHaveBeenCalled();
      expect(ledger.get).not.toHaveBeenCalled();
      expect(ledger.record).not.toHaveBeenCalled();
    },
  );

  it('stops on unreadable ledger state without issuing a POST', async () => {
    const ledger = memoryLedger([[first.key, 'unexpected-state']]);
    const sendKakao = vi.fn().mockResolvedValue(accepted);
    await expect(sendNotificationBatch({ notifications: [first], ledger, sendKakao })).rejects.toThrow();
    expect(sendKakao).not.toHaveBeenCalled();
    expect(ledger.record).not.toHaveBeenCalled();
  });

  it('returns an empty summary when there are no recipients', async () => {
    const ledger = memoryLedger();
    const sendKakao = vi.fn().mockResolvedValue(accepted);
    await expect(sendNotificationBatch({ notifications: [], ledger, sendKakao }))
      .resolves.toEqual({ sent: 0, alreadyAccepted: 0, failed: 0, unknown: 0 });
    expect(sendKakao).not.toHaveBeenCalled();
    expect(ledger.get).not.toHaveBeenCalled();
    expectPrivateOutput();
  });
});
