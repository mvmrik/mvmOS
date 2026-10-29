// Shared regional date/time control. Canonical values are YYYY-MM-DD, HH:mm,
// or YYYY-MM-DDTHH:mm wall times in the configured system time zone.
(function () {
  'use strict';
  window.mvmOS = window.mvmOS || {};
  if (window.mvmOS.dateTimePicker) return;
  let display = {}, profile = {}, pending;
  const pad = n => String(n).padStart(2, '0');
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  function settings(o = {}) {
    const s = Object.assign({date_format:'DD/MM/YYYY',time_format:'24',week_starts:'monday',timezone:'UTC'}, display, profile, window._vosSettings || {});
    return {lang:o.lang || window.mvmOS.lang || 'en', dateFormat:o.dateFormat || s.date_format, timeFormat:String(o.timeFormat || s.time_format),
      weekStarts:o.weekStarts || s.week_starts, timeZone:o.timeZone || s.timezone};
  }
  function ready() {
    if (!pending) pending = Promise.all([
      fetch('/api/settings/display').then(r => {if(!r.ok)throw Error();return r.json();}).then(s => {display=s;}).catch(() => {}),
      !window._vosSettings && localStorage.getItem('apphub_token') ? fetch('/api/pub/apphub/me',{headers:{'X-Pub-Token':localStorage.getItem('apphub_token')}}).then(r=>{if(!r.ok)throw Error();return r.json();}).then(s=>{for(const k of ['date_format','time_format'])if(s[k])profile[k]=s[k];}).catch(()=>{}) : Promise.resolve()
    ]);
    return pending;
  }
  const tr = k => (window._i18n || {})['picker_'+k] || ({date:'Date',time:'Time',datetime:'Date and time',today:'Today',now:'Now',apply:'Apply',cancel:'Cancel',clear:'Clear',previous:'Previous month',next:'Next month',month:'Month',year:'Year',hour:'Hour',minute:'Minute',period:'Period',invalid:'Choose a valid value within the allowed range.'})[k];
  function parse(value, type) {
    const match = String(value || '').match(type==='time'?/^(\d{2}):(\d{2})$/:type==='date'?/^(\d{4})-(\d{2})-(\d{2})$/:/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/);
    if(!match)return null;
    const n=match.slice(1).map(Number),p=type==='time'?{y:2000,m:1,d:1,h:n[0],min:n[1]}:{y:n[0],m:n[1],d:n[2],h:n[3]||0,min:n[4]||0};
    if(p.y<100||p.y>9999||p.m<1||p.m>12||p.d<1||p.d>new Date(Date.UTC(p.y,p.m,0)).getUTCDate()||p.h>23||p.min>59)return null;
    return p;
  }
  function canonical(p,type) { const date=`${String(p.y).padStart(4,'0')}-${pad(p.m)}-${pad(p.d)}`,time=`${pad(p.h)}:${pad(p.min)}`;return type==='date'?date:type==='time'?time:date+'T'+time; }
  function parts(epoch,o={}) {
    const cfg=settings(o), p={};
    new Intl.DateTimeFormat('en-GB-u-nu-latn',{timeZone:cfg.timeZone,year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).formatToParts(new Date(epoch*1000)).forEach(x=>{p[x.type]=x.value;});
    return {y:+p.year,m:+p.month,d:+p.day,h:+p.hour,min:+p.minute};
  }
  function fromEpoch(epoch,o={}) {return canonical(parts(epoch,o),o.type||'datetime');}
  function toEpoch(value,o={}) {
    const type=o.type||'datetime', p=parse(value,type);if(!p||type==='time')return null;
    const target=Date.UTC(p.y,p.m-1,p.d,p.h,p.min)/1000,offsets=new Set();
    // Inspect both sides of transitions. A nonexistent local minute is rejected;
    // for repeated autumn minutes the first occurrence is chosen consistently.
    for(const delta of [-172800,-86400,0,86400,172800]){const t=target+delta,q=parts(t,o);offsets.add(Date.UTC(q.y,q.m-1,q.d,q.h,q.min)/1000-t);}
    const matches=[...offsets].map(offset=>target-offset).filter(t=>canonical(parts(t,o),type)===value);
    return matches.length?Math.min(...matches):null;
  }
  function format(value,o={}) {
    const type=o.type||'datetime',p=parse(value,type);if(!p)return '';
    const c=settings(o),date=c.dateFormat.replace('YYYY',String(p.y).padStart(4,'0')).replace('MM',pad(p.m)).replace('DD',pad(p.d));
    let time=pad(p.h)+':'+pad(p.min);
    if(c.timeFormat==='12')time=new Intl.DateTimeFormat(c.lang,{hour:'numeric',minute:'2-digit',hour12:true,timeZone:'UTC'}).format(new Date(Date.UTC(2000,0,1,p.h,p.min)));
    return type==='date'?date:type==='time'?time:date+' '+time;
  }
  function styles() {
    if(document.getElementById('mvm-picker-style'))return;
    const s=document.createElement('style');s.id='mvm-picker-style';s.textContent=`
.mvm-picker-trigger{display:flex;align-items:center;justify-content:space-between;gap:12px;width:100%;min-width:0;min-height:46px;padding:11px 12px;border:1px solid var(--pub-border,var(--border,#45475a));border-radius:10px;background:var(--pub-surface2,var(--surface2,#24293b));color:var(--pub-fg,var(--text,#e6e9f2));font:inherit;text-align:left;cursor:pointer}.mvm-picker-trigger:disabled{opacity:.5;cursor:default}.mvm-picker-trigger:focus-visible,.mvm-picker button:focus-visible,.mvm-picker select:focus-visible,.mvm-picker input:focus-visible{outline:2px solid var(--pub-accent,var(--accent,#60a5fa));outline-offset:2px}
.mvm-picker{box-sizing:border-box;width:min(380px,calc(100vw - 24px));max-height:calc(100dvh - 24px);overflow:auto;padding:20px;border:1px solid var(--pub-border,var(--border,#45475a));border-radius:20px;background:var(--pub-surface1,var(--surface,#1b2133));color:var(--pub-fg,var(--text,#e6e9f2));font:14px system-ui,sans-serif;box-shadow:0 24px 90px #0008}.mvm-picker *{box-sizing:border-box}.mvm-picker::backdrop{background:#0008}.mvm-picker h2{font-size:18px;margin:0 0 18px;overflow-wrap:anywhere}.mvm-picker button,.mvm-picker input,.mvm-picker select{font:inherit;color:inherit}.mvm-picker button{cursor:pointer}.mvm-picker button:disabled{opacity:.3;cursor:default}.mvm-picker-nav{display:flex;align-items:center;gap:7px;margin-bottom:12px}.mvm-picker select,.mvm-picker input{background:var(--pub-surface2,var(--surface2,#252d45));border:1px solid var(--pub-border,var(--border,#45475a));border-radius:9px;min-height:40px;padding:6px;min-width:0;color-scheme:inherit}.mvm-picker-nav select{flex:1}.mvm-picker-nav input{width:75px}.mvm-picker-nav button{background:transparent;border:0;min-width:34px;min-height:40px;border-radius:8px}.mvm-picker-grid{display:grid;grid-template-columns:repeat(7,minmax(0,1fr));gap:3px}.mvm-picker-weekday{text-align:center;color:var(--pub-fg2,var(--text-dim,#9aa4bd));padding:7px 0;font-size:11px}.mvm-picker-day{border:0;border-radius:10px;background:transparent;min-height:40px;padding:0}.mvm-picker-day[data-other=true]{opacity:.45}.mvm-picker-day[aria-selected=true]{background:var(--pub-accent,var(--accent,#60a5fa));color:var(--pub-bg,var(--bg,#0f1320));font-weight:700}.mvm-picker-day[data-today=true]{box-shadow:inset 0 0 0 1px var(--pub-accent,var(--accent,#60a5fa))}.mvm-picker-time{display:flex;gap:10px;margin-top:18px;padding-top:16px;border-top:1px solid var(--pub-border,var(--border,#45475a))}.mvm-picker-time label{flex:1;font-size:12px}.mvm-picker-time select{display:block;width:100%;margin-top:7px}.mvm-picker-error{color:var(--pub-red,#fda4af);line-height:1.5}.mvm-picker-actions{display:flex;flex-wrap:wrap;gap:8px;margin-top:18px}.mvm-picker-actions button{border:0;border-radius:9px;min-height:40px;padding:8px 12px;background:var(--pub-surface2,var(--surface2,#252d45))}.mvm-picker-actions [data-apply]{margin-left:auto;background:var(--pub-accent,var(--accent,#60a5fa));color:var(--pub-bg,var(--bg,#0f1320))}
`;document.head.appendChild(s);
  }
  function create(host,options={}) {
    styles();const o={type:'datetime',...options};if(!['date','time','datetime'].includes(o.type))throw new TypeError('Invalid picker type');
    const input=document.createElement('input');input.type='hidden';input.name=o.name||'';
    const button=document.createElement('button');button.type='button';button.className='mvm-picker-trigger';button.setAttribute('aria-haspopup','dialog');button.disabled=!!o.disabled;
    host.append(input,button);let current='',dialog=null,dead=false;
    function setValue(v,notify=false){if(v&&!parse(v,o.type))throw new TypeError('Invalid picker value');current=v||'';input.value=current;button.textContent=(format(current,o)||o.placeholder||o.label||tr(o.type))+'  ▾';button.setAttribute('aria-label',(o.label?o.label+': ':'')+(format(current,o)||tr(o.type)));if(notify){input.dispatchEvent(new Event('change',{bubbles:true}));if(o.onChange)o.onChange(current);}}
    const valid=v=>(!v&&!o.required)||!!(parse(v,o.type)&&(!o.min||v>=o.min)&&(!o.max||v<=o.max)&&(o.type!=='datetime'||toEpoch(v,o)!==null));
    function close(){if(dialog){dialog.close();dialog.remove();dialog=null;}}
    async function open(){await ready();if(dead||dialog)return;
      const cfg=settings(o),now=parts(Date.now()/1000,o),text=k=>(o.labels&&o.labels[k])||tr(k);let p=parse(current,o.type)||now,view={y:p.y,m:p.m};
      dialog=document.createElement('dialog');const d=dialog;d.className='mvm-picker';d.lang=cfg.lang;d.setAttribute('aria-label',o.label||text(o.type));
      const today=canonical(now,'date');let focusDate=canonical(p,'date');
      function daysIn(y,m){return new Date(Date.UTC(y,m,0)).getUTCDate();}
      function changeMonth(delta){const date=new Date(Date.UTC(view.y,view.m-1+delta,1));view={y:date.getUTCFullYear(),m:date.getUTCMonth()+1};draw();}
      function draw(focus){
        const dayLabels=Array.from({length:7},(_,i)=>new Intl.DateTimeFormat(cfg.lang,{weekday:'short',timeZone:'UTC'}).format(new Date(Date.UTC(2024,0,7+i+(cfg.weekStarts==='monday'?1:0)))));
        const months=Array.from({length:12},(_,i)=>new Intl.DateTimeFormat(cfg.lang,{month:'long',timeZone:'UTC'}).format(new Date(Date.UTC(2024,i,1))));
        const weekday=(new Date(Date.UTC(view.y,view.m-1,1)).getUTCDay()+(cfg.weekStarts==='monday'?6:0))%7;
        const cells=Array.from({length:42},(_,i)=>{const date=new Date(Date.UTC(view.y,view.m-1,i-weekday+1)),q={y:date.getUTCFullYear(),m:date.getUTCMonth()+1,d:date.getUTCDate(),h:p.h,min:p.min},v=canonical(q,'date');const min=o.min&&o.min.slice(0,10),max=o.max&&o.max.slice(0,10);return `<button type="button" role="gridcell" class="mvm-picker-day" data-date="${v}" data-other="${q.m!==view.m}" data-today="${v===today}" aria-selected="${v===canonical(p,'date')}" aria-label="${esc(new Intl.DateTimeFormat(cfg.lang,{dateStyle:'full',timeZone:'UTC'}).format(date))}" tabindex="${v===focusDate?0:-1}" ${min&&v<min||max&&v>max?'disabled':''}>${q.d}</button>`;}).join('');
        const select=(key,label,values,value)=>`<label>${esc(label)}<select data-time="${key}">${values.map(([v,l])=>`<option value="${v}" ${+v===value?'selected':''}>${esc(l)}</option>`).join('')}</select></label>`;
        const hour12=cfg.timeFormat==='12',hours=Array.from({length:hour12?12:24},(_,i)=>[hour12?i+1:i,pad(hour12?i+1:i)]),minutes=Array.from({length:60},(_,i)=>[i,pad(i)]);
        const period=h=>new Intl.DateTimeFormat(cfg.lang,{hour:'numeric',hour12:true,timeZone:'UTC'}).formatToParts(new Date(Date.UTC(2000,0,1,h))).find(x=>x.type==='dayPeriod').value;
        d.innerHTML=`<h2>${esc(o.label||text(o.type))}</h2>${o.type!=='time'?`<div class="mvm-picker-nav"><button type="button" data-prev aria-label="${esc(text('previous'))}">‹</button><select data-month aria-label="${esc(text('month'))}">${months.map((m,i)=>`<option value="${i+1}" ${i+1===view.m?'selected':''}>${esc(m)}</option>`).join('')}</select><input data-year type="number" min="100" max="9999" value="${view.y}" aria-label="${esc(text('year'))}"><button type="button" data-next aria-label="${esc(text('next'))}">›</button></div><div class="mvm-picker-grid">${dayLabels.map(x=>`<span class="mvm-picker-weekday">${esc(x)}</span>`).join('')}</div><div class="mvm-picker-grid" role="grid" aria-label="${esc(text('date'))}">${cells}</div>`:''}${o.type!=='date'?`<div class="mvm-picker-time">${select('hour',text('hour'),hours,hour12?(p.h%12||12):p.h)}${select('minute',text('minute'),minutes,p.min)}${hour12?select('period',text('period'),[[0,period(0)],[1,period(12)]],p.h>=12?1:0):''}</div>`:''}<p class="mvm-picker-error" role="alert"></p><div class="mvm-picker-actions"><button type="button" data-now>${esc(text(o.type==='date'?'today':'now'))}</button>${!o.required?`<button type="button" data-clear>${esc(text('clear'))}</button>`:''}<button type="button" data-cancel>${esc(text('cancel'))}</button><button type="button" data-apply>${esc(text('apply'))}</button></div>`;
        const tabStop=d.querySelector('.mvm-picker-day[tabindex="0"]:not(:disabled)')||d.querySelector('.mvm-picker-day[data-other="false"]:not(:disabled)')||d.querySelector('.mvm-picker-day:not(:disabled)');if(tabStop)tabStop.tabIndex=0;
        const on=(sel,event,fn)=>{const el=d.querySelector(sel);if(el)el.addEventListener(event,fn);};
        on('[data-prev]','click',()=>changeMonth(-1));on('[data-next]','click',()=>changeMonth(1));
        on('[data-month]','change',e=>{view.m=+e.target.value;draw();});on('[data-year]','change',e=>{const y=+e.target.value;if(y>=100&&y<=9999){view.y=y;draw();}});
        d.querySelectorAll('[data-date]').forEach(b=>{b.onclick=()=>{const q=parse(b.dataset.date,'date');p={...p,y:q.y,m:q.m,d:q.d};view={y:p.y,m:p.m};focusDate=b.dataset.date;draw(focusDate);};b.onkeydown=e=>{const active=parse(b.dataset.date,'date');let shift=({ArrowLeft:-1,ArrowRight:1,ArrowUp:-7,ArrowDown:7})[e.key];if(e.key==='Home')shift=-(new Date(Date.UTC(active.y,active.m-1,active.d)).getUTCDay()+(cfg.weekStarts==='monday'?6:0))%7;if(e.key==='End')shift=6-(new Date(Date.UTC(active.y,active.m-1,active.d)).getUTCDay()+(cfg.weekStarts==='monday'?6:0))%7;if(e.key==='PageUp'||e.key==='PageDown'){e.preventDefault();changeMonth(e.key==='PageUp'?-1:1);return;}if(shift==null)return;e.preventDefault();const q=new Date(Date.UTC(active.y,active.m-1,active.d+shift));const candidate=canonical({y:q.getUTCFullYear(),m:q.getUTCMonth()+1,d:q.getUTCDate()},'date');if(o.min&&candidate<o.min.slice(0,10)||o.max&&candidate>o.max.slice(0,10))return;p={...p,y:q.getUTCFullYear(),m:q.getUTCMonth()+1,d:q.getUTCDate()};view={y:p.y,m:p.m};focusDate=canonical(p,'date');draw(focusDate);};});
        d.querySelectorAll('[data-time]').forEach(el=>el.onchange=()=>{const hour=+d.querySelector('[data-time=hour]').value,minute=+d.querySelector('[data-time=minute]').value;p.h=hour12?(hour%12)+(+d.querySelector('[data-time=period]').value)*12:hour;p.min=minute;});
        on('[data-now]','click',()=>{p=parts(Date.now()/1000,o);view={y:p.y,m:p.m};focusDate=canonical(p,'date');draw(focusDate);});on('[data-clear]','click',()=>{setValue('',true);close();});on('[data-cancel]','click',close);
        on('[data-apply]','click',()=>{const v=canonical(p,o.type);if(!valid(v)){d.querySelector('[role=alert]').textContent=text('invalid');return;}setValue(v,true);close();});
        if(focus){const el=d.querySelector(`[data-date="${focus}"]`);if(el)el.focus();}
      }
      d.addEventListener('close',()=>{d.remove();if(dialog===d)dialog=null;if(button.isConnected)button.focus();},{once:true});
      (host.closest('dialog')||document.body).appendChild(d);draw();const rgb=getComputedStyle(d).backgroundColor.match(/[\d.]+/g);if(rgb)d.style.colorScheme=(+rgb[0]*.299 + +rgb[1]*.587 + +rgb[2]*.114)>140?'light':'dark';d.showModal();const selected=d.querySelector(`[data-date="${focusDate}"]`);if(selected)selected.focus();
    }
    button.onclick=open;setValue(o.value||'');ready().then(()=>{if(!dead)setValue(current);});
    const refresh=()=>{if(!dead){close();setValue(current);}};window.addEventListener('settings-changed',refresh);window.addEventListener('i18n-loaded',refresh);
    return {get value(){return current;},setValue,open,button,input,validate:()=>valid(current),destroy(){dead=true;close();window.removeEventListener('settings-changed',refresh);window.removeEventListener('i18n-loaded',refresh);input.remove();button.remove();}};
  }
  window.mvmOS.dateTimePicker={create,ready,format,fromEpoch,toEpoch,settings};
})();
