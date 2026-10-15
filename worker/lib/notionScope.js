import { normalizeId } from './string.js';

const UUID = '[a-f0-9]{8}-?[a-f0-9]{4}-?[a-f0-9]{4}-?[a-f0-9]{4}-?[a-f0-9]{12}';
const databaseRoute = new RegExp(`^/v1/databases/(${UUID})(/query)?$`, 'i');
const pageRoute = new RegExp(`^/v1/pages/(${UUID})$`, 'i');
const failure = (status, error) => ({ ok: false, status, error });
const SITE_FINANCIAL_FIELDS=new Set(['웹 주문 항목 ID','결제 당시 단가','결제 당시 할인율','결제 출처']);
const PAYMENT_DB='314838faf2a68154935bedd3d2fbea83';
const STUDENT_DB='314838faf2a68143a6c7e59c50f3bbdb';
const decodedKey=value=>{
  let key=String(value||'');
  for(let i=0;i<3;i++){try{const decoded=decodeURIComponent(key);if(decoded===key)break;key=decoded;}catch{break;}}
  return key;
};
function studentVipKeys(properties){
  const vip=properties?.VIP;
  if(!vip||vip.type!=='checkbox'||typeof vip.id!=='string')return null;
  return new Set(['VIP',vip.id,decodedKey(vip.id)]);
}
function vipEntries(properties,keys){
  return Object.entries(properties||{}).filter(([key,value])=>keys.has(key)||keys.has(decodedKey(key))
    ||value&&typeof value==='object'&&typeof value.id==='string'&&(keys.has(value.id)||keys.has(decodedKey(value.id))));
}
const propertyIds=properties=>new Set([...SITE_FINANCIAL_FIELDS].flatMap(name=>{
  const id=properties?.[name]?.id;if(!id)return[];
  try{return [id,decodeURIComponent(id)];}catch{return[id];}
}));
const hasWebsiteTrace=page=> (page?.properties?.['웹 주문 항목 ID']?.rich_text||[])
  .some(part=>String(part.plain_text||part.text?.content||'').trim().length>0);

export function pageInDatabase(page, allowedDbIds) {
  const id = page?.parent?.database_id;
  return typeof id === 'string' && allowedDbIds.has(normalizeId(id).toLowerCase());
}

// Only API shapes used by this application are proxied. Resolve ownership on every
// page request; knowing an ID or querying some other allowed DB is not authority.
export async function authorizeNotionRequest(request, url, notion, allowedDbIds) {
  let body;
  if (request.method !== 'GET' && request.method !== 'HEAD') {
    try { body = await request.json(); } catch { return failure(400, 'JSON 형식이 올바르지 않습니다.'); }
    if (!body || typeof body !== 'object' || Array.isArray(body)) return failure(400, '요청 형식이 올바르지 않습니다.');
  }
  const db = url.pathname.match(databaseRoute);
  if (db) {
    if (!allowedDbIds.has(normalizeId(db[1]).toLowerCase())) return failure(403, '허용되지 않은 DB입니다.');
    if (db[2] ? request.method !== 'POST' : request.method !== 'GET') return failure(405, '허용되지 않은 메서드입니다.');
    return { ok: true, body };
  }
  if (url.pathname === '/v1/pages' && request.method === 'POST') {
    const parent = body?.parent;
    if (!parent || typeof parent.database_id !== 'string' || !allowedDbIds.has(normalizeId(parent.database_id).toLowerCase())
      || parent.page_id || parent.data_source_id || parent.workspace || (parent.type && parent.type !== 'database_id')) {
      return failure(403, '허용되지 않은 상위 DB입니다.');
    }
    if(Object.keys(body.properties||{}).some(key=>SITE_FINANCIAL_FIELDS.has(key)))return failure(403,'웹 결제 원장은 결제 서버에서 등록합니다.');
    if(normalizeId(parent.database_id).toLowerCase()===STUDENT_DB){
      const schema=await notion('GET',`/databases/${parent.database_id}`),keys=studentVipKeys(schema?.properties);
      if(!keys)return failure(502,'학생 DB의 숙제 관리 속성을 확인할 수 없습니다.');
      if(vipEntries(body.properties,keys).some(([,value])=>!value||typeof value!=='object'||value.checkbox!==false
        ||value.type!==undefined&&value.type!=='checkbox'))return failure(403,'학생앱 제공과 숙제 관리는 학생앱 제공 설정에서 변경해주세요.');
    }
    if(normalizeId(parent.database_id).toLowerCase()===PAYMENT_DB){
      const schema=await notion('GET',`/databases/${parent.database_id}`);
      if(!schema?.properties)return failure(502,'결제 DB 속성을 확인할 수 없습니다.');
      const ids=propertyIds(schema.properties);
      if(Object.keys(body.properties||{}).some(key=>ids.has(key)))return failure(403,'웹 결제 추적 정보는 결제 서버에서 등록합니다.');
    }
    return { ok: true, body };
  }
  const page = url.pathname.match(pageRoute);
  if (!page) return failure(403, '허용되지 않은 경로입니다.');
  if (request.method !== 'GET' && request.method !== 'PATCH') return failure(405, '허용되지 않은 메서드입니다.');
  if (body?.parent) return failure(403, '페이지 이동은 허용되지 않습니다.');
  const current = await notion('GET', `/pages/${page[1]}`);
  if (current?.object === 'error') return failure(current.status === 404 ? 404 : 502, '페이지를 확인할 수 없습니다.');
  if (!pageInDatabase(current, allowedDbIds)) return failure(403, '허용되지 않은 페이지입니다.');
  if(request.method==='PATCH'){
    if(normalizeId(current.parent.database_id).toLowerCase()===STUDENT_DB){
      const keys=studentVipKeys(current.properties);
      if(!keys)return failure(502,'학생 DB의 숙제 관리 속성을 확인할 수 없습니다.');
      const entries=vipEntries(body.properties,keys);
      if(entries.length){
        const [key,value]=entries[0],currentVip=current.properties.VIP.checkbox;
        if(typeof currentVip!=='boolean')return failure(502,'학생 DB의 숙제 관리 속성을 확인할 수 없습니다.');
        if(entries.length!==1||key!=='VIP'||!value||typeof value!=='object'||Array.isArray(value)
          ||Object.keys(value).some(name=>name!=='checkbox'&&name!=='type')
          ||typeof value.checkbox!=='boolean'||value.checkbox!==currentVip
          ||value.type!==undefined&&value.type!=='checkbox'){
          return failure(403,'학생앱 제공과 숙제 관리는 학생앱 제공 설정에서 변경해주세요.');
        }
        // Older teacher forms repeat VIP on every save. Remove an exact no-op
        // rather than forwarding it: a concurrent provision/OFF remains untouched.
        body={...body,properties:Object.fromEntries(Object.entries(body.properties).filter(([name])=>name!=='VIP'))};
      }
    }
    const reservedIds=propertyIds(current.properties);
    if(Object.keys(body.properties||{}).some(key=>SITE_FINANCIAL_FIELDS.has(key)||reservedIds.has(key))){
      return failure(403,'웹 결제 추적 정보와 스냅샷은 결제 서버에서 관리합니다.');
    }
    if(hasWebsiteTrace(current)){
      const memoId=current.properties?.['메모']?.id;
      if(Object.keys(body).some(key=>key!=='properties')||!body.properties||typeof body.properties!=='object'||Array.isArray(body.properties)
        ||Object.keys(body.properties).some(key=>key!=='메모'&&key!==memoId)){
        return failure(403,'웹 결제의 금액·환불·관계·삭제는 홈페이지 결제 관리에서 처리해주세요.');
      }
    }
  }
  return { ok: true, body, ...(request.method === 'GET' ? { page: current } : { currentPage: current }) };
}
