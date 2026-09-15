import { describe, expect, it, vi } from 'vitest';
import { createSolapiReminderClient } from '../../01_automation/solapi_reminder.mjs';

const config = { apiKey: 'fixture-key', apiSecret: 'fixture-secret', pfId: 'fixture-profile' };
const item = { key: 'a'.repeat(64), to: '01000000001', templateId: 'fixture-template',
  variables: { '#{이름}': '가상학생', '#{시간}': '14:30' } };
const copy = value => JSON.parse(JSON.stringify(value));

// This provider is local only. It models group state on the server independently
// of whether its HTTP response reaches the caller.
function provider({ faults = {}, getOverride, sendStatus = 'COMPLETE' } = {}) {
  const groups = new Map();
  const requests = [];
  const added = [];
  let creates = 0;
  let delivered = 0;
  let reads = 0;
  const remaining = Object.fromEntries(Object.entries(faults).map(([name, values]) => [name, [...values]]));
  const fetchImpl = vi.fn(async (raw, options) => {
    const url = new URL(raw);
    if (url.origin !== 'https://api.solapi.com' || options.redirect !== 'manual'
      || !options.headers.Authorization.startsWith('HMAC-SHA256 apiKey=fixture-key,')
      || !options.signal) throw new Error('Unexpected isolated request');
    const path = url.pathname.replace('/messages/v4/groups', '');
    const method = options.method;
    const action = !path && method === 'POST' ? 'create' : path.endsWith('/messages') && method === 'PUT' ? 'add'
      : path.endsWith('/send') && method === 'POST' ? 'send' : method === 'GET' ? 'get' : null;
    if (!action) throw new Error('Unexpected isolated route');
    const body = options.body ? JSON.parse(options.body) : null;
    requests.push({ action, path, body });
    const fault = remaining[action]?.shift();
    if (fault === 'before') throw new Error('ETIMEDOUT private-provider-response fixture-secret 01000000001');
    if (fault === 'reject') return Response.json({ errorCode: 'InvalidParameter' }, { status: 400 });
    if (fault === 'reject-message') return Response.json({ errorCount: 1, resultList: [{ statusCode: '1042' }] });
    if (fault === 'throttle') return Response.json({ errorCode: 'TooManyRequests' }, { status: 429 });
    let result;
    if (action === 'create') {
      const groupId = `G4V${String(++creates).padStart(29, '0')}`;
      result = { groupId, status: 'PENDING', allowDuplicates: body.allowDuplicates, customFields: body.customFields,
        count: { total: 0, registeredSuccess: 0, registeredFailed: 0, sentTotal: 0, sentSuccess: 0,
          sentFailed: 0, sentPending: 0, sentReplacement: 0 } };
      groups.set(groupId, result);
    } else {
      const group = groups.get(path.split('/')[1]);
      if (!group) return Response.json({ errorCode: 'ResourceNotFound' }, { status: 404 });
      if (action === 'get') result = getOverride?.(copy(group), ++reads) ?? group;
      if (action === 'add') {
        if (group.status !== 'PENDING') return Response.json({ errorCode: 'InvalidGroupStatus' }, { status: 400 });
        if (group.count.registeredSuccess === 0) {
          added.push({ groupId: group.groupId, message: body.messages[0] });
          group.count.total++;
          group.count.registeredSuccess++;
        } else {
          group.count.total++;
          group.count.registeredFailed++;
        }
        result = { errorCount: group.count.registeredFailed, resultList: [] };
      }
      if (action === 'send') {
        if (group.status !== 'PENDING') return Response.json({ errorCode: 'AlreadySent' }, { status: 400 });
        if (group.count.registeredSuccess !== 1) throw new Error('Attempted to send an unregistered message');
        delivered++;
        group.status = sendStatus;
        group.count.sentTotal = 1;
        if (sendStatus === 'COMPLETE') group.count.sentSuccess = 1;
        else group.count.sentPending = 1;
        result = group;
      }
    }
    if (fault === 'after') throw new Error('ECONNRESET private-provider-response fixture-secret 01000000001');
    if (fault === 'broken') return new Response('broken-json');
    return Response.json(copy(result));
  });
  return { groups, requests, added, fetchImpl, get creates() { return creates; }, get delivered() { return delivered; } };
}

function sender(api, settings = {}) {
  const sleep = vi.fn(async () => {});
  return { sleep, send: createSolapiReminderClient({ ...config, fetchImpl: api.fetchImpl, sleep, ...settings }) };
}

function checkpoint(initial = null) {
  let groupId = initial;
  return {
    get groupId() { return groupId; },
    saveGroup: vi.fn(id => {
      if (groupId && id !== groupId) throw new Error('Group identity changed');
      groupId = id;
    }),
  };
}

describe('resumable Solapi reminder groups', () => {
  it('checkpoints an empty group before registering and sending one reminder', async () => {
    const api = provider();
    const stored = checkpoint();
    stored.saveGroup.mockImplementation(id => {
      expect(api.added).toHaveLength(0);
      expect(api.delivered).toBe(0);
      expect(api.groups.get(id).count.registeredSuccess).toBe(0);
    });
    const buttons = [{ name: '수업', linkType: 'WL', linkMo: 'https://fixture.invalid/class' }];
    await expect(sender(api).send({ ...item, buttons }, stored)).resolves.toMatchObject({ ok: true, state: 'accepted' });
    expect(stored.saveGroup).toHaveBeenCalledOnce();
    expect(api.creates).toBe(1);
    expect(api.delivered).toBe(1);
    expect(api.added[0].message).toEqual({ to: item.to, kakaoOptions: {
      pfId: config.pfId, templateId: item.templateId, variables: item.variables, buttons,
    } });
    expect(api.requests.map(request => request.action)).toEqual(['create', 'add', 'get', 'send', 'get']);
    expect(api.requests[0].body).toEqual({ allowDuplicates: false, customFields: { notificationKey: item.key } });
  });

  it('retries a send request that never reached the provider, using the same group', async () => {
    const api = provider({ faults: { send: ['before'] } });
    const stored = checkpoint();
    const client = sender(api);
    await expect(client.send(item, stored)).resolves.toMatchObject({ ok: true });
    expect(api.creates).toBe(1);
    expect(api.delivered).toBe(1);
    expect(api.added).toHaveLength(1);
    const sends = api.requests.filter(request => request.action === 'send');
    expect(sends).toHaveLength(2);
    expect(new Set(sends.map(request => request.path)).size).toBe(1);
    expect(client.sleep).toHaveBeenCalledWith(1000);
  });

  it.each(['after', 'broken'])('recovers a %s send response without sending another message', async fault => {
    const api = provider({ faults: { send: [fault] } });
    await expect(sender(api).send(item, checkpoint())).resolves.toMatchObject({ ok: true });
    expect(api.creates).toBe(1);
    expect(api.delivered).toBe(1);
    expect(api.requests.filter(request => request.action === 'send')).toHaveLength(1);
  });

  it('can abandon an unacknowledged empty group because nothing was added or sent', async () => {
    const api = provider({ faults: { create: ['after'] } });
    const stored = checkpoint();
    await expect(sender(api).send(item, stored)).resolves.toMatchObject({ ok: true });
    expect(api.creates).toBe(2);
    expect([...api.groups.values()].map(group => group.count.registeredSuccess)).toEqual([0, 1]);
    expect(stored.saveGroup).toHaveBeenCalledOnce();
    expect(api.delivered).toBe(1);
  });

  it.each(['before', 'after'])('recovers an add request lost %s registration', async fault => {
    const api = provider({ faults: { add: [fault] } });
    await expect(sender(api).send(item, checkpoint())).resolves.toMatchObject({ ok: true });
    expect(api.creates).toBe(1);
    expect(api.added).toHaveLength(1);
    expect(api.delivered).toBe(1);
  });

  it('resumes a saved pending group in a new client after all immediate send attempts failed', async () => {
    const api = provider({ faults: { send: ['before', 'before', 'before'] } });
    const stored = checkpoint();
    await expect(sender(api).send(item, stored)).rejects.toMatchObject({ result: { state: 'unknown' } });
    expect(api.creates).toBe(1);
    expect(api.delivered).toBe(0);
    expect(stored.groupId).toMatch(/^G4V/);
    await expect(sender(api).send(item, stored)).resolves.toMatchObject({ ok: true });
    expect(api.creates).toBe(1);
    expect(api.added).toHaveLength(1);
    expect(api.delivered).toBe(1);
  });

  it('recovers an already accepted group in another client with GET only', async () => {
    const api = provider();
    const stored = checkpoint();
    await sender(api).send(item, stored);
    const before = api.requests.length;
    await expect(sender(api).send(item, stored)).resolves.toMatchObject({ ok: true });
    expect(api.requests.slice(before).map(request => request.action)).toEqual(['get']);
    expect(api.delivered).toBe(1);
  });

  it.each(['SENDING', 'PROCESSING'])('recognises provider handoff in %s without a second send', async sendStatus => {
    const api = provider({ sendStatus });
    const stored = checkpoint();
    await expect(sender(api).send(item, stored)).resolves.toMatchObject({ ok: true, state: 'accepted' });
    await expect(sender(api).send(item, stored)).resolves.toMatchObject({ ok: true });
    expect(api.delivered).toBe(1);
  });

  it('does not register or send when persisting the group ID fails', async () => {
    const api = provider();
    const storageError = new Error('fixture-checkpoint-error');
    await expect(sender(api).send(item, { groupId: null, saveGroup() { throw storageError; } })).rejects.toBe(storageError);
    expect(api.creates).toBe(1);
    expect(api.added).toHaveLength(0);
    expect(api.delivered).toBe(0);
  });

  it('never creates a replacement group when reading a saved group is unavailable', async () => {
    const api = provider({ faults: { send: ['before', 'before', 'before'] } });
    const stored = checkpoint();
    await sender(api).send(item, stored).catch(() => {});
    const readOnlyFailure = vi.fn(async () => { throw new Error('fixture-private-response'); });
    await expect(sender(api, { fetchImpl: readOnlyFailure }).send(item, stored))
      .rejects.toMatchObject({ result: { state: 'unknown' } });
    expect(readOnlyFailure.mock.calls.every(([, options]) => options.method === 'GET')).toBe(true);
    expect(api.creates).toBe(1);
    expect(api.delivered).toBe(0);
  });

  it.each(['foreign-key', 'foreign-group', 'duplicates', 'multiple-registrations', 'missing-counts'])(
    'will not send from an unverified saved group: %s', async defect => {
      const api = provider({ faults: { send: ['before', 'before', 'before'] } });
      const stored = checkpoint();
      await sender(api).send(item, stored).catch(() => {});
      const group = api.groups.get(stored.groupId);
      if (defect === 'foreign-key') group.customFields.notificationKey = 'b'.repeat(64);
      if (defect === 'foreign-group') group.groupId = `G4V${'9'.repeat(29)}`;
      if (defect === 'duplicates') group.allowDuplicates = true;
      if (defect === 'multiple-registrations') group.count.registeredSuccess = 2;
      if (defect === 'missing-counts') delete group.count.sentPending;
      const before = api.requests.length;
      await expect(sender(api).send(item, stored)).rejects.toMatchObject({ result: { state: 'unknown' } });
      expect(api.requests.slice(before).every(request => request.action === 'get')).toBe(true);
      expect(api.delivered).toBe(0);
    },
  );

  it('does not call a completed but failed group successful or create another send', async () => {
    const api = provider({ faults: { send: ['before', 'before', 'before'] } });
    const stored = checkpoint();
    await sender(api).send(item, stored).catch(() => {});
    const group = api.groups.get(stored.groupId);
    group.status = 'COMPLETE';
    group.count.sentTotal = 1;
    group.count.sentFailed = 1;
    await expect(sender(api).send(item, stored)).rejects.toMatchObject({ result: { state: 'failed' } });
    expect(api.creates).toBe(1);
    expect(api.delivered).toBe(0);
  });

  it('retries throttling but reports permanent rejection without exposing provider data', async () => {
    const api = provider({ faults: { create: ['throttle'], add: ['reject'] } });
    const error = await sender(api).send(item, checkpoint()).catch(value => value);
    expect(error.result).toMatchObject({ state: 'failed' });
    expect(api.delivered).toBe(0);
    for (const value of [item.to, item.variables['#{이름}'], config.apiKey, config.apiSecret, 'InvalidParameter']) {
      expect(String(error) + JSON.stringify(error)).not.toContain(value);
    }
  });

  it('recognises message-level rejection inside a successful HTTP add response', async () => {
    const api = provider({ faults: { add: ['reject-message'] } });
    await expect(sender(api).send(item, checkpoint())).rejects.toMatchObject({ result: { state: 'failed' } });
    expect(api.requests.filter(request => request.action === 'add')).toHaveLength(1);
    expect(api.delivered).toBe(0);
  });

  it.each(['to', 'templateId', 'key'])('rejects invalid %s before creating a group', async field => {
    const api = provider();
    await expect(sender(api).send({ ...item, [field]: '' }, checkpoint())).rejects.toMatchObject({ result: { state: 'failed' } });
    expect(api.fetchImpl).not.toHaveBeenCalled();
  });
});
