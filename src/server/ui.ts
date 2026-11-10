/** Single-file reviewer console. No build step. All dynamic text goes through textContent, never innerHTML. */
export const UI_HTML = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Withdrawal Review</title>
<style>
:root{--bg:#fafaf9;--fg:#1c1917;--muted:#78716c;--card:#fff;--line:#e7e5e4;--hold:#b45309;--esc:#b91c1c;--rel:#15803d;--accent:#1d4ed8}
@media (prefers-color-scheme:dark){:root{--bg:#0c0a09;--fg:#fafaf9;--muted:#a8a29e;--card:#1c1917;--line:#292524;--hold:#fbbf24;--esc:#f87171;--rel:#4ade80;--accent:#60a5fa}}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--fg);font:15px/1.5 system-ui,sans-serif}
main{max-width:860px;margin:0 auto;padding:16px}
header{display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin-bottom:16px}
h1{font-size:18px;margin:0 auto 0 0}
input,button,textarea{font:inherit;color:inherit;background:var(--card);border:1px solid var(--line);border-radius:6px;padding:6px 10px}
button{cursor:pointer}button:hover{border-color:var(--accent)}button:focus-visible,input:focus-visible,textarea:focus-visible{outline:2px solid var(--accent)}
button.primary{background:var(--accent);color:#fff;border-color:var(--accent)}
.card{background:var(--card);border:1px solid var(--line);border-radius:10px;padding:14px;margin-bottom:12px}
.row{display:flex;gap:8px;align-items:center;flex-wrap:wrap}.muted{color:var(--muted)}.grow{flex:1}
.badge{font-weight:600;padding:1px 8px;border-radius:999px;border:1px solid currentColor;font-size:13px}
.release{color:var(--rel)}.hold{color:var(--hold)}.escalate{color:var(--esc)}
ul{margin:8px 0;padding-left:20px}code{font-size:13px}
#msg{min-height:1.5em;margin-bottom:8px}
</style></head><body><main>
<header><h1>Withdrawal review</h1>
<label class="row"><span class="muted">API key</span><input id="key" type="password" autocomplete="off" placeholder="Bearer token"></label>
<button id="load" class="primary">Load queue</button><button id="verify">Verify audit chain</button></header>
<div id="msg" role="status" aria-live="polite" class="muted"></div><div id="list"></div>
<script>
const $=s=>document.querySelector(s);const msg=t=>{$('#msg').textContent=t};
const keyEl=$('#key');try{keyEl.value=sessionStorage.getItem('k')||''}catch{}
const api=async(path,opts={})=>{const r=await fetch(path,{...opts,headers:{authorization:'Bearer '+keyEl.value,'content-type':'application/json'}});
const b=await r.json();if(!r.ok)throw new Error(b.error?.message||r.statusText);return b};
const el=(tag,props={},...kids)=>{const e=document.createElement(tag);Object.assign(e,props);kids.flat().forEach(k=>e.append(k));return e};
function card(p){
 const finds=p.findings.length?el('ul',{},p.findings.map(f=>el('li',{},el('code',{textContent:f.ruleId}),' '+f.message))):el('p',{className:'muted',textContent:'No policy findings.'});
 const comment=el('textarea',{rows:2,placeholder:'Comment (optional)',maxLength:500,className:'grow','aria-label':'Comment'});
 const act=d=>async()=>{try{const r=await api('/v1/proposals/'+p.id+'/decision',{method:'POST',body:JSON.stringify({decision:d,comment:comment.value||undefined})});
  msg(r.executed?'Executed: '+r.proposal.finalAction:'Recorded. Status '+r.proposal.status);load()}catch(e){msg(e.message)}};
 return el('section',{className:'card'},
  el('div',{className:'row'},el('strong',{textContent:p.withdrawalId}),el('span',{className:'badge '+p.finalAction,textContent:p.finalAction}),
   el('span',{className:'muted',textContent:p.approvals.length+'/'+p.requiredApprovals+' approvals'}),
   p.degraded?el('span',{className:'badge hold',textContent:'agent failed'}):'',p.overridden?el('span',{className:'badge hold',textContent:'policy overrode agent'}):''),
  el('p',{textContent:p.reason}),finds,
  el('p',{className:'muted',textContent:'agent: '+(p.agentAction||'none')+' / policy floor: '+p.policyFloor+' / model: '+p.model+' / expires '+p.expiresAt}),
  el('div',{className:'row'},comment,el('button',{className:'primary',textContent:'Approve',onclick:act('approve')}),el('button',{textContent:'Reject',onclick:act('reject')})));
}
async function load(){try{sessionStorage.setItem('k',keyEl.value)}catch{}
 try{const {proposals}=await api('/v1/proposals?status=pending');const l=$('#list');l.replaceChildren(...(proposals.length?proposals.map(card):[el('p',{className:'muted',textContent:'Nothing pending.'})]));msg(proposals.length+' pending')}catch(e){msg(e.message)}}
$('#load').onclick=load;$('#verify').onclick=async()=>{try{const v=await api('/v1/audit/verify');msg(v.ok?'Audit chain intact ('+v.checked+' records).':'AUDIT CHAIN BROKEN at record '+v.brokenAtSeq)}catch(e){msg(e.message)}};
</script></main></body></html>`;
