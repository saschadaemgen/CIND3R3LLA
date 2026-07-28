/**
 * Marketing-site client scripts (CCB-S3-001) — vanilla ports of the template's
 * React effects, emitted inline under the per-response CSP nonce (no external
 * scripts, no framework). Everything degrades gracefully: without JS the page is
 * fully rendered (SSR), reveal targets stay visible via the `.no-js` rule, and
 * the archive demo simply shows all sample rows.
 */

/** Head boot: mark JS availability for the reveal-fallback CSS (dark-only site,
 * no theme storage). */
export const JS_BOOT_SCRIPT = `document.documentElement.className='js';`;

/** Header chrome: mobile burger menu + closing the language dropdown on outside
 * clicks (the details element handles opening natively, no JS required). */
export const CHROME_SCRIPT = `(function(){
function boot(){
/* ---- The fullscreen menu (CCB-S3-035 4a) ---------------------------------- */
var menu=document.getElementById('cn-menu');
var burger=document.getElementById('cn-burger');
var lastFocus=null;
function setMenu(open){
  if(!menu)return;
  if(open){menu.removeAttribute('hidden');}
  /* Read back before flipping the flag so the transition actually runs. */
  void menu.offsetWidth;
  menu.setAttribute('data-open',open?'true':'false');
  document.documentElement.style.overflow=open?'hidden':'';
  if(burger){burger.classList.toggle('open',open);burger.setAttribute('aria-expanded',open?'true':'false');}
  if(open){lastFocus=document.activeElement;var c=menu.querySelector('[data-menu-close]');if(c)c.focus();}
  else{
    /* Hide only after the transition, so it fades out instead of vanishing. */
    setTimeout(function(){if(menu.getAttribute('data-open')!=='true')menu.setAttribute('hidden','');},220);
    if(lastFocus&&lastFocus.focus)lastFocus.focus();
  }
}
/* ONE SECTION AT A TIME (CCB-S3-037 2). Every block was rendered open, so the
   menu showed all four at once. Blocks ship hidden; the trigger reveals the one it
   names, and the burger (which names none) reveals the first. */
function showSection(key){
  var panels=[].slice.call(document.querySelectorAll('[data-mega-panel]'));
  if(!panels.length)return;
  var wanted=key&&document.querySelector('[data-mega-panel="'+key+'"]');
  panels.forEach(function(p){p.setAttribute('hidden','');p.setAttribute('aria-hidden','true');});
  var show=wanted||panels[0];
  show.removeAttribute('hidden');show.setAttribute('aria-hidden','false');
}
document.querySelectorAll('[data-menu-open]').forEach(function(b){
  b.addEventListener('click',function(e){
    e.preventDefault();
    var open=menu&&menu.getAttribute('data-open')!=='true';
    if(open)showSection(b.getAttribute('data-section'));
    setMenu(open);
  });
});
document.querySelectorAll('[data-menu-close]').forEach(function(b){
  b.addEventListener('click',function(){setMenu(false);});
});
document.addEventListener('keydown',function(e){
  if(e.key!=='Escape')return;
  if(menu&&menu.getAttribute('data-open')==='true'){setMenu(false);return;}
  var lm=document.querySelector('details.lang-menu[open]');
  if(lm){lm.removeAttribute('open');var sum=lm.querySelector('summary');if(sum)sum.focus();}
});
document.addEventListener('click',function(e){
  document.querySelectorAll('details.lang-menu[open]').forEach(function(d){
    if(!d.contains(e.target))d.removeAttribute('open');
  });
});

/* ---- The travelling nav indicator (CCB-S3-035 4b) --------------------------
   ONE element that animates its position and width between items, so it reads as
   a single object tracking the cursor. Hover moves it, keyboard focus moves it,
   and leaving the nav returns it to the active item. */
var nav=document.querySelector('.hdr-nav');
var ind=nav&&nav.querySelector('[data-nav-indicator]');
if(nav&&ind){
  var items=[].slice.call(nav.querySelectorAll('[data-nav-item]'));
  function activeItem(){
    return nav.querySelector('[data-nav-item].active')||items[0];
  }
  function moveTo(el){
    if(!el)return;
    var nr=nav.getBoundingClientRect(),r=el.getBoundingClientRect();
    /* Slightly narrower than the item, so it reads as drawn rather than as a
       default text underline stretched edge to edge. */
    /* Align to the LABEL, not the padded box: the item carries 15px of horizontal
       padding, and insetting by a fraction of the width put the bar off-centre and
       too wide. Reading the real padding makes it sit exactly under the text. */
    var cs=getComputedStyle(el);
    var padL=parseFloat(cs.paddingLeft)||0, padR=parseFloat(cs.paddingRight)||0;
    ind.style.width=Math.max(0,r.width-padL-padR)+'px';
    ind.style.transform='translate3d('+(r.left-nr.left+padL)+'px,0,0)';
    ind.setAttribute('data-ready','true');
  }
  items.forEach(function(el){
    el.addEventListener('mouseenter',function(){moveTo(el);});
    el.addEventListener('focus',function(){moveTo(el);});
  });
  nav.addEventListener('mouseleave',function(){moveTo(activeItem());});
  nav.addEventListener('focusout',function(e){
    if(!nav.contains(e.relatedTarget))moveTo(activeItem());
  });
  requestAnimationFrame(function(){moveTo(activeItem());});
  addEventListener('resize',function(){moveTo(activeItem());});
}

/* ---- The headline rotator (CCB-S3-035 3) ----------------------------------
   The header controls' glitch: hard steps, a brief cyan/magenta tear, no soft
   crossfade. Width is reserved in CSS by stacking every phrase, so nothing shifts.
   Under reduced motion it holds the first phrase and never cycles. */
var rot=document.querySelector('[data-hero-rotator]');
if(rot&&!matchMedia('(prefers-reduced-motion: reduce)').matches){
  var phrases=[].slice.call(rot.querySelectorAll('[data-hero-phrase]'));
  if(phrases.length>1){
    var cur=0;
    setInterval(function(){
      if(document.hidden)return;
      var from=phrases[cur];
      cur=(cur+1)%phrases.length;
      var to=phrases[cur];
      from.removeAttribute('data-on');from.setAttribute('aria-hidden','true');
      to.setAttribute('data-on','');to.removeAttribute('aria-hidden');
      to.classList.remove('glitch');void to.offsetWidth;to.classList.add('glitch');
    },3600);
  }
}
}
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',boot);
else boot();
})();`;

/** Twinkling multi-colour starfield (white / cyan / magenta), honors reduced motion. */
export const STARFIELD_SCRIPT = `(function(){
var cv=document.getElementById('cn-starfield');if(!cv)return;
var ctx=cv.getContext('2d');if(!ctx)return;
var DPR=Math.min(window.devicePixelRatio||1,2);
var reduce=matchMedia('(prefers-reduced-motion: reduce)').matches;
var palette=[[255,255,255],[141,225,236],[244,92,176]];
var w,h,stars=[],raf,t=0;
function build(){
  w=innerWidth;h=innerHeight;cv.width=w*DPR;cv.height=h*DPR;ctx.setTransform(DPR,0,0,DPR,0,0);
  var n=Math.min(190,Math.floor(w*h/9000));
  stars=[];
  for(var i=0;i<n;i++){var r=Math.random();var ci=r<0.72?0:r<0.9?1:2;
    stars.push({x:Math.random()*w,y:Math.random()*h,r:Math.random()*1.3+0.35,c:palette[ci],ph:Math.random()*6.283,sp:0.5+Math.random()*1.7,base:0.3+Math.random()*0.5});}
}
build();addEventListener('resize',build);
function draw(){
  ctx.clearRect(0,0,w,h);
  for(var i=0;i<stars.length;i++){var s=stars[i];
    var a=reduce?s.base:Math.max(0,Math.min(1,s.base+Math.sin(t*s.sp+s.ph)*0.4));
    ctx.fillStyle='rgba('+s.c[0]+','+s.c[1]+','+s.c[2]+','+a+')';
    ctx.beginPath();ctx.arc(s.x,s.y,s.r,0,6.283);ctx.fill();
    if(s.r>1){ctx.fillStyle='rgba('+s.c[0]+','+s.c[1]+','+s.c[2]+','+(a*0.25)+')';
      ctx.beginPath();ctx.arc(s.x,s.y,s.r*2.8,0,6.283);ctx.fill();}}
}
function frame(){t+=0.016;draw();raf=requestAnimationFrame(frame);}
if(reduce)draw();else frame();
})();`;

/** Scroll reveals for [data-reveal] sections. */
export const REVEAL_SCRIPT = `(function(){
if(!('IntersectionObserver' in window))return;
var io=new IntersectionObserver(function(es){es.forEach(function(en){
  if(en.isIntersecting){en.target.classList.add('on');io.unobserve(en.target);}});},{threshold:.12});
document.querySelectorAll('[data-reveal]:not(.on)').forEach(function(el){io.observe(el);});
})();`;

export interface DemoMessage {
  g: string;
  a: string;
  t: string;
  text: string;
  media?: 'file' | 'video' | 'image';
}

export interface DemoConfig {
  messages: DemoMessage[];
  groups: string[];
  word: string;
  i18n: {
    messages: string;
    of: string;
    empty: string;
    archived: string;
    attachment: string;
  };
  /** Inline SVG markup for the client-rendered rows (check/lock/media icons). */
  icons: Record<string, string>;
}

/** The interactive archive demo (search + filters + typing animation). */
export function archiveDemoScript(cfg: DemoConfig): string {
  const json = JSON.stringify(cfg).replace(/</g, '\\u003c');
  return `(function(){
var CFG=${json};
var root=document.getElementById('cn-ad');if(!root)return;
var input=document.getElementById('cn-ad-input');
var clearBtn=document.getElementById('cn-ad-clear');
var stream=document.getElementById('cn-ad-stream');
var empty=document.getElementById('cn-ad-empty');
var countEl=document.getElementById('cn-ad-count');
var urlEl=document.getElementById('cn-ad-url-group');
var mediaBtn=document.getElementById('cn-ad-media');
if(!input||!stream||!countEl)return;
var q='',group='all',mediaOnly=false,interacted=false;
function esc(s){return s.replace(/[&<>"']/g,function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c];});}
function hl(text){
  if(!q)return esc(text);
  var e=q.replace(/[.*+?^\${}()|[\\]\\\\]/g,'\\\\$&');
  var parts=text.split(new RegExp('('+e+')','ig'));
  var out='';
  for(var i=0;i<parts.length;i++){
    if(parts[i].toLowerCase()===q.toLowerCase()&&parts[i])out+='<mark class="ad-hl">'+esc(parts[i])+'</mark>';
    else out+=esc(parts[i]);
  }
  return out;
}
function rows(){
  return CFG.messages.filter(function(m){
    return (group==='all'||m.g===group)&&(!mediaOnly||m.media)&&
      (!q||(m.text+' '+m.a+' '+m.g).toLowerCase().indexOf(q.toLowerCase())>=0);
  });
}
var MEDIA_ICON={file:'file-text',video:'clapperboard',image:'image'};
function mediaChip(m){
  if(!m.media)return '';
  var label=m.media==='file'?CFG.i18n.attachment:(m.media==='video'?'video · behind auth':'image · behind auth');
  return '<div class="ad-chip">'+CFG.icons[MEDIA_ICON[m.media]]+'<span>'+esc(label)+'</span>'+CFG.icons.lock+'</div>';
}
function render(){
  var rs=rows();
  var htmlOut='';
  for(var i=0;i<rs.length;i++){var m=rs[i];
    htmlOut+='<div class="ad-msg"><span class="ad-avatar" aria-hidden="true">'+esc(m.a[0].toUpperCase())+'</span>'+
      '<div class="ad-msg-body"><div class="ad-meta"><b>'+hl(m.a)+'</b><span class="ad-grp">'+hl(m.g)+'</span>'+
      '<span class="ad-time">'+esc(m.t)+'</span><span class="ad-arch">'+CFG.icons.check+esc(CFG.i18n.archived)+'</span></div>'+
      '<div class="ad-text">'+hl(m.text)+'</div>'+mediaChip(m)+'</div></div>';
  }
  stream.innerHTML=htmlOut;
  if(empty){
    if(rs.length===0){empty.style.display='flex';var qe=document.getElementById('cn-ad-empty-q');if(qe)qe.textContent='\\u201C'+q+'\\u201D.';}
    else empty.style.display='none';
  }
  var total=CFG.messages.length;
  var base=rs.length===total?CFG.i18n.messages.replace('{n}',String(total)):CFG.i18n.of.replace('{n}',String(rs.length)).replace('{total}',String(total));
  countEl.innerHTML=esc(base)+(q?' <span class="ad-q">· \\u201C'+esc(q)+'\\u201D</span>':'');
  if(clearBtn)clearBtn.style.display=q?'inline-flex':'none';
  if(urlEl)urlEl.textContent=group==='all'?urlEl.getAttribute('data-all'):group;
  root.querySelectorAll('.ad-g').forEach(function(b){
    b.classList.toggle('on',b.getAttribute('data-group')===group);
  });
  if(mediaBtn){mediaBtn.classList.toggle('cn-tag-selected',mediaOnly);mediaBtn.setAttribute('aria-pressed',mediaOnly?'true':'false');}
}
function stop(){interacted=true;}
root.querySelectorAll('.ad-g').forEach(function(b){
  b.addEventListener('click',function(){stop();group=b.getAttribute('data-group');render();});
});
if(mediaBtn)mediaBtn.addEventListener('click',function(){stop();mediaOnly=!mediaOnly;render();});
input.addEventListener('input',function(){stop();q=input.value;render();});
input.addEventListener('focus',stop);
if(clearBtn)clearBtn.addEventListener('click',function(){stop();q='';input.value='';render();input.focus();});
render();
if(!matchMedia('(prefers-reduced-motion: reduce)').matches){
  var timers=[],word=CFG.word;
  function type(i){if(interacted)return;q=word.slice(0,i);input.value=q;render();
    if(i<word.length)timers.push(setTimeout(function(){type(i+1);},150));
    else timers.push(setTimeout(function(){del(word.length);},1600));}
  function del(i){if(interacted)return;q=word.slice(0,i);input.value=q;render();
    if(i>0)timers.push(setTimeout(function(){del(i-1);},80));}
  timers.push(setTimeout(function(){type(1);},900));
}
})();`;
}
