(function () {
  'use strict';
  let startDate = null, endDate = null, hoverDate = null;
  let cal1Year, cal1Month, cal2Year, cal2Month;
  const today = new Date();
  cal1Year  = today.getFullYear();
  cal1Month = today.getMonth();
  cal2Year  = today.getMonth() === 11 ? today.getFullYear() + 1 : today.getFullYear();
  cal2Month = (today.getMonth() + 1) % 12;
  const DAYS   = ['Do','Lu','Ma','Mi','Ju','Vi','Sá'];
  const MONTHS = ['Enero','Febrero','Marzo','Abril','Mayo','Junio','Julio','Agosto','Septiembre','Octubre','Noviembre','Diciembre'];
  function fmt(d)    { if (!d) return ''; return String(d.getDate()).padStart(2,'0') + '/' + String(d.getMonth()+1).padStart(2,'0') + '/' + d.getFullYear(); }
  function fmtISO(d) { if (!d) return ''; return d.getFullYear() + '-' + String(d.getMonth()+1).padStart(2,'0') + '-' + String(d.getDate()).padStart(2,'0'); }
  function parseISO(s) { if (!s) return null; const p = s.split('-').map(Number); if (p.length!==3||p.some(isNaN)) return null; return new Date(p[0],p[1]-1,p[2]); }
  function sameDay(a,b) { return a&&b&&a.getFullYear()===b.getFullYear()&&a.getMonth()===b.getMonth()&&a.getDate()===b.getDate(); }
  function renderCal(containerId,year,month,navPrev,navNext) {
    const wrap = document.getElementById(containerId); if (!wrap) return;
    let html = '<div class="drp-nav"><button class="drp-nav-btn" data-action="'+navPrev+'" aria-label="Mes anterior">‹</button><span class="drp-month-label">'+MONTHS[month]+' '+year+'</span><button class="drp-nav-btn" data-action="'+navNext+'" aria-label="Mes siguiente">›</button></div>';
    html += '<div class="drp-grid" role="grid">';
    DAYS.forEach(function(d){ html+='<div class="drp-dow" role="columnheader">'+d+'</div>'; });
    const first = new Date(year,month,1).getDay();
    for(let i=0;i<first;i++) html+='<div class="drp-day drp-empty" role="gridcell"></div>';
    const dim = new Date(year,month+1,0).getDate();
    for(let d=1;d<=dim;d++){
      const cur=new Date(year,month,d); const isoDate=fmtISO(cur); let cls='drp-day';
      const isToday=sameDay(cur,today); if(isToday) cls+=' drp-today';
      const s=startDate, e=endDate||hoverDate;
      if(s&&e){ const mn=s<e?s:e,mx=s<e?e:s; if(sameDay(cur,mn)) cls+=' drp-range-start'; else if(sameDay(cur,mx)) cls+=' drp-range-end'; else if(cur>mn&&cur<mx) cls+=' drp-in-range'; } else if(sameDay(cur,startDate)) cls+=' drp-selected';
      html+='<div class="'+cls+'" data-date="'+isoDate+'" role="gridcell" tabindex="0"'+(isToday?' aria-current="date"':'')+'>'+d+'</div>';
    }
    html+='</div>'; wrap.innerHTML=html;
    wrap.querySelectorAll('[data-action]').forEach(function(btn){ btn.addEventListener('click',function(e){ e.stopPropagation(); handleNav(btn.dataset.action); }); });
    wrap.querySelectorAll('.drp-day[data-date]').forEach(function(cell){
      cell.addEventListener('click',function(){ handleDayClick(cell.dataset.date); });
      cell.addEventListener('keydown',function(e){ if(e.key==='Enter'||e.key===' '){ e.preventDefault(); handleDayClick(cell.dataset.date); } });
      cell.addEventListener('mouseenter',function(){ hoverDate=parseISO(cell.dataset.date); updateDisplay(); });
      cell.addEventListener('mouseleave',function(){ hoverDate=null; updateDisplay(); });
    });
  }
  function renderBoth(){ renderCal('drpCal1',cal1Year,cal1Month,'prev1','next1'); renderCal('drpCal2',cal2Year,cal2Month,'prev2','next2'); updateDisplay(); }
  function handleNav(action){
    if(action==='prev1'){ cal1Month--; if(cal1Month<0){ cal1Month=11; cal1Year--; } }
    if(action==='next1'){ cal1Month++; if(cal1Month>11){ cal1Month=0; cal1Year++; } }
    if(action==='prev2'){ cal2Month--; if(cal2Month<0){ cal2Month=11; cal2Year--; } }
    if(action==='next2'){ cal2Month++; if(cal2Month>11){ cal2Month=0; cal2Year++; } }
    renderBoth();
  }
  function handleDayClick(iso){ const d=parseISO(iso); if(!d) return; if(!startDate||(startDate&&endDate)){ startDate=d; endDate=null; } else { if(d<startDate){ endDate=startDate; startDate=d; } else { endDate=d; } } updateInputs(); renderBoth(); }
  function updateDisplay(){
    const disp=document.getElementById('drpRangeDisplay'), trigger=document.getElementById('drpLabel'), btn=document.getElementById('drpTrigger'), clearBtn=document.getElementById('btnClearDates');
    if(startDate&&endDate){ const txt=fmt(startDate)+' → '+fmt(endDate); if(disp)disp.textContent=txt; if(trigger)trigger.textContent=txt; if(btn){btn.classList.add('active');btn.setAttribute('aria-expanded','true');} if(clearBtn)clearBtn.style.display=''; }
    else if(startDate){ const txt=fmt(startDate)+' → …'; if(disp)disp.textContent=txt; if(trigger)trigger.textContent=txt; if(btn){btn.classList.add('active');btn.setAttribute('aria-expanded','true');} }
    else { if(disp)disp.textContent='Sin selección'; if(trigger)trigger.textContent='Rango de fechas'; if(btn){btn.classList.remove('active');btn.setAttribute('aria-expanded','false');} }
    const fi=document.getElementById('drpFromInput'), ti=document.getElementById('drpToInput');
    if(fi)fi.value=fmt(startDate)||''; if(ti)ti.value=fmt(endDate)||'';
  }
  function updateInputs(){ const fromEl=document.getElementById('dateFrom'), toEl=document.getElementById('dateTo'); if(fromEl){fromEl.value=fmtISO(startDate);fromEl.dispatchEvent(new Event('change'));} if(toEl){toEl.value=fmtISO(endDate);toEl.dispatchEvent(new Event('change'));} }
  function clearAll(){ startDate=null;endDate=null;hoverDate=null;updateInputs();updateDisplay();const c=document.getElementById('btnClearDates');if(c)c.style.display='none'; }
  const trigger=document.getElementById('drpTrigger'),popover=document.getElementById('drpPopover');
  function openPicker(){ if(window.innerWidth<=600){ popover.style.top='';popover.style.left='0';popover.style.bottom='0';popover.style.right='0'; } else { popover.style.bottom='';popover.style.right='';const rect=trigger.getBoundingClientRect();popover.style.top=(rect.bottom+6)+'px';popover.style.left=Math.min(rect.left,window.innerWidth-590)+'px'; } popover.classList.add('open');if(trigger)trigger.setAttribute('aria-expanded','true');renderBoth(); }
  function closePicker(){ popover.classList.remove('open');hoverDate=null;if(trigger)trigger.setAttribute('aria-expanded','false'); }
  if(trigger) trigger.addEventListener('click',function(e){ e.stopPropagation(); popover.classList.contains('open')?closePicker():openPicker(); });
  const drpClose=document.getElementById('drpClose'); if(drpClose) drpClose.addEventListener('click',closePicker);
  document.addEventListener('click',function(e){ if(popover&&!popover.contains(e.target)&&e.target!==trigger) closePicker(); });
  document.addEventListener('keydown',function(e){ if(e.key==='Escape'&&popover&&popover.classList.contains('open')) closePicker(); });
  const applyBtn=document.getElementById('drpApplyBtn'); if(applyBtn) applyBtn.addEventListener('click',function(){ updateInputs();closePicker(); });
  const clearBtnDrp=document.getElementById('drpClearBtn'); if(clearBtnDrp) clearBtnDrp.addEventListener('click',function(){ clearAll();renderBoth(); });
  const btnClearDates=document.getElementById('btnClearDates'); if(btnClearDates) btnClearDates.addEventListener('click',function(){ clearAll();if(popover.classList.contains('open'))renderBoth(); });
  document.querySelectorAll('.drp-sc').forEach(function(btn){ btn.addEventListener('click',function(){
    const sc=btn.dataset.sc;
    if(sc==='today'){ startDate=new Date(today.getFullYear(),today.getMonth(),today.getDate());endDate=new Date(startDate); }
    else if(sc==='yesterday'){ const y=new Date(today);y.setDate(today.getDate()-1);startDate=new Date(y.getFullYear(),y.getMonth(),y.getDate());endDate=new Date(startDate); }
    else if(sc==='week'){ const d=new Date(today);d.setDate(today.getDate()-today.getDay());startDate=new Date(d.getFullYear(),d.getMonth(),d.getDate());endDate=new Date(today.getFullYear(),today.getMonth(),today.getDate()); }
    else if(sc==='lastweek'){ const d=new Date(today);d.setDate(today.getDate()-today.getDay()-7);startDate=new Date(d.getFullYear(),d.getMonth(),d.getDate());endDate=new Date(startDate);endDate.setDate(startDate.getDate()+6); }
    else if(sc==='month'){ startDate=new Date(today.getFullYear(),today.getMonth(),1);endDate=new Date(today.getFullYear(),today.getMonth(),today.getDate()); }
    else if(sc==='lastmonth'){ const pm=today.getMonth()===0?11:today.getMonth()-1,py=today.getMonth()===0?today.getFullYear()-1:today.getFullYear();startDate=new Date(py,pm,1);endDate=new Date(py,pm+1,0); }
    else if(sc==='quarter'){ const d=new Date(today);d.setDate(today.getDate()-90);startDate=new Date(d.getFullYear(),d.getMonth(),d.getDate());endDate=new Date(today.getFullYear(),today.getMonth(),today.getDate()); }
    updateInputs();renderBoth();
  }); });
  function parseDMY(s){ const p=s.split('/');if(p.length===3){const d=new Date(+p[2],+p[1]-1,+p[0]);return isNaN(d)?null:d;}return null; }
  const drpFromInput=document.getElementById('drpFromInput'),drpToInput=document.getElementById('drpToInput');
  if(drpFromInput) drpFromInput.addEventListener('change',function(e){ const d=parseDMY(e.target.value);if(d){startDate=d;renderBoth();} });
  if(drpToInput)   drpToInput.addEventListener('change',function(e){ const d=parseDMY(e.target.value);if(d){endDate=d;renderBoth();} });
})();
