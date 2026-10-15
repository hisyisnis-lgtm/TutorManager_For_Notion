import { describe, it, expect, vi } from 'vitest';
import { authorizeNotionRequest } from './notionScope.js';
const allowedId = '11111111-1111-1111-1111-111111111111';
const otherId = '22222222-2222-2222-2222-222222222222';
const allowed = new Set([allowedId.replaceAll('-', '')]);
const run = (path, method = 'GET', body, notion = vi.fn()) => {
  const url = new URL(`https://audit.invalid${path}`);
  return authorizeNotionRequest(new Request(url, { method, ...(body ? { body: JSON.stringify(body) } : {}) }), url, notion, allowed);
};
describe('Notion database boundary', () => {
  it.each(['GET', 'PATCH'])('rejects an unrelated page before %s forwarding', async method => {
    const notion = vi.fn().mockResolvedValue({ parent: { database_id: otherId } });
    expect(await run(`/v1/pages/${otherId}`, method, method === 'PATCH' ? { archived: true } : undefined, notion)).toMatchObject({ ok: false, status: 403 });
    expect(notion).toHaveBeenCalledTimes(1);
    expect(notion.mock.calls[0][0]).toBe('GET');
  });
  it.each([{ page_id: allowedId }, { workspace: true }, { database_id: otherId }, { database_id: allowedId, page_id: otherId }])('denies unapproved creation parent %j', async parent => {
    expect(await run('/v1/pages', 'POST', { parent })).toMatchObject({ ok: false, status: 403 });
  });
  it('permits application database queries and owned pages', async () => {
    expect(await run(`/v1/databases/${allowedId}/query`, 'POST', {})).toMatchObject({ ok: true });
    const page = { id: otherId, parent: { database_id: allowedId } };
    expect(await run(`/v1/pages/${otherId}`, 'GET', undefined, vi.fn().mockResolvedValue(page))).toMatchObject({ ok: true, page });
    expect(await run('/v1/pages', 'POST', { parent: { database_id: allowedId } })).toMatchObject({ ok: true });
  });
  it.each(['/v1/pages/anything', `/v1/pages/${allowedId}/properties/secret`, `/v1/databases/${allowedId}/unexpected`, '/v1/blocks'])('rejects unused routes %s', async path => {
    expect(await run(path)).toMatchObject({ ok: false, status: 403 });
  });
  it('protects website financial fields, relationships and deletion on the server while allowing an operation memo',async()=>{
    const page={id:otherId,parent:{database_id:allowedId},properties:{'웹 주문 항목 ID':{id:'webtrace',rich_text:[{text:{content:'fixture-order-item'}}]},'메모':{id:'memo'},'결제 당시 단가':{id:'price'}}};
    for(const body of [{archived:true},{in_trash:true},{properties:{'실제 결제 금액':{number:1}}},{properties:{'환불 금액':{number:100000}}},
      {properties:{'학생':{relation:[]}}},{properties:{price:{number:1}}},{properties:{webtrace:{rich_text:[]}}}]){
      expect(await run(`/v1/pages/${otherId}`,'PATCH',body,vi.fn().mockResolvedValue(page))).toMatchObject({ok:false,status:403});
    }
    expect(await run(`/v1/pages/${otherId}`,'PATCH',{properties:{메모:{rich_text:[{text:{content:'운영 메모'}}]}}},vi.fn().mockResolvedValue(page))).toMatchObject({ok:true});
    expect(await run(`/v1/pages/${otherId}`,'PATCH',{properties:{memo:{rich_text:[]}}},vi.fn().mockResolvedValue(page))).toMatchObject({ok:true});
  });
  it('preserves offline record edits but refuses reserved website metadata through the generic proxy',async()=>{
    const offline={id:otherId,parent:{database_id:allowedId},properties:{'실제 결제 금액':{number:100000}}};
    expect(await run(`/v1/pages/${otherId}`,'PATCH',{properties:{'실제 결제 금액':{number:90000}}},vi.fn().mockResolvedValue(offline))).toMatchObject({ok:true});
    expect(await run(`/v1/pages/${otherId}`,'PATCH',{properties:{'웹 주문 항목 ID':{rich_text:[]}}},vi.fn().mockResolvedValue(offline))).toMatchObject({ok:false,status:403});
    expect(await run('/v1/pages','POST',{parent:{database_id:allowedId},properties:{'웹 주문 항목 ID':{rich_text:[{text:{content:'forged'}}]}}})).toMatchObject({ok:false,status:403});
  });
  it('also protects encoded property IDs on offline rows and generic payment creation',async()=>{
    const page={id:otherId,parent:{database_id:allowedId},properties:{'웹 주문 항목 ID':{id:'web%3Atrace',rich_text:[]}}};
    expect(await run(`/v1/pages/${otherId}`,'PATCH',{properties:{'web:trace':{rich_text:[]}}},vi.fn().mockResolvedValue(page))).toMatchObject({ok:false,status:403});
    const paymentDb='314838fa-f2a6-8154-935b-edd3d2fbea83',url=new URL('https://fixture.invalid/v1/pages');
    const request=new Request(url,{method:'POST',body:JSON.stringify({parent:{database_id:paymentDb},properties:{'web:trace':{rich_text:[]}}})});
    const result=await authorizeNotionRequest(request,url,vi.fn().mockResolvedValue({properties:page.properties}),new Set([paymentDb.replaceAll('-','')]));
    expect(result).toMatchObject({ok:false,status:403});
  });
});


describe('student app and homework changes use the dedicated setting', () => {
  const studentDb = '314838fa-f2a6-8143-a6c7-e59c50f3bbdb';
  const vip = { id: 'D%3D%7DP', type: 'checkbox', checkbox: false };
  const studentAllowed = new Set([studentDb.replaceAll('-', '')]);
  const check = (method, body, notion) => {
    const url = new URL(method === 'POST' ? 'https://fixture.invalid/v1/pages' : 'https://fixture.invalid/v1/pages/' + otherId);
    return authorizeNotionRequest(new Request(url, { method, body: JSON.stringify(body) }), url, notion, studentAllowed);
  };
  it.each(['VIP', 'D%3D%7DP', 'D=}P', 'D%3d%7dP'])('refuses direct student VIP PATCH by name or property ID %s', async key => {
    const page = { id: otherId, parent: { database_id: studentDb }, properties: { VIP: vip } };
    for (const value of key === 'VIP' ? [true] : [true, false]) expect(await check('PATCH', { properties: { [key]: { checkbox: value } } }, vi.fn().mockResolvedValue(page)))
      .toMatchObject({ ok: false, status: 403 });
    expect(await check('PATCH', { properties: { harmless: { id: key, checkbox: true } } }, vi.fn().mockResolvedValue(page)))
      .toMatchObject({ ok: false, status: 403 });
  });
  it.each([true,false])('strips the unchanged legacy VIP %s field while retaining the complete ordinary edit', async enabled => {
    const page={id:otherId,parent:{database_id:studentDb},properties:{VIP:{...vip,checkbox:enabled}}};
    const body={properties:{VIP:{checkbox:enabled},이름:{title:[{text:{content:'수정 학생'}}]},전화번호:{phone_number:'01012345678'}},icon:{type:'emoji',emoji:'📖'}};
    const notion=vi.fn().mockResolvedValue(page),result=await check('PATCH',body,notion);
    expect(result).toMatchObject({ok:true,currentPage:page,body:{properties:{이름:body.properties.이름,전화번호:body.properties.전화번호},icon:body.icon}});
    expect(Object.hasOwn(result.body.properties,'VIP')).toBe(false);
    expect(body.properties.VIP).toEqual({checkbox:enabled});
    // No D1/provision dependency or authority write; the only lookup is the current page.
    expect(notion.mock.calls).toEqual([['GET',`/pages/${otherId}`]]);
  });
  it.each([true,false])('accepts only the optional checkbox type on an unchanged VIP %s field', async enabled => {
    const page={id:otherId,parent:{database_id:studentDb},properties:{VIP:{...vip,checkbox:enabled}}};
    const result=await check('PATCH',{properties:{VIP:{type:'checkbox',checkbox:enabled},메모:{rich_text:[]}}},vi.fn().mockResolvedValue(page));
    expect(result).toMatchObject({ok:true,body:{properties:{메모:{rich_text:[]}}}});
    expect(Object.hasOwn(result.body.properties,'VIP')).toBe(false);
  });
  it('cannot restore VIP or an entitlement revoked after the authorization lookup', async () => {
    const page={id:otherId,parent:{database_id:studentDb},properties:{VIP:{...vip,checkbox:true},메모:{rich_text:[]}}};
    const result=await check('PATCH',{properties:{VIP:{checkbox:true},메모:{rich_text:[{text:{content:'수정 메모'}}]}}},vi.fn().mockResolvedValue(page));
    expect(result.ok).toBe(true);
    // A newer provision OFF wins between lookup and the eventual Notion PATCH.
    const entitlement={allowed:false,revision:8};
    page.properties.VIP.checkbox=false;
    Object.assign(page.properties,result.body.properties);
    expect(page.properties.VIP.checkbox).toBe(false);
    expect(page.properties.메모).toEqual(result.body.properties.메모);
    expect(entitlement).toEqual({allowed:false,revision:8});
  });
  it.each([null,false,[],{},{checkbox:0},{checkbox:'false'},{checkbox:false,type:'rich_text'},
    {checkbox:false,id:'D%3D%7DP'},{checkbox:false,rich_text:[]}])('rejects malformed or extended no-op payload %j', async value => {
    const page={id:otherId,parent:{database_id:studentDb},properties:{VIP:vip}};
    expect(await check('PATCH',{properties:{VIP:value}},vi.fn().mockResolvedValue(page))).toMatchObject({ok:false,status:403});
  });
  it.each(['D%3D%7DP','D=}P','D%3d%7dP','%56IP'])('does not permit a second no-op VIP alias %s', async alias => {
    const page={id:otherId,parent:{database_id:studentDb},properties:{VIP:vip}};
    expect(await check('PATCH',{properties:{VIP:{checkbox:false},[alias]:{checkbox:false}}},vi.fn().mockResolvedValue(page)))
      .toMatchObject({ok:false,status:403});
  });
  it.each([undefined,null,0,'false',{}])('fails closed when the current VIP checkbox is unavailable: %j', async checkbox => {
    const page={id:otherId,parent:{database_id:studentDb},properties:{VIP:{...vip,checkbox}}};
    expect(await check('PATCH',{properties:{VIP:{checkbox:false}}},vi.fn().mockResolvedValue(page))).toMatchObject({ok:false,status:502});
  });
  it('still applies financial metadata and website-ledger guards after stripping a no-op', async () => {
    const page={id:otherId,parent:{database_id:studentDb},properties:{VIP:vip,'웹 주문 항목 ID':{id:'webtrace',rich_text:[]},'결제 당시 단가':{id:'price'}}};
    for(const properties of [{'웹 주문 항목 ID':{rich_text:[]}},{webtrace:{rich_text:[]}},{price:{number:1}}]){
      expect(await check('PATCH',{properties:{VIP:{checkbox:false},...properties}},vi.fn().mockResolvedValue(page)))
        .toMatchObject({ok:false,status:403});
    }
    const traced={...page,properties:{...page.properties,'웹 주문 항목 ID':{id:'webtrace',rich_text:[{text:{content:'fixture-item'}}]}}};
    expect(await check('PATCH',{properties:{VIP:{checkbox:false},메모:{rich_text:[]}},archived:true},vi.fn().mockResolvedValue(traced)))
      .toMatchObject({ok:false,status:403});
  });
  it.each(['VIP', 'D%3D%7DP', 'D=}P'])('allows only false on student creation for %s', async key => {
    const schema = { properties: { VIP: { ...vip, checkbox: {} } } };
    expect(await check('POST', { parent: { database_id: studentDb }, properties: { [key]: { checkbox: true } } }, vi.fn().mockResolvedValue(schema)))
      .toMatchObject({ ok: false, status: 403 });
    expect(await check('POST', { parent: { database_id: studentDb }, properties: { [key]: { checkbox: false } } }, vi.fn().mockResolvedValue(schema)))
      .toMatchObject({ ok: true });
  });
  it('preserves ordinary student edits and creation without VIP', async () => {
    const page = { id: otherId, parent: { database_id: studentDb }, properties: { VIP: vip } };
    expect(await check('PATCH', { properties: { 이름: { title: [{ text: { content: '학생 이름' } }] }, 전화번호: { phone_number: '01012345678' } } }, vi.fn().mockResolvedValue(page)))
      .toMatchObject({ ok: true });
    expect(await check('POST', { parent: { database_id: studentDb }, properties: { 이름: { title: [] } } }, vi.fn().mockResolvedValue({ properties: { VIP: vip } })))
      .toMatchObject({ ok: true });
    expect(await check('POST', { parent: { database_id: studentDb }, properties: {} }, vi.fn().mockResolvedValue({ properties: {} })))
      .toMatchObject({ ok: false, status: 502 });
  });
  it('does not restrict unrelated databases that also have a VIP field', async () => {
    const page = { id: otherId, parent: { database_id: allowedId }, properties: { VIP: vip } };
    expect(await run('/v1/pages/' + otherId, 'PATCH', { properties: { VIP: { checkbox: true } } }, vi.fn().mockResolvedValue(page))).toMatchObject({ ok: true });
    expect(await run('/v1/pages', 'POST', { parent: { database_id: allowedId }, properties: { VIP: { checkbox: true } } })).toMatchObject({ ok: true });
  });
});
