// The small built-in web dashboard, served at http://statchain.local/
#pragma once
#include <pgmspace.h>

static const char DASHBOARD_HTML[] PROGMEM = R"HTML(<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Statchain</title>
<style>
:root{--bg:#f6f7f8;--card:#fff;--ink:#16191d;--dim:#667;--line:#dde1e5;--accent:#2563eb;--warn:#d12b2b}
@media (prefers-color-scheme:dark){:root{--bg:#0f1114;--card:#1a1d21;--ink:#eceff2;--dim:#98a1ab;--line:#2c3138;--accent:#6ea0ff;--warn:#ff6b6b}}
*{box-sizing:border-box}body{margin:0;padding:16px;background:var(--bg);color:var(--ink);font:16px/1.4 system-ui,sans-serif}
main{max-width:640px;margin:0 auto}h1{font-size:20px;margin:0 0 2px}
.sub{color:var(--dim);font-size:13px;margin-bottom:14px}
.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(140px,1fr));gap:10px}
.card{background:var(--card);border:1px solid var(--line);border-radius:12px;padding:12px 14px}
.k{color:var(--dim);font-size:12px;text-transform:uppercase;letter-spacing:.04em}
.v{font-size:28px;font-weight:650;font-variant-numeric:tabular-nums}.u{font-size:14px;color:var(--dim);font-weight:400}
.s{color:var(--dim);font-size:12px}.warn .v{color:var(--warn)}
button{font:inherit;background:var(--accent);color:#fff;border:0;border-radius:10px;padding:10px 16px;margin:14px 8px 0 0}
button:disabled{opacity:.5}
details{margin-top:18px}summary{cursor:pointer;color:var(--dim)}
label{display:flex;justify-content:space-between;align-items:center;gap:12px;padding:6px 0;border-bottom:1px solid var(--line)}
input[type=number]{width:96px;font:inherit;padding:4px 6px;background:var(--card);color:var(--ink);border:1px solid var(--line);border-radius:6px}
#msg{color:var(--dim);font-size:13px;margin-top:8px;min-height:1.2em}
</style></head><body><main>
<h1>Statchain</h1><div class="sub" id="sub">connecting…</div>
<div class="grid">
<div class="card"><div class="k">Temperature</div><div class="v" id="t">–</div></div>
<div class="card"><div class="k">Humidity</div><div class="v" id="h">–</div></div>
<div class="card"><div class="k">Pressure</div><div class="v" id="p">–</div></div>
<div class="card" id="snd"><div class="k">Sound</div><div class="v" id="d">–</div><div class="s" id="dr"></div></div>
<div class="card" id="bat"><div class="k">Battery</div><div class="v" id="b">–</div><div class="s" id="bv"></div></div>
</div>
<button id="rf">Refresh e-ink</button><a href="api/days" style="color:var(--accent)">Logs</a>
<div id="msg"></div>
<details><summary>Settings</summary><form id="f"></form><button id="sv" type="button">Save</button></details>
</main><script>
const $=s=>document.getElementById(s);
const n=(v,d,u)=>v==null?'–':v.toFixed(d)+'<span class="u"> '+u+'</span>';
const FIELDS=[['soundIntervalS','Sound reading every (s)',2,300,1],['displayIntervalMin','E-ink refresh every (min)',5,1440,1],
['logIntervalMin','Log every (min)',1,60,1],['keepDays','Keep logs (days)',1,90,1],['loudDb','Loud above (dB)',40,120,1],
['battLowPct','Low battery at (%)',5,50,1],['tempOffsetC','Temperature offset (°C)',-10,10,0.1],['soundCalDb','Sound calibration (dB)',-30,30,0.1]];
async function poll(){
 try{const s=await(await fetch('api/state')).json();
  $('t').innerHTML=n(s.tempC,1,'°C');$('h').innerHTML=n(s.humidity,0,'%');$('p').innerHTML=n(s.pressureHPa,0,'hPa');
  $('d').innerHTML=n(s.soundDb,0,'dB'+(s.aWeighting?'(A)':''));
  $('dr').textContent=s.soundMin==null?'':'today '+s.soundMin.toFixed(0)+'–'+s.soundMax.toFixed(0);
  $('snd').className='card'+(s.soundDb!=null&&s.soundDb>=s.loudDb?' warn':'');
  $('b').innerHTML=s.battValid?n(s.battPct,0,'%'):'–';$('bv').textContent=s.battValid?s.battMv+' mV':'';
  $('bat').className='card'+(s.battValid&&s.battPct<=s.battLowPct?' warn':'');
  $('sub').textContent=(s.local||'clock not set')+' · '+s.ip+(s.rssi?' · '+s.rssi+' dBm':'')+' · up '+Math.floor(s.uptimeS/60)+' min';
 }catch(e){$('sub').textContent='offline'}
}
async function loadSettings(){
 const s=await(await fetch('api/settings')).json();let h='';
 for(const[k,l,mn,mx,st]of FIELDS)h+=`<label>${l}<input type="number" name="${k}" min="${mn}" max="${mx}" step="${st}" value="${s[k]}"></label>`;
 h+=`<label>A-weighting<input type="checkbox" name="aWeighting" ${s.aWeighting?'checked':''}></label>`;$('f').innerHTML=h;
}
$('sv').onclick=async()=>{
 const p=new URLSearchParams();for(const e of $('f').elements)if(e.name)p.set(e.name,e.type=='checkbox'?(e.checked?'1':'0'):e.value);
 const r=await fetch('api/settings',{method:'POST',body:p});$('msg').textContent=r.ok?'Saved.':'Save failed.';loadSettings();
};
$('rf').onclick=async()=>{
 const r=await fetch('api/refresh',{method:'POST'});const j=await r.json();
 $('msg').textContent=r.ok?'Refreshing the e-ink display (about 15 s)…':'Too soon – try again in '+j.retryInS+' s.';
};
poll();setInterval(poll,3000);loadSettings();
</script></body></html>)HTML";
