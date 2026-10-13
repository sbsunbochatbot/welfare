const $ = (sel, root=document) => root.querySelector(sel);
const $$ = (sel, root=document) => [...root.querySelectorAll(sel)];
let currentUser = null;
let currentView = 'chat';
let voices = [];
let speaking = false;

async function api(path, opts={}){
  const res = await fetch(path, {
    credentials: 'include',
    headers: { 'content-type':'application/json', ...(opts.headers||{}) },
    ...opts,
    body: opts.body && typeof opts.body !== 'string' ? JSON.stringify(opts.body) : opts.body
  });
  const ct = res.headers.get('content-type') || '';
  const data = ct.includes('json') ? await res.json() : await res.text();
  if(!res.ok){
    const msg = data?.message || data || `HTTP ${res.status}`;
    throw new Error(msg);
  }
  return data;
}
function escapeHtml(s){return String(s??'').replace(/[&<>"]/g, c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));}
function fmt(dt){ try { return new Date(dt).toLocaleString('ko-KR'); } catch { return dt; } }
function viewTitle(v){ return ({chat:'복지 Q&A',history:'질문·답변 메모',admin:'관리자 분석',docs:'규정 PDF 업로드',users:'사용자 관리'})[v] || '복지 Q&A'; }

function setView(v){
  currentView = v;
  $$('.nav-btn').forEach(b=>b.classList.toggle('active', b.dataset.view===v));
  $$('.view').forEach(el=>el.classList.remove('active'));
  $(`#${v}View`)?.classList.add('active');
  $('#viewTitle').textContent = viewTitle(v);
  if(v==='history') loadHistory();
  if(v==='admin') loadAnalytics();
  if(v==='docs') loadAnalytics();
  if(v==='users') loadUsers();
}

async function bootstrap(){
  try{
    const me = await api('/api/me');
    if(me.user){
      currentUser = me.user;
      $('#loginScreen').classList.add('hidden');
      $('#appShell').classList.remove('hidden');
      $('#userName').textContent = currentUser.name || currentUser.id;
      $('#userRole').textContent = currentUser.role;
      if(currentUser.role==='admin') $$('.admin-only').forEach(x=>x.classList.remove('hidden'));
      renderQuick(me.quickQuestions || []);
      addBotMessage('안녕하세요. SB선보 복지 가이드북을 기준으로 답변드립니다. 제도명, 대상, 금액, 제출기한 등을 질문해 주세요.', [], 1);
      initVoices();
    }
  }catch(e){ console.warn(e); }
}

function renderQuick(list){
  const box = $('#quickQuestions'); box.innerHTML='';
  for(const q of list){
    const b = document.createElement('button'); b.type='button'; b.textContent=q;
    b.onclick=()=>{ $('#questionInput').value=q; $('#chatForm').requestSubmit(); };
    box.appendChild(b);
  }
}

function addUserMessage(text){
  const wrap=document.createElement('div'); wrap.className='msg user';
  wrap.innerHTML=`<div class="bubble">${escapeHtml(text)}</div><div class="avatar">나</div>`;
  $('#chatMessages').appendChild(wrap); wrap.scrollIntoView({behavior:'smooth',block:'end'});
}
function addBotMessage(text, sources=[], confidence=0){
  const wrap=document.createElement('div'); wrap.className='msg bot';
  const src = sources?.length ? `<div class="source-list">출처 ${sources.map(s=>`<span>${escapeHtml(s.title)} p.${escapeHtml(s.page ?? '-')}</span>`).join('')}</div>` : '';
  const conf = confidence ? `<button type="button">신뢰도 ${Math.round(confidence*100)}%</button>` : '';
  wrap.innerHTML=`<div class="avatar">SB</div><div class="bubble"><div>${escapeHtml(text)}</div>${src}<div class="bubble-actions"><button type="button" class="speak-btn">🔊 듣기</button><button type="button" class="stop-btn">⏹ 정지</button>${conf}</div></div>`;
  $('.speak-btn', wrap).onclick=()=>speak(text);
  $('.stop-btn', wrap).onclick=stopSpeak;
  $('#chatMessages').appendChild(wrap); wrap.scrollIntoView({behavior:'smooth',block:'end'});
  if($('#ttsAuto')?.checked) speak(text);
}

async function onChat(e){
  e.preventDefault();
  const input=$('#questionInput');
  const q=input.value.trim(); if(!q) return;
  input.value=''; addUserMessage(q);
  const pending=document.createElement('div'); pending.className='msg bot'; pending.innerHTML='<div class="avatar">SB</div><div class="bubble">답변을 찾고 있습니다...</div>'; $('#chatMessages').appendChild(pending);
  try{
    const res = await api('/api/chat', {method:'POST', body:{question:q}});
    pending.remove(); addBotMessage(res.answer, res.sources, res.confidence);
  }catch(err){ pending.remove(); addBotMessage('오류: '+err.message, [], 0); }
}

function initVoices(){
  if(!('speechSynthesis' in window)) return;
  const load=()=>{
    voices = window.speechSynthesis.getVoices();
    const sel=$('#voiceSelect'); if(!sel) return;
    sel.innerHTML='';
    const ko = voices.filter(v=>/ko|korean|한국/i.test(v.lang+v.name));
    const list = ko.length ? ko : voices;
    for(const v of list){
      const opt=document.createElement('option'); opt.value=v.name; opt.textContent=`${v.name} (${v.lang})`; sel.appendChild(opt);
    }
  };
  load(); window.speechSynthesis.onvoiceschanged=load;
}
function selectedVoice(){
  const name=$('#voiceSelect')?.value;
  return voices.find(v=>v.name===name) || voices.find(v=>v.lang?.startsWith('ko')) || null;
}
function speak(text){
  if(!('speechSynthesis' in window)){ alert('이 브라우저는 TTS를 지원하지 않습니다.'); return; }
  stopSpeak();
  const chunks = String(text).replace(/\s+/g,' ').match(/.{1,180}(?:[.!?。]|\s|$)/g) || [text];
  const voice=selectedVoice(); speaking=true;
  let i=0;
  const next=()=>{
    if(!speaking || i>=chunks.length) return;
    const u = new SpeechSynthesisUtterance(chunks[i++]);
    u.lang = voice?.lang || 'ko-KR'; if(voice) u.voice=voice;
    u.rate = 0.95; u.pitch=1.0; u.volume=1;
    u.onend=()=>setTimeout(next, 60);
    window.speechSynthesis.speak(u);
  };
  next();
}
function stopSpeak(){ speaking=false; if('speechSynthesis' in window) window.speechSynthesis.cancel(); }

async function loadHistory(){
  const box=$('#historyList'); box.innerHTML='<div class="panel-card">불러오는 중...</div>';
  try{
    const res=await api('/api/history');
    box.innerHTML='';
    for(const l of res.logs){
      const d=document.createElement('div'); d.className='memo';
      d.innerHTML=`<small>${fmt(l.createdAt)} · ${escapeHtml(l.intent||'')}</small><b>Q. ${escapeHtml(l.question)}</b><div>${escapeHtml(l.answer).slice(0,500)}</div>`;
      box.appendChild(d);
    }
  }catch(e){ box.innerHTML=`<div class="panel-card">${escapeHtml(e.message)}</div>`; }
}

async function loadAnalytics(){
  if(currentUser?.role!=='admin') return;
  try{
    const res=await api('/api/admin/analytics');
    const a=res.analytics;
    $('#statTotal').textContent=a.total;
    $('#statUnanswered').textContent=a.unanswered.length;
    $('#statDocs').textContent=res.docs.length;
    const max=Math.max(1,...Object.values(a.byIntent));
    $('#intentChart').innerHTML=Object.entries(a.byIntent).sort((a,b)=>b[1]-a[1]).map(([k,v])=>`<div class="bar-row"><b>${escapeHtml(k)}</b><div class="bar"><i style="width:${v/max*100}%"></i></div><span>${v}</span></div>`).join('') || '데이터 없음';
    $('#unansweredList').innerHTML=a.unanswered.map(x=>`<div class="mini-item"><b>${escapeHtml(x.question)}</b><small>${fmt(x.createdAt)} · ${escapeHtml(x.userId||'')}</small></div>`).join('') || '<div class="mini-item">보완 필요 질문이 없습니다.</div>';
    $('#docList').innerHTML=res.docs.map(d=>`<div class="mini-item"><b>${escapeHtml(d.title)}</b><br><small>${fmt(d.uploadedAt)} · ${d.pages}쪽 · ${d.chunks} chunks</small></div>`).join('');
  }catch(e){ console.warn(e); }
}

async function loadUsers(){
  if(currentUser?.role!=='admin') return;
  const box=$('#usersList'); box.innerHTML='불러오는 중...';
  try{
    const res=await api('/api/admin/users');
    box.innerHTML=`<table><thead><tr><th>ID</th><th>이름</th><th>권한</th><th>부서</th><th>직위</th><th>NAVER WORKS</th></tr></thead><tbody>${res.users.map(u=>`<tr><td>${escapeHtml(u.id)}</td><td>${escapeHtml(u.name)}</td><td>${escapeHtml(u.role)}</td><td>${escapeHtml(u.department||'')}</td><td>${escapeHtml(u.title||'')}</td><td>${escapeHtml(u.naverWorksId||'')}</td></tr>`).join('')}</tbody></table>`;
  }catch(e){ box.textContent=e.message; }
}

async function extractPdfText(file, useOcr=false){
  const status=$('#pdfStatus'), progress=$('#pdfProgress');
  progress.value=0; status.textContent='PDF 로딩 중...';
  const buf=await file.arrayBuffer();
  const pdfjsLib=window.pdfjsLib;
  pdfjsLib.GlobalWorkerOptions.workerSrc='https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
  const pdf=await pdfjsLib.getDocument({data:buf}).promise;
  const pages=[];
  for(let i=1;i<=pdf.numPages;i++){
    status.textContent=`${i}/${pdf.numPages}쪽 텍스트 추출 중...`;
    const page=await pdf.getPage(i);
    let text='';
    const content=await page.getTextContent().catch(()=>({items:[]}));
    text=content.items.map(it=>it.str).join(' ').replace(/\s+/g,' ').trim();
    if(useOcr && text.length < 80 && window.Tesseract){
      status.textContent=`${i}/${pdf.numPages}쪽 OCR 처리 중... 시간이 걸릴 수 있습니다.`;
      const viewport=page.getViewport({scale:2.1});
      const canvas=document.createElement('canvas');
      canvas.width=viewport.width; canvas.height=viewport.height;
      const ctx=canvas.getContext('2d');
      await page.render({canvasContext:ctx, viewport}).promise;
      const rec=await Tesseract.recognize(canvas, 'kor+eng', { logger:m=>{ if(m.status) status.textContent=`${i}/${pdf.numPages}쪽 OCR: ${m.status} ${Math.round((m.progress||0)*100)}%`; }});
      text=rec.data.text.replace(/\s+/g,' ').trim();
    }
    pages.push({page:i,text});
    progress.value=Math.round(i/pdf.numPages*100);
  }
  return pages;
}
async function uploadPdf(){
  const file=$('#pdfFile').files[0]; if(!file) return alert('PDF 파일을 선택하세요.');
  try{
    const pages=await extractPdfText(file, $('#ocrMode').checked);
    const totalText=pages.map(p=>p.text).join('').length;
    $('#pdfStatus').textContent=`추출 완료: ${pages.length}쪽, ${totalText.toLocaleString()}자. 서버 반영 중...`;
    const res=await api('/api/admin/pdf-ingest', {method:'POST', body:{fileName:file.name,title:file.name,pages,extraction:$('#ocrMode').checked?'ocr+pdfjs':'pdfjs'}});
    $('#pdfStatus').textContent=`반영 완료: ${res.doc.title}, ${res.doc.pages}쪽, ${res.doc.chunks}개 지식 조각`;
    await loadAnalytics();
  }catch(e){ $('#pdfStatus').textContent='오류: '+e.message; }
}
async function uploadUsers(){
  const file=$('#excelFile').files[0]; if(!file) return alert('Excel 파일을 선택하세요.');
  try{
    $('#userUploadStatus').textContent='Excel 읽는 중...';
    const buf=await file.arrayBuffer();
    const wb=XLSX.read(buf,{type:'array'});
    const sheet=wb.Sheets[wb.SheetNames[0]];
    const rows=XLSX.utils.sheet_to_json(sheet,{defval:''});
    const res=await api('/api/admin/users/bulk',{method:'POST',body:{users:rows}});
    $('#userUploadStatus').textContent=`완료: 추가 ${res.added}명, 수정 ${res.updated}명, 제외 ${res.skipped}명`;
    await loadUsers();
  }catch(e){ $('#userUploadStatus').textContent='오류: '+e.message; }
}

$('#loginForm').addEventListener('submit', async e=>{
  e.preventDefault();
  try{
    const res=await api('/api/login',{method:'POST',body:{id:$('#loginId').value.trim(),password:$('#loginPw').value}});
    location.reload();
  }catch(err){ alert(err.message); }
});
$('#logoutBtn').addEventListener('click', async ()=>{ await api('/api/logout',{method:'POST'}).catch(()=>{}); location.reload(); });
$('#chatForm').addEventListener('submit', onChat);
$$('.nav-btn').forEach(b=>b.addEventListener('click',()=>setView(b.dataset.view)));
$('#uploadPdfBtn').addEventListener('click', uploadPdf);
$('#uploadUsersBtn').addEventListener('click', uploadUsers);
window.addEventListener('beforeunload', stopSpeak);
bootstrap();
