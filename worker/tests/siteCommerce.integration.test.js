import { beforeEach, afterEach, describe, it, expect, vi } from 'vitest';
import worker from '../src/index.js';
import { signTypedToken } from '../lib/auth.js';
import { recordSitePayment, reconcileSitePayments } from '../lib/siteCommerce.js';
import { SITE_LEDGER_DATABASES } from '../lib/siteNotionSync.js';
import { siteD1 } from './helpers/siteD1.js';

const CLASS='11111111-1111-4111-8111-111111111111',STUDENT='22222222-2222-4222-8222-222222222222';
const ORIGIN='http://localhost:4323',TEACHER_ORIGIN='http://localhost:5173';
const PASSWORD='Synthetic-password-42';
let local,env,teacher,mail,pg,pgCalls,background,loseConfirm,loseCancel,overrideProof;
const ctx={waitUntil:promise=>background.push(promise)};
const cookie=response=>response.headers.get('Set-Cookie')?.split(';')[0];
const send=(path,{method='GET',body,session,admin=false,origin,headers={}}={})=>worker.fetch(new Request(`${ORIGIN}/api/site${path}`,{
  method,headers:{Origin:origin||(admin?TEACHER_ORIGIN:ORIGIN),'CF-Connecting-IP':'198.51.100.21',
    ...(session?.cookie?{Cookie:session.cookie}:{}),...(session?.csrfToken?{'X-CSRF-Token':session.csrfToken}:{}),
    ...(admin?{Authorization:`Bearer ${teacher}`} :{}),...headers},...(body?{body:JSON.stringify(body)}:{})}),env,ctx);
async function member(email='member@fixture.invalid'){
  let response=await send('/session'),session={cookie:cookie(response),...(await response.json())};
  response=await send('/auth/email/request',{method:'POST',session,body:{email}});expect(response.status).toBe(200);
  const requested=await response.json(),code=mail.at(-1).text.match(/\b\d{6}\b/)[0];
  response=await send('/auth/email/verify',{method:'POST',session,body:{challengeId:requested.challengeId,code}});
  const verified=await response.json();
  response=await send('/auth/signup',{method:'POST',session,body:{registrationToken:verified.registrationToken,password:PASSWORD,passwordConfirm:PASSWORD,
    name:'가상 참여자',nickname:'참여자',termsAccepted:true,privacyAccepted:true}});expect(response.status).toBe(201);
  return {cookie:cookie(response),...(await response.json())};
}
async function target(overrides={}){
  const response=await send('/admin/targets',{admin:true,method:'POST',body:{name:'독립 특강',experienceType:'special',classTypeId:CLASS,
    studentRequired:false,timeLedgerMode:'none',unitPrice:0,...overrides}});expect(response.status).toBe(201);return (await response.json()).target;
}
async function issued(session,selected,overrides={}){
  const input={memberId:session.member.id,targetId:selected.id,billingKey:crypto.randomUUID(),billingPeriod:'2026-10',hours:0,amount:100000,
    expiresAt:new Date(Date.now()+86400000).toISOString(),termsVersion:'fixture-terms-v1',refundPolicy:'수업 진행 내역과 사전 안내된 취소·환불 기준에 따라 강사가 확인 후 처리합니다.',...overrides};
  const response=await send('/admin/payment-requests',{admin:true,method:'POST',body:input});expect(response.status).toBe(201);
  return {input,...(await response.json()).request};
}
async function started(session,paymentRequest){
  const input={requestId:paymentRequest.id,idempotencyKey:crypto.randomUUID(),customerName:'가상 참여자',customerPhone:'010-1234-5678',termsVersion:paymentRequest.termsVersion,termsAccepted:true};
  const response=await send('/orders',{method:'POST',session,body:input});expect(response.status).toBe(201);return {input,...(await response.json())};
}
function proof(orderId,amount,paymentKey='fixture-payment-key'){
  return {orderId,paymentKey,mId:'fixture-merchant',currency:'KRW',totalAmount:amount,balanceAmount:amount,status:'DONE',method:'카드',
    approvedAt:'2026-10-07T00:00:00.000Z',cancels:[]};
}
async function confirmed(session,order){
  const input={orderId:order.checkout.orderId,paymentKey:`fixture_${order.order.id}`,amount:order.order.amount};
  const response=await send('/payments/confirm',{method:'POST',session,body:input});expect(response.status).toBe(200);return {input,...(await response.json())};
}
beforeEach(async()=>{
  local=siteD1();mail=[];pg=new Map();pgCalls=[];background=[];loseConfirm=false;loseCancel=false;overrideProof=null;
  env={GAME_DB:local.db,JWT_SECRET:'fixture-teacher-jwt-secret',SITE_SESSION_SECRET:'fixture-site-session-secret-32-characters',
    SITE_PASSWORD_SECRET:'fixture-site-password-secret-32-characters',SITE_ENVIRONMENT:'development',SITE_ORIGIN:ORIGIN,
    SITE_ADMIN_ENABLED:'true',AUTH_PASSWORD:'Synthetic-admin-fixture-42',
    SITE_EMAIL_FROM:'sender@fixture.invalid',SITE_EMAIL:{send:async message=>{mail.push(message);return {messageId:'fixture'};}},
    SITE_TOSS_MODE:'test',SITE_TOSS_CLIENT_KEY:'test_gck_fixture',SITE_TOSS_SECRET_KEY:'test_gsk_fixture',SITE_TOSS_MERCHANT_ID:'fixture-merchant',NOTION_TOKEN:'fixture-only-notion'};
  teacher=await signTypedToken(env.JWT_SECRET,'teacher','teacher',600,{role:'teacher'});
  vi.spyOn(console,'error').mockImplementation(()=>{});
  vi.stubGlobal('fetch',vi.fn(async(raw,options={})=>{
    const url=new URL(raw),method=options.method||'GET';
    if(url.hostname==='api.notion.com'){
      if(url.pathname===`/v1/pages/${CLASS}`)return Response.json({object:'page',id:CLASS,parent:{database_id:SITE_LEDGER_DATABASES.classType},properties:{}});
      if(url.pathname===`/v1/pages/${STUDENT}`)return Response.json({object:'page',id:STUDENT,parent:{database_id:SITE_LEDGER_DATABASES.student},properties:{}});
      if(url.pathname===`/v1/databases/${SITE_LEDGER_DATABASES.payment}`&&method==='GET')return Response.json({properties:{}}); // No remote schema setup: safe needs_setup.
      throw new Error('Unexpected isolated Notion path');
    }
    if(url.hostname!=='api.tosspayments.com')throw new Error('Unmocked network denied');
    const input=options.body?JSON.parse(options.body):null;pgCalls.push({path:url.pathname,method,input,idempotencyKey:options.headers?.['Idempotency-Key']});
    if(url.pathname==='/v1/payments/confirm'&&method==='POST'){
      const data=overrideProof||proof(input.orderId,input.amount,input.paymentKey);pg.set(data.paymentKey,data);
      if(loseConfirm)throw new Error('Fixture response lost after approval');return Response.json(data);
    }
    const cancel=url.pathname.match(/^\/v1\/payments\/([^/]+)\/cancel$/);
    if(cancel&&method==='POST'){
      const key=decodeURIComponent(cancel[1]),current=pg.get(key);
      if(!current)return Response.json({code:'NOT_FOUND_PAYMENT'},{status:404});
      const added={transactionKey:crypto.randomUUID(),cancelAmount:input.cancelAmount,cancelReason:input.cancelReason,canceledAt:'2026-10-07T01:00:00+00:00',cancelStatus:'DONE'};
      const data={...current,cancels:[...current.cancels,added],balanceAmount:current.balanceAmount-input.cancelAmount,
        status:current.balanceAmount===input.cancelAmount?'CANCELED':'PARTIAL_CANCELED'};
      pg.set(key,data);if(loseCancel)throw new Error('Fixture response lost after cancellation');return Response.json(data);
    }
    const get=url.pathname.match(/^\/v1\/payments\/([^/]+)$/);
    if(get&&method==='GET'){
      const key=decodeURIComponent(get[1]);if(pg.has(key))return Response.json(pg.get(key));
      const attempt=local.sqlite.prepare('SELECT * FROM site_payment_attempts WHERE payment_key=?').get(key),order=attempt&&local.sqlite.prepare('SELECT * FROM site_orders WHERE id=?').get(attempt.order_id);
      if(attempt&&order)return Response.json(overrideProof||{...proof(attempt.pg_order_id,order.amount,key),status:'IN_PROGRESS',approvedAt:null});
      return Response.json({code:'NOT_FOUND_PAYMENT'},{status:404});
    }
    throw new Error('Unexpected isolated PG path');
  }));
});
afterEach(async()=>{await Promise.allSettled(background);local.close();vi.unstubAllGlobals();vi.restoreAllMocks();});

describe('website payment ownership and immutable quotes',()=>{
  it('resolves a PG callback reference to the owner internal UUID without exposing it to another member',async()=>{
    const owner=await member(),other=await member('lookup-other@fixture.invalid'),order=await started(owner,await issued(owner,await target()));
    expect(order.checkout.orderId).toMatch(/^site_[a-f0-9]{32}$/);expect(order.checkout.orderId).not.toBe(order.order.id);
    const found=await send(`/orders/${order.checkout.orderId}`,{session:owner});expect(found.status).toBe(200);
    const data=await found.json();expect(data.order.id).toBe(order.order.id);expect(data.order.status).toBe('pending');expect(data.checkout.orderId).toBe(order.checkout.orderId);
    expect((await send(`/orders/${order.checkout.orderId}`,{session:other})).status).toBe(404);
    expect((await send(`/orders/site_${'f'.repeat(32)}`,{session:owner})).status).toBe(404);
    expect((await send(`/orders/${order.checkout.orderId}`)).status).toBe(401);
    expect(pgCalls).toHaveLength(0);expect(data.order).not.toHaveProperty('paymentKey');
  });
  it('lets a verified member pay an instructor-issued special class without creating a Notion student',async()=>{
    const session=await member(),selected=await target(),request=await issued(session,selected),order=await started(session,request);
    expect(order.checkout).toMatchObject({amount:100000,currency:'KRW',customerKey:session.member.customerKey});
    expect(order.checkout.orderId).not.toBe(order.order.id);
    const approved=await confirmed(session,order);await Promise.allSettled(background);
    expect(approved.order).toMatchObject({status:'paid',amount:100000,refundedAmount:0});
    expect(local.sqlite.prepare('SELECT state FROM site_notion_outbox').get().state).toBe('needs_setup');
    expect(local.sqlite.prepare('SELECT COUNT(*) AS total FROM site_payments').get().total).toBe(1);
    expect(fetch.mock.calls.some(([url,init])=>String(url).includes('api.notion.com')&&init.method==='POST')).toBe(false);
    expect(approved.order).not.toHaveProperty('paymentKey');expect(approved.order).not.toHaveProperty('studentId');
    const publicTargets=await (await send('/targets')).json();expect(publicTargets.targets[0]).toEqual({id:selected.id,name:selected.name,experienceType:'special'});
  });
  it('keeps request amounts private and blocks another member, a forged total, missing consent and wrong CSRF before PG calls',async()=>{
    const owner=await member(),other=await member('other@fixture.invalid'),request=await issued(owner,await target());
    expect((await send(`/payment-requests/${request.id}`,{session:other})).status).toBe(404);
    const order=await started(owner,request);
    expect((await send(`/orders/${order.order.id}`,{session:other})).status).toBe(404);
    expect((await send('/payments/confirm',{method:'POST',session:other,body:{orderId:order.checkout.orderId,paymentKey:'fixture',amount:100000}})).status).toBe(404);
    expect((await send('/payments/confirm',{method:'POST',session:owner,body:{orderId:order.checkout.orderId,paymentKey:'fixture',amount:1}})).status).toBe(409);
    expect((await send('/orders',{method:'POST',session:owner,body:{...order.input,termsAccepted:false}})).status).toBe(400);
    expect((await send('/payments/confirm',{method:'POST',session:owner,headers:{'X-CSRF-Token':'forged'},body:{orderId:order.checkout.orderId,paymentKey:'fixture',amount:100000}})).status).toBe(403);
    expect(pgCalls).toHaveLength(0);
    expect((await send('/admin/orders',{session:owner})).status).toBe(401);
    expect((await send('/admin/orders',{admin:true,origin:'https://tiantianchinese.com'})).status).toBe(403);
  });
  it('deduplicates order submission, rejects payload changes and claims a billing key once',async()=>{
    const session=await member(),request=await issued(session,await target()),order=await started(session,request);
    const duplicate=await send('/orders',{method:'POST',session,body:order.input});expect(duplicate.status).toBe(200);
    expect((await duplicate.json()).order.id).toBe(order.order.id);
    expect((await send('/orders',{method:'POST',session,body:{...order.input,customerName:'다른 이름'}})).status).toBe(409);
    expect((await send('/admin/payment-requests',{admin:true,method:'POST',body:request.input})).status).toBe(409);
    expect(local.sqlite.prepare('SELECT COUNT(*) AS total FROM site_orders').get().total).toBe(1);
  });
  it('normalizes the issued expiration timezone before comparing or storing it',async()=>{
    const session=await member(),selected=await target();
    const offsetTime=new Date(Date.now()+86400000+9*60*60*1000).toISOString().replace('Z','+09:00');
    const invoice=await issued(session,selected,{expiresAt:offsetTime});
    expect(invoice.expiresAt).toBe(new Date(offsetTime).toISOString());
    expect((await started(session,invoice)).checkout.amount).toBe(100000);
  });
  it('requires an explicit student link and consistent hours, full rate and discount for regular tuition',async()=>{
    const session=await member(),selected=await target({experienceType:'class',studentRequired:true,timeLedgerMode:'hours',unitPrice:50000});
    const input={memberId:session.member.id,targetId:selected.id,billingKey:crypto.randomUUID(),billingPeriod:'2026-10',hours:2,amount:80000,
      discountRateSnapshot:20,expiresAt:new Date(Date.now()+86400000).toISOString(),termsVersion:'v1',refundPolicy:'수업진행내역과사전안내된취소환불기준을확인하여강사가처리합니다.'};
    expect((await send('/admin/payment-requests',{admin:true,method:'POST',body:input})).status).toBe(409);
    expect((await send(`/admin/members/${session.member.id}/student-link`,{admin:true,method:'POST',body:{studentId:STUDENT}})).status).toBe(200);
    expect((await send('/admin/payment-requests',{admin:true,method:'POST',body:{...input,amount:90000}})).status).toBe(400);
    const accepted=await send('/admin/payment-requests',{admin:true,method:'POST',body:input});expect(accepted.status).toBe(201);
    const row=local.sqlite.prepare('SELECT snapshot FROM site_payment_requests').get();expect(JSON.parse(row.snapshot)).toMatchObject({studentId:STUDENT,unitPriceSnapshot:50000,discountRateSnapshot:20});
  });
  it('fails closed for missing PG setup while existing auth stays usable',async()=>{
    const session=await member(),request=await issued(session,await target());delete env.SITE_TOSS_SECRET_KEY;
    const response=await send('/orders',{method:'POST',session,body:{requestId:request.id,idempotencyKey:crypto.randomUUID(),customerName:'가상 회원',customerPhone:'01012345678',termsVersion:request.termsVersion,termsAccepted:true}});
    expect(response.status).toBe(503);expect(pgCalls).toHaveLength(0);expect((await send('/session',{session})).status).toBe(200);
  });
  it('expires an unused attempt before invoking the PG and retries only a definitively closed order with a valid invoice',async()=>{
    const session=await member(),order=await started(session,await issued(session,await target()));
    local.sqlite.prepare('UPDATE site_payment_attempts SET created_at=?').run('2020-01-01T00:00:00.000Z');
    const response=await send('/payments/confirm',{method:'POST',session,body:{orderId:order.checkout.orderId,paymentKey:'fixture-expired',amount:100000}});
    expect(response.status).toBe(410);expect(pgCalls).toHaveLength(0);
    const input={idempotencyKey:crypto.randomUUID()},retry=await send(`/orders/${order.order.id}/retry`,{method:'POST',session,body:input});expect(retry.status).toBe(200);
    const next=await retry.json();expect(next.checkout.orderId).not.toBe(order.checkout.orderId);expect(next.order.id).toBe(order.order.id);
    expect((await send(`/orders/${order.order.id}/retry`,{method:'POST',session,body:input})).status).toBe(200);
    expect(local.sqlite.prepare('SELECT COUNT(*) AS total FROM site_payment_attempts').get().total).toBe(2);
  });
  it('never creates a fresh attempt for an unresolved approval',async()=>{
    const session=await member(),order=await started(session,await issued(session,await target()));loseConfirm=true;
    await send('/payments/confirm',{method:'POST',session,body:{orderId:order.checkout.orderId,paymentKey:'fixture-uncertain-retry',amount:100000}});
    expect((await send(`/orders/${order.order.id}/retry`,{method:'POST',session,body:{idempotencyKey:crypto.randomUUID()}})).status).toBe(409);
    expect(local.sqlite.prepare('SELECT COUNT(*) AS total FROM site_payment_attempts').get().total).toBe(1);
  });
  it('recovers an abandoned ready checkout through a read without expiring an uncertain charged attempt',async()=>{
    const session=await member(),order=await started(session,await issued(session,await target()));
    local.sqlite.prepare('UPDATE site_payment_attempts SET created_at=?').run('2020-01-01T00:00:00.000Z');
    const expired=await (await send(`/orders/${order.order.id}`,{session})).json();expect(expired.order.status).toBe('expired');expect(expired.checkout).toBeNull();
    expect((await send(`/orders/${order.order.id}/retry`,{method:'POST',session,body:{idempotencyKey:crypto.randomUUID()}})).status).toBe(200);
    const retry=await (await send(`/orders/${order.order.id}`,{session})).json();loseConfirm=true;
    await send('/payments/confirm',{method:'POST',session,body:{orderId:retry.checkout.orderId,paymentKey:'fixture-unknown-expiry',amount:100000}});
    local.sqlite.prepare('UPDATE site_payment_attempts SET created_at=? WHERE state=?').run('2020-01-01T00:00:00.000Z','confirming');
    await reconcileSitePayments(env);
    expect(local.sqlite.prepare('SELECT status FROM site_orders').get().status).toBe('paid');expect(pgCalls.filter(call=>call.method==='POST')).toHaveLength(1);
  });
});
describe('PG approval uncertainty and refund reconciliation',()=>{
  it('recovers callback refresh with a PG alias after a lost approval response using no extra PG approval or Notion write',async()=>{
    const owner=await member(),other=await member('confirm-other@fixture.invalid'),order=await started(owner,await issued(owner,await target()));loseConfirm=true;
    const response=await send('/payments/confirm',{method:'POST',session:owner,body:{orderId:order.checkout.orderId,paymentKey:'fixture-alias-lost',amount:100000}});
    expect(response.status).toBe(202);
    expect((await send(`/orders/${order.checkout.orderId}`,{session:other})).status).toBe(404);
    for(const reference of [order.checkout.orderId,order.order.id,order.checkout.orderId]){
      const recovered=await send(`/orders/${reference}`,{session:owner});expect(recovered.status).toBe(200);
      const data=await recovered.json();expect(data.order).toMatchObject({id:order.order.id,status:'paid',amount:100000});
      expect(JSON.stringify(data)).not.toContain('fixture-alias-lost');
    }
    expect(pgCalls.filter(call=>call.method==='POST')).toHaveLength(1);
    expect(fetch.mock.calls.some(([url,init])=>String(url).includes('api.notion.com')&&['POST','PATCH'].includes(init.method))).toBe(false);
  });
  it('sends only one approval for simultaneous confirmations',async()=>{
    const session=await member(),order=await started(session,await issued(session,await target()));
    const body={orderId:order.checkout.orderId,paymentKey:'fixture-parallel',amount:100000};
    const responses=await Promise.all([send('/payments/confirm',{method:'POST',session,body}),send('/payments/confirm',{method:'POST',session,body})]);
    expect(responses.every(response=>[200,202].includes(response.status))).toBe(true);
    expect(pgCalls.filter(call=>call.method==='POST'&&call.path.endsWith('/confirm'))).toHaveLength(1);
    expect(local.sqlite.prepare('SELECT COUNT(*) AS total FROM site_payments').get().total).toBe(1);
  });
  it('does not call the PG if atomic preapproval persistence fails and safely permits retry',async()=>{
    const session=await member(),order=await started(session,await issued(session,await target()));
    local.sqlite.exec("CREATE TRIGGER fixture_preapproval_failure BEFORE UPDATE ON site_orders WHEN NEW.status='confirming' BEGIN SELECT RAISE(ABORT,'fixture_preapproval_failure'); END");
    const response=await send('/payments/confirm',{method:'POST',session,body:{orderId:order.checkout.orderId,paymentKey:'fixture-before',amount:100000}});
    expect(response.status).toBe(503);expect(pgCalls).toHaveLength(0);
    expect(local.sqlite.prepare('SELECT state FROM site_payment_attempts').get().state).toBe('ready');
    local.sqlite.exec('DROP TRIGGER fixture_preapproval_failure');expect((await confirmed(session,order)).order.status).toBe('paid');
  });
  it('recovers an approval response loss from the persisted attempt without charging again',async()=>{
    const session=await member(),order=await started(session,await issued(session,await target()));loseConfirm=true;
    const response=await send('/payments/confirm',{method:'POST',session,body:{orderId:order.checkout.orderId,paymentKey:'fixture-lost',amount:100000}});
    expect(response.status).toBe(202);expect((await response.json()).state).toBe('confirming');
    const recovered=await send(`/orders/${order.order.id}`,{session});expect((await recovered.json()).order.status).toBe('paid');
    expect(pgCalls.filter(call=>call.method==='POST')).toHaveLength(1);
  });
  it('recovers a DB failure after PG approval and creates the durable outbox only with the recovered ledger',async()=>{
    const session=await member(),order=await started(session,await issued(session,await target()));
    local.sqlite.exec("CREATE TRIGGER fixture_after_pg BEFORE INSERT ON site_payments BEGIN SELECT RAISE(ABORT,'fixture_after_pg'); END");
    const response=await send('/payments/confirm',{method:'POST',session,body:{orderId:order.checkout.orderId,paymentKey:'fixture-db-fail',amount:100000}});expect(response.status).toBe(202);
    expect(local.sqlite.prepare('SELECT COUNT(*) AS total FROM site_payments').get().total).toBe(0);expect(local.sqlite.prepare('SELECT COUNT(*) AS total FROM site_notion_outbox').get().total).toBe(0);
    local.sqlite.exec('DROP TRIGGER fixture_after_pg');expect((await (await send(`/orders/${order.order.id}`,{session})).json()).order.status).toBe('paid');
    expect(local.sqlite.prepare('SELECT COUNT(*) AS total FROM site_notion_outbox').get().total).toBe(1);expect(pgCalls.filter(call=>call.method==='POST')).toHaveLength(1);
  });
  it('rejects the wrong merchant evidence and never treats an untrusted success URL as payment',async()=>{
    const session=await member(),order=await started(session,await issued(session,await target()));overrideProof={...proof(order.checkout.orderId,100000),mId:'wrong-merchant'};
    const response=await send('/payments/confirm',{method:'POST',session,body:{orderId:order.checkout.orderId,paymentKey:'fixture-payment-key',amount:100000}});expect(response.status).toBe(402);
    expect(local.sqlite.prepare('SELECT COUNT(*) AS total FROM site_payments').get().total).toBe(0);
    expect((await (await send(`/orders/${order.order.id}`,{session})).json()).order.status).toBe('failed');
  });
  it('cancels a partial refund once, retains purchase history, and rejects stale PG totals',async()=>{
    const session=await member(),order=await started(session,await issued(session,await target())),approved=await confirmed(session,order);
    const requested=await send(`/orders/${order.order.id}/refund-request`,{method:'POST',session,body:{reason:'일부 수업 일정이 변경되어 환불을 요청합니다.',amount:20000}});expect(requested.status).toBe(201);
    const refund=(await requested.json()).refundRequest;
    const approval={amount:20000,reason:'수업 진행 시간을 확인한 부분 환불입니다.'};
    const responses=await Promise.all([send(`/admin/refund-requests/${refund.id}/approve`,{admin:true,method:'POST',body:approval}),send(`/admin/refund-requests/${refund.id}/approve`,{admin:true,method:'POST',body:approval})]);
    expect(responses.every(response=>[200,202].includes(response.status))).toBe(true);
    expect(pgCalls.filter(call=>call.method==='POST'&&call.path.endsWith('/cancel'))).toHaveLength(1);
    const attempt=local.sqlite.prepare('SELECT * FROM site_payment_attempts').get(),row=local.sqlite.prepare('SELECT * FROM site_orders').get();
    await recordSitePayment(env,proof(attempt.pg_order_id,100000,approved.input.paymentKey),attempt,row);
    const refreshed=(await (await send(`/orders/${order.order.id}`,{session})).json()).order;
    expect(refreshed).toMatchObject({status:'partially_refunded',refundedAmount:20000,approvedAt:'2026-10-07T00:00:00.000Z'});
    expect(local.sqlite.prepare('SELECT COUNT(*) AS total FROM site_refund_transactions').get().total).toBe(1);
    expect((await send(`/orders/${order.order.id}/refund-request`,{method:'POST',session,body:{reason:'초과 금액 환불 요청',amount:100000}})).status).toBe(400);
  });
  it('reconciles cancellation response loss instead of issuing another cancellation',async()=>{
    const session=await member(),order=await started(session,await issued(session,await target()));await confirmed(session,order);
    const requested=await send(`/orders/${order.order.id}/refund-request`,{method:'POST',session,body:{reason:'일정 사유로 환불을 요청합니다.',amount:30000}}),refund=(await requested.json()).refundRequest;
    loseCancel=true;const response=await send(`/admin/refund-requests/${refund.id}/approve`,{admin:true,method:'POST',body:{amount:30000,reason:'일정 변경을 확인한 부분 환불입니다.'}});expect(response.status).toBe(202);
    expect(local.sqlite.prepare('SELECT state FROM site_refund_requests').get().state).toBe('unknown');
    await reconcileSitePayments(env);
    expect(local.sqlite.prepare('SELECT state FROM site_refund_requests').get().state).toBe('completed');
    expect(local.sqlite.prepare('SELECT refunded_amount FROM site_orders').get().refunded_amount).toBe(30000);
    expect(pgCalls.filter(call=>call.method==='POST'&&call.path.endsWith('/cancel'))).toHaveLength(1);
  });
  it('persists known webhook events but uses a fresh PG lookup instead of its forged status or total',async()=>{
    const session=await member(),order=await started(session,await issued(session,await target())),approved=await confirmed(session,order);
    const response=await send('/webhooks/toss',{method:'POST',body:{eventType:'PAYMENT_STATUS_CHANGED',createdAt:'2026-10-07T00:00:00',data:{orderId:order.checkout.orderId,paymentKey:approved.input.paymentKey,status:'CANCELED',totalAmount:1}}});
    expect(response.status).toBe(200);expect(local.sqlite.prepare('SELECT status,amount FROM site_orders').get()).toEqual({status:'paid',amount:100000});
    expect(local.sqlite.prepare('SELECT state FROM site_pg_webhook_inbox').get().state).toBe('processed');
  });
  it('uses the instructor partial refund snapshot instead of a member full-balance request and freezes retries',async()=>{
    const session=await member(),order=await started(session,await issued(session,await target()));await confirmed(session,order);
    const requested=await send(`/orders/${order.order.id}/refund-request`,{method:'POST',session,body:{reason:'환불 가능 내역을 확인해주세요.'}}),refund=(await requested.json()).refundRequest;
    expect(refund.amount).toBe(100000);
    expect((await send(`/admin/refund-requests/${refund.id}/approve`,{admin:true,method:'POST',body:{}})).status).toBe(400);
    const approval={amount:20000,reason:'진행 내역에 따른 확정 부분 환불'};
    const response=await send(`/admin/refund-requests/${refund.id}/approve`,{admin:true,method:'POST',body:approval});expect(response.status).toBe(200);
    const financial=pgCalls.find(call=>call.path.endsWith('/cancel'));expect(financial.input.cancelAmount).toBe(20000);
    const saved=local.sqlite.prepare('SELECT amount,approved_amount,approved_reason FROM site_refund_requests').get();
    expect(saved).toEqual({amount:100000,approved_amount:20000,approved_reason:approval.reason});
    expect(local.sqlite.prepare('SELECT refund_reason FROM site_payments').get().refund_reason).toBe(approval.reason);
    expect((await send(`/admin/refund-requests/${refund.id}/approve`,{admin:true,method:'POST',body:approval})).status).toBe(200);
    expect((await send(`/admin/refund-requests/${refund.id}/approve`,{admin:true,method:'POST',body:{...approval,amount:100000}})).status).toBe(409);
    expect(pgCalls.filter(call=>call.path.endsWith('/cancel'))).toHaveLength(1);
  });
  it('resumes the same ready checkout after a reload or PG-window cancellation',async()=>{
    const session=await member(),request=await issued(session,await target()),order=await started(session,request);
    const get=await (await send(`/orders/${order.order.id}`,{session})).json();expect(get.order.canResume).toBe(true);expect(get.checkout.orderId).toBe(order.checkout.orderId);
    const resumed=await send('/orders',{method:'POST',session,body:{...order.input,idempotencyKey:crypto.randomUUID()}});expect(resumed.status).toBe(200);
    expect((await resumed.json()).checkout.orderId).toBe(order.checkout.orderId);
    expect(local.sqlite.prepare('SELECT COUNT(*) AS total FROM site_payment_attempts').get().total).toBe(1);
    await confirmed(session,order);
    const paid=await (await send(`/orders/${order.order.id}`,{session})).json();expect(paid.order.canResume).toBe(false);expect(paid.checkout).toBeNull();
  });
  it('rejects an excluded payment method before the approval API can capture it',async()=>{
    const session=await member(),order=await started(session,await issued(session,await target()));
    overrideProof={...proof(order.checkout.orderId,100000,'fixture-bank'),method:'계좌이체',status:'IN_PROGRESS',approvedAt:null};
    const response=await send('/payments/confirm',{method:'POST',session,body:{orderId:order.checkout.orderId,paymentKey:'fixture-bank',amount:100000}});
    expect(response.status).toBe(402);expect(pgCalls.filter(call=>call.method==='POST')).toHaveLength(0);expect(local.sqlite.prepare('SELECT COUNT(*) AS total FROM site_payments').get().total).toBe(0);
  });
});
