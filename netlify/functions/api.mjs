import { getStore } from '@netlify/blobs';
import crypto from 'node:crypto';
import { SignJWT, importPKCS8 } from 'jose';
import { APP_VERSION, SEED_POLICIES, DEFAULT_QUICK_QUESTIONS } from './seed.mjs';

const STORE_NAME = process.env.BLOB_STORE_NAME || 'sbsunbo-welfare-chatbot';
const STATE_KEY = 'state.json';
const SESSIONS_KEY = 'sessions.json';
const SESSION_TTL_MS = 1000 * 60 * 60 * 12;
const MAX_CHAT_LOG = 5000;

function getBlobStore(){
  return getStore({ name: STORE_NAME, consistency: 'strong' });
}

function json(body, status=200, headers={}){
  return new Response(JSON.stringify(body, null, 2), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', ...headers }
  });
}

function text(body, status=200){
  return new Response(body, { status, headers: { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store' } });
}

async function readJson(key, fallback){
  const store = getBlobStore();
  const data = await store.get(key, { type: 'json' }).catch(() => null);
  return data || fallback;
}

async function writeJson(key, value){
  const store = getBlobStore();
  await store.setJSON(key, value);
}

function nowIso(){ return new Date().toISOString(); }
function randomToken(){ return crypto.randomBytes(32).toString('base64url'); }
function randomSalt(){ return crypto.randomBytes(16).toString('hex'); }
function hashPassword(password, salt){
  return crypto.pbkdf2Sync(String(password), salt, 120000, 32, 'sha256').toString('hex');
}
function makeUser(id, name, role, password='1111', extra={}){
  const salt = randomSalt();
  return { id, name, role, salt, passwordHash: hashPassword(password, salt), active: true, createdAt: nowIso(), ...extra };
}
function verifyPassword(user, password){
  if(!user || !user.active) return false;
  return crypto.timingSafeEqual(Buffer.from(user.passwordHash), Buffer.from(hashPassword(password, user.salt)));
}

function defaultState(){
  return {
    version: APP_VERSION,
    createdAt: nowIso(),
    updatedAt: nowIso(),
    company: {
      name: 'SB선보',
      displayName: 'SB선보 복지 챗봇',
      slogan: 'SUNBO Family 복지 가이드',
      primary: '#0068c9',
      secondary: '#15b8a6'
    },
    settings: {
      allowWebTts: true,
      showCitations: true,
      strictSourceMode: true,
      naverWorksEnabled: Boolean(process.env.NAVER_WORKS_BOT_ID)
    },
    users: [
      makeUser('admin', '관리자', 'admin', '1111', { department: '관리', title: '시스템 관리자' }),
      makeUser('user1', '사용자1', 'user', '1111', { department: '임직원', title: '일반 사용자' })
    ],
    policies: SEED_POLICIES,
    documents: [{
      id: 'seed-2026-welfare-guide',
      title: '2026년 SB선보 복지 가이드북(직영)',
      uploadedBy: 'system',
      uploadedAt: nowIso(),
      pages: 68,
      chunks: SEED_POLICIES.map(p => ({ id: p.id, title: p.title, category: p.category, page: p.page, text: p.text, keywords: p.keywords || [] }))
    }],
    quickQuestions: DEFAULT_QUICK_QUESTIONS,
    chatLogs: [],
    naverWorksLogs: [],
    counters: { chat: 1, doc: 2, upload: 1 }
  };
}

function migrateState(state){
  let changed = false;
  state.settings = { ...(state.settings || {}), allowWebTts: true, showCitations: true, strictSourceMode: true, naverWorksEnabled: Boolean(process.env.NAVER_WORKS_BOT_ID) };
  state.quickQuestions = state.quickQuestions?.length ? state.quickQuestions : DEFAULT_QUICK_QUESTIONS;
  if(state.version !== APP_VERSION){
    state.version = APP_VERSION;
    // 최신 복지 가이드북 기준 지식 베이스를 재학습/갱신합니다.
    state.policies = SEED_POLICIES;
    const hasSeedDoc = (state.documents || []).some(d => d.id === 'seed-2026-welfare-guide');
    if(!hasSeedDoc){
      state.documents = [{
        id: 'seed-2026-welfare-guide',
        title: '2026년 SB선보 복지 가이드북(직영)',
        uploadedBy: 'system', uploadedAt: nowIso(), pages: 68,
        chunks: SEED_POLICIES.map(p => ({ id: p.id, title: p.title, category: p.category, page: p.page, text: p.text, keywords: p.keywords || [] }))
      }, ...(state.documents || [])];
    }
    changed = true;
  }
  return { state, changed };
}
async function getState(){
  let state = await readJson(STATE_KEY, null);
  if(!state || !state.version){
    state = defaultState();
    await writeJson(STATE_KEY, state);
    return state;
  }
  const migrated = migrateState(state);
  if(migrated.changed) await writeJson(STATE_KEY, migrated.state);
  return migrated.state;
}
async function saveState(state){
  state.updatedAt = nowIso();
  await writeJson(STATE_KEY, state);
}
async function getSessions(){ return await readJson(SESSIONS_KEY, {}); }
async function saveSessions(sessions){ await writeJson(SESSIONS_KEY, sessions); }

function getCookie(req, name){
  const cookie = req.headers.get('cookie') || '';
  const parts = cookie.split(';').map(x => x.trim());
  for(const part of parts){
    if(part.startsWith(name + '=')) return decodeURIComponent(part.substring(name.length + 1));
  }
  return null;
}
function setSessionCookie(token){
  const secure = process.env.NODE_ENV === 'development' ? '' : '; Secure';
  return `sb_session=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${Math.floor(SESSION_TTL_MS/1000)}${secure}`;
}
function clearSessionCookie(){ return 'sb_session=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0'; }

async function getAuth(req){
  const token = req.headers.get('authorization')?.replace(/^Bearer\s+/i, '') || getCookie(req, 'sb_session');
  if(!token) return { user: null, token: null };
  const sessions = await getSessions();
  const session = sessions[token];
  if(!session || Date.now() > session.expiresAt){
    if(session){ delete sessions[token]; await saveSessions(sessions); }
    return { user: null, token: null };
  }
  const state = await getState();
  const user = state.users.find(u => u.id === session.userId && u.active);
  return { user, token };
}
function requireAuth(user){ if(!user) throw Object.assign(new Error('로그인이 필요합니다.'), { status: 401 }); }
function requireAdmin(user){ requireAuth(user); if(user.role !== 'admin') throw Object.assign(new Error('관리자 권한이 필요합니다.'), { status: 403 }); }

function normalize(s){
  return String(s || '').toLowerCase()
    .replace(/[\u200B-\u200D\uFEFF]/g,'')
    .replace(/[\s\n\r\t]+/g,' ')
    .replace(/[“”"'`~!@#$%^&*()_+={}\[\]|\\:;<>?,.\/]/g,' ')
    .trim();
}
function tokens(s){
  return normalize(s).split(' ').filter(x => x.length >= 2);
}
function inferIntent(q){
  const n = normalize(q);
  const dict = [
    ['복지수당', ['복지수당','복지 수당','지원금액','50%','월할','복지']],
    ['건강', ['의료비','건강검진','난임','임신','장애자녀','금연','헬스','병원','검진']],
    ['교육', ['학자금','자녀 대학','등록금','입학','자격증','외국인 교육','지게차','선임']],
    ['경조사', ['경조','결혼','출산','사망','장례','화환','상조']],
    ['조직문화', ['장기근속','창립','기념품','생일','입사기념','퇴임','부서소통','동호회','감사왕','헌혈']],
    ['일생활균형', ['리프레쉬','워라밸','리조트','휴양','대출','주택','재난','휴가','반반차']],
    ['사우회', ['사우회','회비','운영회칙','임원','문상지원']]
  ];
  for(const [intent, keys] of dict){ if(keys.some(k => n.includes(normalize(k)))) return intent; }
  return '일반문의';
}

function scoreItem(query, item){
  const nq = normalize(query);
  const qt = tokens(query);
  let score = 0;
  const hay = normalize(`${item.category || ''} ${item.title || ''} ${(item.keywords || []).join(' ')} ${item.text || ''} ${item.answer || ''}`);
  if(hay.includes(nq) && nq.length >= 3) score += 25;
  for(const t of qt){
    if(!t) continue;
    if(normalize(item.title).includes(t)) score += 12;
    if(normalize(item.category).includes(t)) score += 8;
    if((item.keywords || []).some(k => normalize(k).includes(t) || t.includes(normalize(k)))) score += 10;
    if(hay.includes(t)) score += 3;
  }
  return score;
}
function uniqueBy(arr, keyFn){
  const seen = new Set(); const out=[];
  for(const x of arr){ const k=keyFn(x); if(!seen.has(k)){seen.add(k); out.push(x);} }
  return out;
}

function formatMoney(n){
  return Math.round(n).toLocaleString('ko-KR') + '원';
}
function formatMoneyFloor10(n){
  return (Math.floor(Number(n) / 10) * 10).toLocaleString('ko-KR') + '원';
}
function ensureHonorific(text){
  const s = String(text || '').trim();
  if(!s) return '죄송합니다. 답변을 생성하지 못했습니다. 질문을 조금 더 구체적으로 다시 입력해 주세요.';
  if(/[요다]\.?$/.test(s) || s.endsWith('합니다.') || s.endsWith('됩니다.')) return s;
  return s + '입니다.';
}
function clarifyMessage(question, suggestions=[]){
  const list = suggestions.length ? suggestions.map(s => `- ${s}`).join('\n') : '- 본인부담 의료비 지원 조건\n- 자녀 대학 등록금 지원 기준\n- 복지수당 월할 계산 기준\n- 경조사 휴가 및 경조금 기준';
  return `죄송합니다. 입력하신 질문의 의도를 정확히 확정하기 어렵습니다. 아래처럼 제도명과 궁금한 내용을 함께 다시 질문해 주시겠습니까?\n\n${list}`;
}
function parseTenureYears(q){
  const m = String(q).match(/(\d+)\s*년/);
  return m ? Number(m[1]) : null;
}
function calculationAnswer(query){
  const n = normalize(query);
  if(n.includes('장기근속')){
    const years = parseTenureYears(query);
    const table = [[30,10000000],[25,5000000],[20,4000000],[15,3000000],[10,2000000],[5,1000000]];
    if(years != null){
      const found = table.find(([y]) => years >= y);
      if(found){
        return {
          answer: `장기근속 ${years}년 기준 포상금은 ${formatMoney(found[1])}입니다. 지급 기준표는 5년 100만원, 10년 200만원, 15년 300만원, 20년 400만원, 25년 500만원, 30년 1,000만원입니다.`,
          sources: [{title:'장기근속 포상', page:34}], confidence: 0.95, intent: '조직문화'
        };
      }
    }
  }
  if(n.includes('복지수당') && (n.includes('월할') || n.includes('계산') || n.includes('2월') || n.includes('입사'))){
    const amount = 1000000 * 8 / 12;
    const floored = formatMoneyFloor10(amount);
    return {
      answer: `복지수당 월할 계산 예시로, 2월 1일 입사자는 100만원 × 8/12 = ${floored}입니다. 가이드북 기준으로 초일 입사자는 월로 계산하고, 월중 입사자는 입사 후 3개월 만료일의 다음 달부터 지급 적용됩니다. 실제 적용은 입사일과 지급대상 여부를 함께 확인해 주세요.`,
      sources: [{title:'복지 수당 지원금액 및 계산방법', page:56}], confidence:0.94, intent:'복지수당'
    };
  }
  return null;
}


function answerQuestion(state, question, user=null, channel='web'){
  const q = String(question || '').trim();
  if(!q) return { answer: '질문을 입력해 주세요.', sources: [], confidence: 0, intent: '입력오류', type: 'empty', needsClarification:true };
  if(q.length < 3){
    return { answer: clarifyMessage(q), sources: [], confidence: 0.1, intent: '입력오류', type: 'clarification', needsClarification:true };
  }
  const calc = calculationAnswer(q);
  if(calc) return { ...calc, answer: ensureHonorific(calc.answer), type: 'formula' };

  const candidates = [];
  for(const p of state.policies || []) candidates.push({ ...p, sourceType:'policy' });
  for(const doc of state.documents || []){
    for(const c of doc.chunks || []) candidates.push({ ...c, sourceType:'document', docTitle:doc.title });
  }
  const scored = candidates.map(item => ({ item, score: scoreItem(q, item) })).filter(x => x.score > 0).sort((a,b) => b.score - a.score);
  const top = uniqueBy(scored, x => x.item.id || `${x.item.title}-${x.item.page}`).slice(0,4);
  const intent = inferIntent(q);
  if(top.length === 0 || top[0].score < 5){
    return {
      answer: clarifyMessage(q),
      sources: [], confidence: 0.2, intent, type: 'no_match', needsClarification:true
    };
  }
  if(top.length >= 2 && top[0].score < 16 && top[1].score / Math.max(1, top[0].score) > 0.78){
    const suggestions = top.slice(0,3).map(x => `「${x.item.title}」에 대해 질문하시는 것인가요?`);
    return {
      answer: clarifyMessage(q, suggestions),
      sources: top.map(x => ({ title:x.item.title, page:x.item.page, category:x.item.category, score:x.score })),
      confidence: 0.38, intent, type: 'ambiguous', needsClarification:true
    };
  }
  const main = top[0].item;
  const related = top.slice(1,3).map(x => x.item);
  let answer = main.answer || main.text;
  if(related.length && top[0].score < 20){
    answer += `\n\n관련해서 함께 확인하실 수 있는 항목은 ${related.map(r => `「${r.title}」`).join(', ')}입니다.`;
  }
  answer = ensureHonorific(answer);
  const sources = top.map(x => ({ title: x.item.title, page: x.item.page, category: x.item.category, score: x.score }));
  const confidence = Math.min(0.97, 0.45 + top[0].score / 60);
  return { answer, sources, confidence, intent, type: 'retrieval', needsClarification:false };
}


function sanitizeUserForClient(u){
  if(!u) return null;
  const { passwordHash, salt, ...safe } = u;
  return safe;
}
function summarizeAnalytics(logs){
  const byIntent = {}, byUser = {}, unanswered = [];
  for(const l of logs || []){
    byIntent[l.intent || '기타'] = (byIntent[l.intent || '기타'] || 0) + 1;
    byUser[l.userId || 'unknown'] = (byUser[l.userId || 'unknown'] || 0) + 1;
    if((l.confidence || 0) < 0.45 || l.type === 'no_match') unanswered.push(l);
  }
  return { total: logs.length, byIntent, byUser, unanswered: unanswered.slice(-50).reverse() };
}

async function issueWorksAccessToken(){
  if(process.env.NAVER_WORKS_ACCESS_TOKEN) return process.env.NAVER_WORKS_ACCESS_TOKEN;
  const clientId = process.env.NAVER_WORKS_CLIENT_ID;
  const clientSecret = process.env.NAVER_WORKS_CLIENT_SECRET;
  const serviceAccount = process.env.NAVER_WORKS_SERVICE_ACCOUNT;
  let privateKey = process.env.NAVER_WORKS_PRIVATE_KEY;
  const scope = process.env.NAVER_WORKS_SCOPE || 'bot';
  if(!clientId || !clientSecret || !serviceAccount || !privateKey) return null;
  privateKey = privateKey.replace(/\\n/g, '\n');
  const alg = 'RS256';
  const key = await importPKCS8(privateKey, alg);
  const now = Math.floor(Date.now()/1000);
  const jwt = await new SignJWT({ sub: serviceAccount })
    .setProtectedHeader({ alg, typ: 'JWT' })
    .setIssuer(clientId)
    .setIssuedAt(now)
    .setExpirationTime(now + 3500)
    .sign(key);
  const body = new URLSearchParams({
    grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
    client_id: clientId,
    client_secret: clientSecret,
    assertion: jwt,
    scope
  });
  const res = await fetch('https://auth.worksmobile.com/oauth2/v2.0/token', { method:'POST', headers:{ 'content-type':'application/x-www-form-urlencoded; charset=UTF-8' }, body });
  if(!res.ok) throw new Error(`NAVER WORKS token error ${res.status}: ${await res.text()}`);
  const data = await res.json();
  return data.access_token;
}

function verifyWorksSignature(rawBody, signature, secret){
  if(!secret) return true;
  if(!signature) return false;
  const expected = crypto.createHmac('sha256', secret).update(rawBody).digest('base64');
  return crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(signature));
}
async function sendWorksMessage(target, answer){
  const botId = process.env.NAVER_WORKS_BOT_ID;
  const token = await issueWorksAccessToken();
  if(!botId || !token) return { skipped: true, reason:'NAVER_WORKS_BOT_ID or token not configured' };
  const text = answer.length > 1800 ? answer.slice(0, 1800) + '\n...(일부 생략)' : answer;
  const url = target.channelId
    ? `https://www.worksapis.com/v1.0/bots/${encodeURIComponent(botId)}/channels/${encodeURIComponent(target.channelId)}/messages`
    : `https://www.worksapis.com/v1.0/bots/${encodeURIComponent(botId)}/users/${encodeURIComponent(target.userId)}/messages`;
  const res = await fetch(url, {
    method:'POST',
    headers:{ authorization:`Bearer ${token}`, 'content-type':'application/json' },
    body: JSON.stringify({ content: { type:'text', text } })
  });
  if(!res.ok) return { ok:false, status:res.status, body: await res.text() };
  return { ok:true, status:res.status };
}

async function route(req){
  const url = new URL(req.url);
  let path = url.pathname;
  path = path.replace(/^\/\.netlify\/functions\/api/, '/api');
  const method = req.method.toUpperCase();
  const state = await getState();
  const { user, token } = await getAuth(req);

  if(method === 'GET' && (path === '/api/health' || path === '/api')) return json({ ok:true, version:APP_VERSION, time:nowIso() });

  if(method === 'POST' && path === '/api/login'){
    const body = await req.json();
    const u = state.users.find(x => x.id === body.id && x.active);
    if(!verifyPassword(u, body.password)) return json({ ok:false, message:'아이디 또는 비밀번호가 맞지 않습니다.' }, 401);
    const sessions = await getSessions();
    const t = randomToken();
    sessions[t] = { userId:u.id, createdAt:Date.now(), expiresAt:Date.now()+SESSION_TTL_MS };
    await saveSessions(sessions);
    return json({ ok:true, user:sanitizeUserForClient(u) }, 200, { 'set-cookie': setSessionCookie(t) });
  }
  if(method === 'POST' && path === '/api/logout'){
    if(token){ const sessions = await getSessions(); delete sessions[token]; await saveSessions(sessions); }
    return json({ ok:true }, 200, { 'set-cookie': clearSessionCookie() });
  }
  if(method === 'GET' && path === '/api/me'){
    return json({ ok:true, user:sanitizeUserForClient(user), company:state.company, settings:state.settings, quickQuestions:state.quickQuestions });
  }
  if(method === 'GET' && path === '/api/bootstrap'){
    requireAuth(user);
    return json({ ok:true, user:sanitizeUserForClient(user), company:state.company, quickQuestions:state.quickQuestions });
  }
  if(method === 'POST' && path === '/api/chat'){
    requireAuth(user);
    const body = await req.json();
    const result = answerQuestion(state, body.question, user, 'web');
    const log = { id:`C${state.counters.chat++}`, channel:'web', userId:user.id, name:user.name, question:String(body.question||''), answer:result.answer, sources:result.sources, intent:result.intent, confidence:result.confidence, type:result.type, createdAt:nowIso() };
    state.chatLogs.push(log);
    if(state.chatLogs.length > MAX_CHAT_LOG) state.chatLogs = state.chatLogs.slice(-MAX_CHAT_LOG);
    await saveState(state);
    return json({ ok:true, ...result, chatId:log.id });
  }
  if(method === 'GET' && path === '/api/history'){
    requireAuth(user);
    const logs = user.role === 'admin' ? state.chatLogs : state.chatLogs.filter(l => l.userId === user.id);
    return json({ ok:true, logs: logs.slice(-200).reverse() });
  }
  if(method === 'GET' && path === '/api/admin/users'){
    requireAdmin(user);
    return json({ ok:true, users: state.users.map(sanitizeUserForClient) });
  }
  if(method === 'POST' && path === '/api/admin/users'){
    requireAdmin(user);
    const body = await req.json();
    const id = String(body.id || body.name || '').trim();
    if(!id) return json({ ok:false, message:'ID가 필요합니다.' }, 400);
    if(state.users.some(u => u.id === id)) return json({ ok:false, message:'이미 존재하는 ID입니다.' }, 409);
    state.users.push(makeUser(id, body.name || id, body.role || 'user', body.password || '1111', { department:body.department||'', title:body.title||'', naverWorksId:body.naverWorksId||'', email:body.email||'' }));
    await saveState(state);
    return json({ ok:true });
  }
  if(method === 'POST' && path === '/api/admin/users/bulk'){
    requireAdmin(user);
    const body = await req.json();
    const rows = Array.isArray(body.users) ? body.users : [];
    let added=0, updated=0, skipped=0;
    for(const row of rows){
      const id = String(row.id || row.ID || row['아이디'] || row['사번'] || row.name || row['이름'] || '').trim();
      if(!id){ skipped++; continue; }
      const existing = state.users.find(u => u.id === id);
      const patch = { name: row.name || row['이름'] || id, role: row.role || row['권한'] || 'user', department: row.department || row['부서'] || '', title: row.title || row['직위'] || '', email: row.email || row['이메일'] || '', naverWorksId: row.naverWorksId || row['네이버웍스ID'] || row['NAVERWORKS'] || '' };
      if(existing){ Object.assign(existing, patch, { active: row.active === false ? false : true }); updated++; }
      else { state.users.push(makeUser(id, patch.name, patch.role, row.password || row['비밀번호'] || '1111', patch)); added++; }
    }
    await saveState(state);
    return json({ ok:true, added, updated, skipped });
  }
  if(method === 'POST' && path === '/api/admin/pdf-ingest'){
    requireAdmin(user);
    const body = await req.json({ limit: '10mb' }).catch(async () => JSON.parse(await req.text()));
    const pages = Array.isArray(body.pages) ? body.pages : [];
    const title = body.title || body.fileName || '업로드 복지 규정 PDF';
    const chunks = [];
    for(const p of pages){
      const page = Number(p.page || p.pageNumber || 0);
      const text = String(p.text || '').replace(/\s+/g,' ').trim();
      if(text.length < 15) continue;
      const parts = text.match(/.{1,850}(?:\s|$)/g) || [text];
      let idx = 1;
      for(const part of parts){
        chunks.push({ id:`doc-${Date.now()}-${page}-${idx++}`, title:`${title} p.${page}`, category:'업로드 규정', page, text:part.trim(), keywords: tokens(part).slice(0,20) });
      }
    }
    if(chunks.length === 0) return json({ ok:false, message:'추출된 텍스트가 없습니다. 이미지형 PDF는 관리자 화면의 OCR 모드를 사용하거나 텍스트가 포함된 PDF로 업로드하세요.' }, 400);
    const doc = { id:`doc-${state.counters.doc++}`, title, fileName: body.fileName || title, uploadedBy:user.id, uploadedAt:nowIso(), pages: pages.length, chunks, extraction: body.extraction || 'pdfjs' };
    state.documents = [doc];
    state.policies = SEED_POLICIES; // seed retained as 검증 기준; uploaded doc takes part in retrieval too.
    await saveState(state);
    return json({ ok:true, doc: { id:doc.id, title:doc.title, chunks:chunks.length, pages:doc.pages } });
  }
  if(method === 'GET' && path === '/api/admin/analytics'){
    requireAdmin(user);
    return json({ ok:true, analytics: summarizeAnalytics(state.chatLogs), version: state.version, docs: state.documents.map(d => ({ id:d.id, title:d.title, uploadedAt:d.uploadedAt, pages:d.pages, chunks:d.chunks?.length || 0 })) });
  }
  if(method === 'GET' && path === '/api/admin/export'){
    requireAdmin(user);
    return json({ ok:true, exportedAt: nowIso(), state: { ...state, users: state.users.map(sanitizeUserForClient) } });
  }
  if(method === 'POST' && path === '/api/admin/reset'){
    requireAdmin(user);
    const fresh = defaultState();
    await saveState(fresh);
    return json({ ok:true, message:'초기화 완료' });
  }
  if(method === 'POST' && path === '/api/admin/password'){
    requireAuth(user);
    const body = await req.json();
    const targetId = user.role === 'admin' && body.userId ? body.userId : user.id;
    const target = state.users.find(u => u.id === targetId);
    if(!target) return json({ ok:false, message:'사용자를 찾을 수 없습니다.'},404);
    if(user.role !== 'admin' && !verifyPassword(target, body.currentPassword)) return json({ ok:false, message:'현재 비밀번호가 맞지 않습니다.'},403);
    const salt = randomSalt(); target.salt = salt; target.passwordHash = hashPassword(body.newPassword || '1111', salt); target.updatedAt = nowIso();
    await saveState(state);
    return json({ ok:true });
  }
  if(method === 'POST' && path === '/api/naverworks'){
    const raw = await req.text();
    const sig = req.headers.get('x-works-signature') || req.headers.get('X-WORKS-Signature');
    if(!verifyWorksSignature(raw, sig, process.env.NAVER_WORKS_BOT_SECRET)) return json({ ok:false, message:'invalid signature' }, 401);
    const event = JSON.parse(raw || '{}');
    const question = event?.content?.type === 'text' ? event.content.text : '';
    if(!question) return json({ ok:true, ignored:true });
    const result = answerQuestion(state, question, { id:event.source?.userId || 'naverworks', name:'NAVER WORKS' }, 'naverworks');
    const log = { id:`C${state.counters.chat++}`, channel:'naverworks', userId:event.source?.userId || '', channelId:event.source?.channelId || '', question, answer:result.answer, sources:result.sources, intent:result.intent, confidence:result.confidence, type:result.type, createdAt:nowIso() };
    state.chatLogs.push(log); state.naverWorksLogs.push({ request:event, result:{ answer:result.answer, intent:result.intent }, createdAt:nowIso() });
    await saveState(state);
    const sendResult = await sendWorksMessage(event.source || {}, result.answer + (result.sources?.length ? `\n\n출처: ${result.sources.map(s=>`${s.title} p.${s.page}`).join(', ')}` : '')).catch(e => ({ ok:false, error:String(e.message || e) }));
    return json({ ok:true, sendResult });
  }
  return json({ ok:false, message:'Not found', path }, 404);
}

export default async (req) => {
  try { return await route(req); }
  catch(err){
    console.error(err);
    return json({ ok:false, message: err.message || 'Server error' }, err.status || 500);
  }
};
