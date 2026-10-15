import { beforeEach,afterEach,describe,it,expect,vi } from 'vitest';
import { siteD1 } from './helpers/siteD1.js';
import { runSiteNotionSync,reconcileSiteNotionItem,SITE_LEDGER_DATABASES } from '../lib/siteNotionSync.js';
const CLASS='11111111-1111-4111-8111-111111111111';
let local,env,pages,schema,created,patches,loseCreate,ignoreRefund,rateLimitCreate;
function validSchema(){
  const result={};for(const [name,type] of Object.entries({'타이틀':'title','수업 종류':'relation','학생':'relation','시간 회차':'number','실제 결제 금액':'number',
    '환불 금액':'number','웹 주문 항목 ID':'rich_text','결제 당시 단가':'number','결제 당시 할인율':'number','결제수단':'select','결제일':'date',
    '환불일':'date','환불 사유':'rich_text','결제 출처':'rich_text','메모':'rich_text','전화번호':'phone_number'}))result[name]={type};
  result['결제 금액']={type:'formula',formula:{expression:'prop("결제 당시 단가") * (1-prop("결제 당시 할인율")/100)'}};
  result['미수금']={type:'formula',formula:{expression:'prop("결제 금액") - prop("실제 결제 금액")'}};
  result['결제 상태']={type:'formula',formula:{expression:'if(prop("미수금")<=0,"완료","미완료")'}};
  result['유효 시간 회차']={type:'formula',formula:{expression:'(prop("실제 결제 금액")-prop("환불 금액"))/prop("결제 당시 단가")'}};
  result['결제수단'].select={options:[{name:'카드'},{name:'간편결제'}]};
  return result;
}
function computed(properties){
  const hours=properties['시간 회차']?.number||0,price=properties['결제 당시 단가']?.number||0,refund=properties['환불 금액']?.number||0;
  return {...properties,'미수금':{formula:{number:0}},'유효 시간 회차':{formula:{number:hours===0?0:refund===0?hours:Math.max(0,Math.min(hours,(properties['실제 결제 금액'].number-refund)/price))}}};
}
function seed({refund=0,hours=0,rate=0}={}){
  const memberId=crypto.randomUUID(),targetId=crypto.randomUUID(),requestId=crypto.randomUUID(),orderId=crypto.randomUUID(),itemId=crypto.randomUUID(),attemptId=crypto.randomUUID();
  const at='2026-10-07T00:00:00.000Z',amount=100000,snapshot={targetId,targetName:'가상 특강',experienceType:'special',classTypeId:CLASS,
    studentId:null,studentRequired:false,timeLedgerMode:hours?'hours':'none',hours,unitPriceSnapshot:rate,discountRateSnapshot:0,
    billingPeriod:'2026-10',customerName:'가상 참여자',customerPhone:'01012345678',refundPolicy:'가상 환불 조건을 확인하고 처리합니다.'};
  local.sqlite.prepare("INSERT INTO site_members(id,status,email,name,nickname,member_code,customer_key,provider,password_hash,created_at,updated_at) VALUES(?,'active',?,'가상 참여자','참여자',?,?,'email','fixture-not-an-authenticating-verifier',?,?)")
    .run(memberId,`${memberId}@fixture.invalid`,memberId,crypto.randomUUID(),at,at);
  local.sqlite.prepare("INSERT INTO site_targets(id,name,experience_type,class_type_id,student_required,time_ledger_mode,unit_price,created_at,updated_at) VALUES(?,'가상 특강','special',?,0,?,?,?,?)")
    .run(targetId,CLASS,hours?'hours':'none',rate,at,at);
  local.sqlite.prepare("INSERT INTO site_payment_requests(id,member_id,target_id,billing_key,billing_period,snapshot,amount,terms_version,expires_at,status,created_at,updated_at) VALUES(?,?,?,?,'2026-10',?,?,'v1','2099-01-01T00:00:00.000Z','paid',?,?)")
    .run(requestId,memberId,targetId,crypto.randomUUID(),JSON.stringify(snapshot),amount,at,at);
  local.sqlite.prepare("INSERT INTO site_orders(id,member_id,request_id,idempotency_hash,payload_hash,snapshot,amount,status,version,approved_at,refunded_amount,created_at,updated_at) VALUES(?,?,?,?,?,?,?,? ,2,?,?,?,?)")
    .run(orderId,memberId,requestId,crypto.randomUUID(),'fixture',JSON.stringify(snapshot),amount,refund?'partially_refunded':'paid',at,refund,at,at);
  local.sqlite.prepare('INSERT INTO site_order_items(id,order_id,target_id,snapshot) VALUES(?,?,?,?)').run(itemId,orderId,targetId,JSON.stringify(snapshot));
  local.sqlite.prepare("INSERT INTO site_payment_attempts(id,order_id,pg_order_id,pg_environment,payment_key,idempotency_key,state,created_at,updated_at) VALUES(?,?,?,'test',?,?,'paid',?,?)")
    .run(attemptId,orderId,`site_${orderId.replace(/-/g,'')}`,`fixture_${orderId}`,crypto.randomUUID(),at,at);
  local.sqlite.prepare("INSERT INTO site_payments(payment_key,order_id,attempt_id,pg_order_id,pg_environment,merchant_id,amount,currency,method,approved_at,refunded_amount,refund_at,refund_reason,evidence_hash,updated_at) VALUES(?,?,?,?,'test','fixture',?,'KRW','카드',?,?,?,?,?,?)")
    .run(`fixture_${orderId}`,orderId,attemptId,`site_${orderId.replace(/-/g,'')}`,amount,at,refund,refund?at:null,refund?'일부 일정 변경':null,'fixture',at);
  local.sqlite.prepare("INSERT INTO site_notion_outbox(order_item_id,desired_version,state,created_at,updated_at) VALUES(?,2,'pending',?,?)").run(itemId,at,at);
  return {itemId,orderId,snapshot,amount};
}
beforeEach(()=>{
  local=siteD1();env={GAME_DB:local.db,NOTION_TOKEN:'isolated-fixture-notion'};pages=new Map();schema=validSchema();created=0;patches=0;loseCreate=false;ignoreRefund=false;rateLimitCreate=false;
  vi.stubGlobal('fetch',vi.fn(async(raw,options={})=>{
    const url=new URL(raw),method=options.method||'GET';if(url.hostname!=='api.notion.com')throw new Error('Unexpected network');
    const input=options.body?JSON.parse(options.body):null;
    if(url.pathname===`/v1/databases/${SITE_LEDGER_DATABASES.payment}`&&method==='GET')return Response.json({properties:schema});
    if(url.pathname===`/v1/pages/${CLASS}`&&method==='GET')return Response.json({object:'page',id:CLASS,parent:{database_id:SITE_LEDGER_DATABASES.classType}});
    if(url.pathname===`/v1/databases/${SITE_LEDGER_DATABASES.payment}/query`){
      const trace=input.filter.rich_text.equals;return Response.json({results:[...pages.values()].filter(page=>page.properties['웹 주문 항목 ID'].rich_text[0].text.content===trace),has_more:false});
    }
    if(url.pathname==='/v1/pages'&&method==='POST'){
      if(rateLimitCreate)return Response.json({object:'error'},{status:429,headers:{'Retry-After':'30'}});
      created++;const id=crypto.randomUUID(),page={object:'page',id,parent:input.parent,properties:computed(input.properties)};pages.set(id,page);
      if(loseCreate)throw new Error('Lost create response');return Response.json(page);
    }
    const pageId=url.pathname.slice('/v1/pages/'.length),page=pages.get(pageId);
    if(page){if(method==='PATCH'){patches++;const changes={...input.properties};if(ignoreRefund)delete changes['환불 금액'];page.properties=computed({...page.properties,...changes});}return Response.json(page);}
    throw new Error('Unexpected isolated Notion route');
  }));
});
afterEach(()=>{local.close();vi.unstubAllGlobals();vi.restoreAllMocks();});

describe('durable Notion payment synchronization',()=>{
  it('creates a special-class ledger with immutable gross, rate and trace once across competing workers',async()=>{
    const seeded=seed();await Promise.all([runSiteNotionSync(env),runSiteNotionSync(env)]);
    expect(created).toBe(1);const job=local.sqlite.prepare('SELECT * FROM site_notion_outbox').get();expect(job).toMatchObject({state:'synced',applied_version:2});
    const page=pages.get(job.notion_page_id);expect(page.properties['학생'].relation).toEqual([]);
    expect(page.properties['실제 결제 금액'].number).toBe(100000);expect(page.properties['시간 회차'].number).toBe(0);
    expect(page.properties['웹 주문 항목 ID'].rich_text[0].text.content).toBe(seeded.itemId);
    expect(page.properties['결제 출처'].rich_text[0].text.content).toBe('홈페이지');
    expect(local.sqlite.prepare('SELECT * FROM site_notion_outbox').get()).not.toHaveProperty('body');
  });
  it('keeps payment evidence available and reports setup dependency without writing a deficient schema',async()=>{
    seed();delete schema['결제 당시 할인율'];const result=await runSiteNotionSync(env);
    expect(result.results[0]).toMatchObject({state:'needs_setup',reasonCode:'schema_snapshots_missing'});expect(created).toBe(0);
    expect(local.sqlite.prepare('SELECT amount FROM site_payments').get().amount).toBe(100000);
  });
  it('checks chained snapshot formulas and stops incompatible legacy calculation before creation',async()=>{
    seed();schema['결제 금액'].formula.expression='prop("시간당 단가")*prop("시간 회차")';
    await runSiteNotionSync(env);expect(local.sqlite.prepare('SELECT reason_code FROM site_notion_outbox').get().reason_code).toBe('formula_snapshot_not_ready');expect(created).toBe(0);
  });
  it('records uncertain creation, never creates twice, and reconciles a found trace before applying a refund',async()=>{
    const seeded=seed({refund:20000});loseCreate=true;await runSiteNotionSync(env);
    expect(local.sqlite.prepare('SELECT state,notion_page_id FROM site_notion_outbox').get()).toEqual({state:'unknown',notion_page_id:null});
    await runSiteNotionSync(env);expect(created).toBe(1);loseCreate=false;
    expect((await reconcileSiteNotionItem(env,seeded.itemId)).status).toBe(200);
    await runSiteNotionSync(env);expect(created).toBe(1);expect(patches).toBe(1);expect(local.sqlite.prepare('SELECT state FROM site_notion_outbox').get().state).toBe('synced');
  });
  it('does not infer absence from an empty query after an uncertain creation',async()=>{
    const seeded=seed();local.sqlite.prepare("UPDATE site_notion_outbox SET state='unknown',create_started_at='2026-10-07T00:00:00.000Z'").run();
    const result=await reconcileSiteNotionItem(env,seeded.itemId);expect(result.status).toBe(409);
    expect(local.sqlite.prepare('SELECT state FROM site_notion_outbox').get().state).toBe('unknown');expect(created).toBe(0);
  });
  it('observes Retry-After on a definitive refusal without turning it into an uncertain duplicate',async()=>{
    seed();rateLimitCreate=true;await runSiteNotionSync(env);
    const job=local.sqlite.prepare('SELECT * FROM site_notion_outbox').get();expect(job.state).toBe('pending');expect(job.create_started_at).toBeNull();expect(job.next_attempt_at).toBeGreaterThan(Math.floor(Date.now()/1000));
    expect(created).toBe(0);
  });
  it('requires the exact refund amount even when a special class has no time ledger',async()=>{
    const seeded=seed();await runSiteNotionSync(env);const job=local.sqlite.prepare('SELECT * FROM site_notion_outbox').get();
    local.sqlite.prepare("UPDATE site_orders SET refunded_amount=20000,version=3,status='partially_refunded'").run();
    local.sqlite.prepare('UPDATE site_payments SET refunded_amount=20000,refund_at=?,refund_reason=?').run('2026-10-07T01:00:00.000Z','일부 일정 변경');
    local.sqlite.prepare("UPDATE site_notion_outbox SET desired_version=3,state='pending',next_attempt_at=0").run();
    ignoreRefund=true;await runSiteNotionSync(env);
    expect(pages.get(job.notion_page_id).properties['환불 금액'].number).toBe(0);
    expect(local.sqlite.prepare('SELECT state,reason_code FROM site_notion_outbox WHERE order_item_id=?').get(seeded.itemId)).toEqual({state:'failed',reason_code:'notion_refund_mismatch'});
  });
  it('preserves instructor notes and gross when applying the confirmed cumulative refund',async()=>{
    const seeded=seed({hours:2,rate:50000});await runSiteNotionSync(env);const job=local.sqlite.prepare('SELECT * FROM site_notion_outbox').get(),page=pages.get(job.notion_page_id);
    page.properties['메모']={rich_text:[{text:{content:'강사가 작성한 운영 메모'}}]};page.properties['타이틀']={title:[{text:{content:'수동 정리 제목'}}]};
    local.sqlite.prepare("UPDATE site_orders SET refunded_amount=20000,version=3,status='partially_refunded'").run();
    local.sqlite.prepare('UPDATE site_payments SET refunded_amount=20000,refund_at=?,refund_reason=?').run('2026-10-07T01:00:00.000Z','일정 변경');
    local.sqlite.prepare("UPDATE site_notion_outbox SET desired_version=3,state='pending',next_attempt_at=0").run();
    await runSiteNotionSync(env);expect(local.sqlite.prepare('SELECT state,applied_version FROM site_notion_outbox').get()).toEqual({state:'synced',applied_version:3});
    expect(page.properties['환불 금액'].number).toBe(20000);expect(page.properties['실제 결제 금액'].number).toBe(100000);
    expect(page.properties['메모'].rich_text[0].text.content).toBe('강사가 작성한 운영 메모');expect(page.properties['타이틀'].title[0].text.content).toBe('수동 정리 제목');
    expect(created).toBe(1);expect(patches).toBe(1);expect(page.properties['유효 시간 회차'].formula.number).toBe(1.6);
    expect(seeded.snapshot.unitPriceSnapshot).toBe(50000);
  });
  it('blocks manual amount changes or removed linked pages instead of overwriting or recreating them',async()=>{
    seed();await runSiteNotionSync(env);const job=local.sqlite.prepare('SELECT * FROM site_notion_outbox').get();pages.get(job.notion_page_id).properties['실제 결제 금액'].number=90000;
    local.sqlite.prepare("UPDATE site_notion_outbox SET state='pending',next_attempt_at=0").run();await runSiteNotionSync(env);
    expect(local.sqlite.prepare('SELECT state,reason_code FROM site_notion_outbox').get()).toEqual({state:'failed',reason_code:'notion_manual_override'});expect(patches).toBe(0);expect(created).toBe(1);
  });
  it('turns an expired in-flight creation lease into reconciliation, preserving at-most-once creation',async()=>{
    seed();local.sqlite.prepare("UPDATE site_notion_outbox SET state='processing',create_started_at='2026-10-07T00:00:00.000Z',lease_token='expired',lease_until=0").run();
    await runSiteNotionSync(env);expect(local.sqlite.prepare('SELECT state FROM site_notion_outbox').get().state).toBe('unknown');expect(created).toBe(0);
  });
});
