'use strict';
const $=s=>document.querySelector(s);
const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const url=v=>{try{const u=new URL(v);return ['https:','http:'].includes(u.protocol)?esc(u.href):'#'}catch{return '#'}};
const link=(label,u,cl='')=>'<a class="'+cl+'" href="'+url(u)+'" target="_blank" rel="noopener noreferrer">'+label+'</a>';
const asset=p=>window.ATLAS_ASSETS?.[p]||p;
const loadJson=async p=>{if(window.ATLAS_DATA&&p in window.ATLAS_DATA)return window.ATLAS_DATA[p];const res=await fetch(p);if(!res.ok)throw Error(p+' '+res.status);return res.json()};
const fmt=n=>n.toLocaleString('zh-CN');
const read=(k,d)=>{try{return JSON.parse(localStorage.getItem('shanhe.v1.'+k))??d}catch{return d}};
const view={level:'',type:'',status:'',search:'',province:'',city:'',selected:null,tab:'overview',page:'explore',footTab:'visited',limit:40};
let catalog=[],byId=new Map(),filtered=[],map,geo,seats,features,arrivals={},regions=[],cities=[],homeOptions=[],picking=false,toastTimer;
let marks=Object.create(null),home=null;
const grade=s=>'<span class="grade '+(s.level===4?'g4':'')+'">'+s.level+'A</span>';
const iconic={'jiuzhaigou':'jiuzhaigou','huangshan':'huangshan','forbidden-city':'gugong','west-lake':'xihu','zhangjiajie-tianmen-mountain':'wulingyuan','li-river-yangshuo':'lijiver','great-wall-mutianyu':'badaling','terracotta-army':'terracotta','shanghai-yu-garden':'yuyuan','wuhou-shrine-jinli':'wuhou','potala-palace':'potala','lijiang-old-town':'lijiang'};
const assetPhoto=p=>p?.photo?asset('assets/'+p.photo):p?.image||'';
function toast(t){$('#toast').textContent=t;$('#toast').classList.add('show');clearTimeout(toastTimer);toastTimer=setTimeout(()=>$('#toast').classList.remove('show'),2800)}
function prep(){
  const prioritise=new Map(Object.keys(iconic).map((id,i)=>[id,i])),pack=new Map(features.map(f=>[f.key,f]));
  for(const s of catalog){const f=pack.get(iconic[s.id]);if(f&&f.level===s.level){s.feature=f;s.shortName=({jiuzhaigou:'九寨沟',huangshan:'黄山',wulingyuan:'武陵源',badaling:'八达岭长城',lijiver:'桂林漓江'})[f.key]||s.name;s.displayName=f.name;
      if(f.key==='wulingyuan'){s.lng=110.434;s.lat=29.325}
      if(f.key==='badaling'){s.lng=116.0069;s.lat=40.3542}
    }else s.displayName=s.name;
    s.searchable=[s.name,s.displayName,s.officialName,s.province,s.city,regions.find(p=>p.code===s.provinceCode)?.name,cities.find(c=>c.code===s.cityCode)?.name,...(s.feature?.match||[])].join(' ').toLowerCase();
  }
  catalog.sort((a,b)=>(prioritise.get(a.id)??100)-(prioritise.get(b.id)??100)||b.level-a.level||a.provinceCode.localeCompare(b.provinceCode)||a.name.localeCompare(b.name,'zh-CN'));
  byId=new Map(catalog.map(s=>[s.id,s]));
}
function drawFilters(){
  document.querySelectorAll('.chips').forEach(group=>group.querySelectorAll('button').forEach(btn=>{const on=btn.dataset.val===view[group.dataset.filter];btn.classList.toggle('on',on);btn.setAttribute('aria-pressed',on)}));$('#search').value=view.search;
}
function qualify(s){
  return (!view.level||s.level===Number(view.level))&&(!view.type||(s.feature?.type||s.type)===view.type)&&(!view.province||s.provinceCode===view.province)&&(!view.city||s.cityCode===view.city)&&(!view.search||s.searchable.includes(view.search.toLowerCase().trim()))&&(!view.status||(view.status==='unvisited'?!marks[s.id]?.visited:!!marks[s.id]?.[view.status]));
}
function update({fit=false,keepList=false}={}){
  if(!catalog.length)return;
  filtered=catalog.filter(qualify);
  if(view.selected&&!filtered.some(s=>s.id===view.selected))view.selected=filtered[0]?.id||null;
  drawFilters();renderList(keepList);renderDetail();regionUI();
  const p=regions.find(r=>r.code===view.province),c=cityGeo(view.city);
  map.setData(filtered,byId.get(view.selected),p,c,fit);
  if(view.page==='foot')renderFoot();
}
function smallImage(s){const p=s.feature?.photo;return '<span class="result-img">'+(p?'<img loading="lazy" alt="" src="'+esc(asset('assets/'+p.replace('.jpg','.thumb.webp')))+'">':ic(s.type==='自然'?'mountain':'temple'))+'</span>'}
function row(s,kind='result'){
 return '<button class="'+kind+(view.selected===s.id&&kind==='result'?' selected':'')+'" data-id="'+esc(s.id)+'">'+smallImage(s)+'<span class="result-main"><span class="result-name">'+esc(s.displayName)+'</span><span class="result-sub">'+grade(s)+'<span>'+esc(s.province===s.city?s.city:s.province+' · '+s.city)+'</span></span></span><span class="trailing">'+ic(marks[s.id]?.visited?'check':marks[s.id]?.want?'bookmark':'chev')+'</span></button>';
}
function renderList(keep){
 const list=$('#result-list'),scroll=keep?list.scrollTop:0;$('#result-count').textContent=fmt(filtered.length)+' 处';
 list.innerHTML=filtered.length?filtered.slice(0,view.limit).map(s=>row(s)).join('')+(filtered.length>view.limit?'<button class="morebtn" id="more-list">加载更多景区</button>':''):'<div class="empty">'+ic('search')+'没有符合条件的景区<br><button class="linkbtn" id="empty-reset">清除筛选条件</button></div>';list.scrollTop=scroll;
}
function locationText(s){const p=regions.find(r=>r.code===s.provinceCode)?.name||s.province,c=cityGeo(s.cityCode,s.provinceCode)?.name||s.city;return p===c?p:p+' · '+c}
function cityGeo(code,prov=view.province){if(!code)return null;
 const c=cities.find(v=>v.code===code&&(!prov||v.parent===prov));if(c)return c;
 if(code===prov){return cities.find(v=>v.parent===prov&&v.level==='municipality')||regions.find(v=>v.code===prov)}
 const locs=catalog.filter(s=>s.cityCode===code&&s.provinceCode===prov);
 return locs.length?{code,name:locs[0].city,bounds:map.pointBounds(locs)}:null;
}
function regionUI(){
 const p=regions.find(r=>r.code===view.province),c=cityGeo(view.city);
 $('#region-label').textContent=c?((p?.short===c.name||p?.name===c.name)?c.name:(p?.short+' · '+c.name)):(p?.name||'全国视图');
 $('#region-up').hidden=!p; $('#province').innerHTML='<option value="">全国</option>'+regions.map(r=>'<option value="'+r.code+'">'+esc(r.name)+'</option>').join('');$('#province').value=view.province;
 const options=new Map();if(p){for(const r of catalog){if(r.provinceCode===p.code&&!options.has(r.cityCode))options.set(r.cityCode,cityGeo(r.cityCode,p.code)?.name||r.city)}}
 $('#city').innerHTML='<option value="">全部城市</option>'+[...options].sort((a,b)=>a[1].localeCompare(b[1],'zh-CN')).map(([k,v])=>'<option value="'+esc(k)+'">'+esc(v)+'</option>').join('');
 $('#city').disabled=!p||!options.size;$('#city').value=view.city;
}
function scope(p='',c='',close=true){view.province=p;view.city=c;view.limit=40;view.selected=null;view.tab='overview';update({fit:true});if(close)hideRegion()}
function hideRegion(){$('#region-pop').hidden=true;$('#region-button').setAttribute('aria-expanded','false')}
function selectSpot(s,focus=true){
 if(!s)return;view.selected=s.id;view.tab='overview';view.page='explore';setPage('explore',false);hideRegion();document.body.classList.remove('drawer-open');
 if(focus){view.province=s.provinceCode;view.city=s.cityCode;view.limit=40}
 update({fit:focus,keepList:!focus});
}
function reset(){Object.assign(view,{level:'',type:'',status:'',search:'',province:'',city:'',limit:40,selected:null,tab:'overview'});update({fit:true});hideRegion()}
function photoFor(s){if(s.feature)return s.feature;return s.image?{image:s.image,alt:s.displayName,photoUrl:s.imagePage,author:s.imageCredit,license:s.imageLicense}:null}
function locatorArt(s){
 // Draw a small geographic locator for records with no reusable photograph.
 const canv=document.createElement('canvas');canv.width=640;canv.height=340;const g=canv.getContext('2d'),p=regions.find(r=>r.code===s.provinceCode);
 g.fillStyle='#e1e9d9';g.fillRect(0,0,640,340);if(!p)return canv.toDataURL();
 const b=p.bounds,w=Math.max(.5,b[2]-b[0]),h=Math.max(.5,b[3]-b[1]);const z=Math.min(545/w,275/h);
 const cx=s.provinceCode==='460000'?s.lng*map.ratio:(b[0]+b[2])/2,cy=s.provinceCode==='460000'?-s.lat:(b[1]+b[3])/2;
 g.setTransform(z,0,0,z,320-cx*z,168-cy*z);if(map.terrain?.naturalWidth)g.drawImage(map.terrain,45*map.ratio,-67,120*map.ratio,67);
 g.strokeStyle='#719875';g.lineWidth=1.5/z;g.stroke(p.path);g.fillStyle='#7baa7517';g.fill(p.path);
 g.setTransform(1,0,0,1,0,0);const x=(s.lng*map.ratio-cx)*z+320,y=(-s.lat-cy)*z+168;g.beginPath();g.arc(x,y,14,0,7);g.fillStyle='#fffceadd';g.fill();g.beginPath();g.arc(x,y,8,0,7);g.fillStyle='#24644d';g.fill();return canv.toDataURL('image/jpeg',.8);
}
function featureCredit(s){return '<p class="smallnote">'+link('查看景区资料',s.source)+(s.officialName?' · '+esc(s.officialName):'')+'</p>'}
function overview(s){
 const f=s.feature,tags=f?.tags||s.highlights||[],copy=f?.intro||s.description||s.summaryEn;
 return '<div class="info-block"><h3 class="info-title">'+ic('book')+'景区简介</h3><p class="detail-copy">'+esc(copy)+'</p>'+(!f&&s.descriptionCredit&&s.zhPage?'<p class="smallnote">'+link('中文维基百科贡献者',s.zhPage)+' · '+link('CC BY-SA 4.0','https://creativecommons.org/licenses/by-sa/4.0/')+'</p>':'')+'</div><div class="info-block"><h3 class="info-title">'+ic('tag')+'景区特点</h3><div class="tags">'+(tags.length?tags:[s.type+'景观']).slice(0,5).map(v=>'<span class="tag">'+esc(v)+'</span>').join('')+'</div></div><div class="transport-mini"><h3 class="info-title">'+ic('route')+'前往景区</h3><button data-action="'+(home?'route-tab':'home')+'">'+esc(home?'查看从'+home.name+'出发的交通方式':'设置定居点，查看交通方式')+ic('chev')+'</button></div>';
}
function distance(a,b){const rad=Math.PI/180,dy=(b.lat-a.lat)*rad,dx=(b.lng-a.lng)*rad;return 6371*2*Math.asin(Math.min(1,Math.sqrt(Math.sin(dy/2)**2+Math.cos(a.lat*rad)*Math.cos(b.lat*rad)*Math.sin(dx/2)**2)))}
// GCJ-02 is used by AMap. Keep catalog and device locations in their original WGS84 form.
function gcj(lon,lat){if(lon<72.004||lon>137.8347||lat<.8293||lat>55.8271)return [lon,lat];const x=lon-105,y=lat-35,pi=Math.PI;
 const shared=(20*Math.sin(6*x*pi)+20*Math.sin(2*x*pi))*2/3;
 let dy=-100+2*x+3*y+.2*y*y+.1*x*y+.2*Math.sqrt(Math.abs(x))+shared+(20*Math.sin(y*pi)+40*Math.sin(y*pi/3))*2/3+(160*Math.sin(y*pi/12)+320*Math.sin(y*pi/30))*2/3;
 let dx=300+x+2*y+.1*x*x+.1*x*y+.1*Math.sqrt(Math.abs(x))+shared+(20*Math.sin(x*pi)+40*Math.sin(x*pi/3))*2/3+(150*Math.sin(x*pi/12)+300*Math.sin(x*pi/30))*2/3;
 const r=lat*pi/180,m=1-.00669342162296594323*Math.sin(r)**2,s=Math.sqrt(m);
 return [lon+dx*180/(6378245/s*Math.cos(r)*pi),lat+dy*180/((6378245*(1-.00669342162296594323))/(m*s)*pi)];
}
function navLink(s,mode){const end=arrivals[s.feature?.key]||s;const a=home.crs==='GCJ-02'?[home.lng,home.lat]:gcj(home.lng,home.lat),b=end.crs==='GCJ-02'?[end.lng,end.lat]:gcj(end.lng,end.lat);const u=new URL('https://uri.amap.com/navigation');u.search=new URLSearchParams({from:a.map(x=>x.toFixed(6)).join(',')+','+home.name,to:b.map(x=>x.toFixed(6)).join(',')+','+(end===s?s.displayName:end.name),mode,coordinate:'gaode',src:'shanhe-atlas'});return u.href}
function transport(s){const f=s.feature,end=arrivals[f?.key];
 let html='<div class="info-block"><h3 class="info-title">'+ic('house')+'从定居点出发</h3>';
 if(home){const km=distance(home,end||s);html+='<p class="route-orig">'+esc(home.name)+' 至 '+esc(end?.name||s.displayName)+'</p><p class="smallnote">直线距离约 '+fmt(Math.round(km))+' 公里 · '+(end?'目的地为景区入口或换乘点':'目的地为景区参考点，导航时请核对入口')+'</p><div class="route-links">'+link(ic('car')+'驾车路线',navLink(s,'car'))+link(ic('train')+'公共交通',navLink(s,'bus'))+'</div><p class="smallnote">在高德地图查看实际线路、用时及换乘安排。</p>'}
 else html+='<p class="detail-copy">选择你的定居城市或具体位置，查询从那里出发的路线。</p><button class="linkbtn" data-action="home">'+ic('house')+'设置定居点</button>';
 html+='</div>';
 if(home&&distance(home,end||s)>180){
  const gateways={jiuzhaigou:'黄龙九寨站或松潘站',huangshan:'黄山北站',wulingyuan:'张家界西站',gugong:'北京',badaling:'北京',terracotta:'西安',xihu:'杭州',lijiver:'桂林',yuyuan:'上海',wuhou:'成都',potala:'拉萨',lijiang:'丽江'};
  const destination=gateways[f?.key]||s.city;html+='<div class="info-block"><h3 class="info-title">'+ic('train')+'跨城铁路</h3><p class="detail-copy">可先在 12306 查询前往'+esc(destination)+'的车次或中转换乘，再衔接当地交通。</p>'+link('查询铁路班次','https://www.12306.cn/index/','data-credit')+'</div>';
 }
 if(end)html+='<p class="smallnote">'+link('在高德地图核对到达点',end.source)+'</p>';
 if(f?.transit)html+='<div class="info-block"><h3 class="info-title">'+ic('route')+'抵达与换乘</h3><p class="detail-copy">'+esc(f.transit)+'</p>'+link('交通资料',f.url,'data-credit')+'</div>';
 else if(s.accessEn)html+='<div class="info-block"><h3 class="info-title">'+ic('route')+'当地交通资料</h3><p class="detail-copy" lang="en">'+esc(s.accessEn)+'</p>'+link('资料来源',s.source,'data-credit')+'</div>';
 return html;
}
function renderDetail(){
 const panel=$('#detail'),s=byId.get(view.selected);panel.hidden=!s;$('.map-area').classList.toggle('has-detail',!!s);if(!s){panel.innerHTML='';return}
 const f=s.feature,p=photoFor(s),state=marks[s.id]||{},img=p?assetPhoto(p):locatorArt(s);
 panel.innerHTML='<div class="detail-scroll"><div class="hero-photo"><img class="hero-img" src="'+esc(img)+'" alt="'+esc(p?.alt||s.displayName+'位置示意图')+'">'+(!p?'<span class="geo-caption">景区位置图</span>':'')+'<div class="hero-label"><span class="badge">'+s.level+'A 级景区</span><span class="badge badge-type">'+ic((f?.type||s.type)==='自然'?'leaf':'temple')+esc(f?.type||s.type)+'景观</span></div><button class="close-detail" data-action="close" aria-label="关闭详情">'+ic('close')+'</button>'+(p?'<button class="photo-credit" data-action="photo" aria-label="查看图片与署名" title="查看图片与署名">'+ic('camera')+'</button>':'<button class="no-photo-link" data-action="find-photo">'+ic('camera')+'查找实景</button>')+'</div><div class="detail-body"><h2>'+esc(s.displayName)+'</h2><p class="location">'+ic('pin')+esc(locationText(s))+'</p><div class="detail-tabs" aria-label="详情栏目">'+[['overview','概览'],['route','交通'],['more','资料']].map(([k,n])=>'<button data-tab="'+k+'" class="'+(view.tab===k?'active':'')+'">'+n+'</button>').join('')+'</div><div class="detail-tab-content">'+(view.tab==='overview'?overview(s):view.tab==='route'?transport(s):details(s))+'</div></div></div><div class="detail-actions"><button class="primary '+(state.visited?'saved':'')+'" data-action="visited" aria-pressed="'+!!state.visited+'">'+ic('check')+(state.visited?'已去过':'标记去过')+'</button><button class="secondary '+(state.want?'saved':'')+'" data-action="want" aria-pressed="'+!!state.want+'">'+ic('bookmark')+(state.want?'已想去':'想去')+'</button></div>';
 const cover=panel.querySelector('.hero-img');if(p&&!f)cover.onerror=()=>{cover.onerror=null;cover.src=locatorArt(s);cover.alt=s.displayName+'位置示意图';cover.insertAdjacentHTML('afterend','<span class="geo-caption">景区位置图</span>')};
}
function details(s){const p=photoFor(s),joint=s.feature&&['wulingyuan','badaling'].includes(s.feature.key);
 return '<h3 class="info-title">'+ic('flag')+'景区档案</h3><p class="detail-copy">'+esc(s.officialName||s.name)+' · '+s.level+'A'+(s.ratingYear?' · '+esc(s.ratingYear)+' 年评定':'')+'</p>'+(joint?'<p class="smallnote">联合评定景区，当前展示其中的'+esc(s.feature.name)+'。</p>':'')+(s.visitTime?'<p class="smallnote">参考游览时长 · '+esc(s.visitTime)+'</p>':'')+featureCredit(s)+(s.summaryEn?'<div class="info-block" style="margin-top:12px"><h3 class="info-title">'+ic('book')+'图集原文</h3><p class="detail-copy" lang="en">'+esc(s.summaryEn)+'</p></div>':'')+'<div class="route-links">'+(p?'<button data-action="photo">'+ic('camera')+'查看图片与署名</button>':'<button data-action="find-photo">'+ic('camera')+'查找景区实景图</button>')+'</div>';
}
async function toggleMark(id,k){
 const before=!!marks[id]?.[k];
 try{await recordStore.edit(id,k,!before);cloudSync.schedule(900,true);
 toast(recordStore.issue||(k==='visited'?(before?'已移除到访记录':'已记录这处足迹'):(before?'已从想去中移除':'已加入想去清单')))}
 catch{toast('未能保存这次更改，请重试或导出原记录。')}
}
function setPage(name,render=true){view.page=name;const foot=name==='foot';$('#foot-page').hidden=!foot;$('#sidebar').style.display=foot?'none':'';$('.map-area').hidden=foot;document.body.classList.remove('drawer-open');document.querySelectorAll('[data-view]').forEach(b=>{b.classList.toggle('active',b.dataset.view===name);b.setAttribute('aria-current',b.dataset.view===name?'page':'false')});if(render){if(foot)renderFoot();else{map?.size();map?.fit()}}}
function renderFoot(){const visited=catalog.filter(s=>marks[s.id]?.visited),wanted=catalog.filter(s=>marks[s.id]?.want),rows=view.footTab==='visited'?visited:wanted;
 $('#foot-page').innerHTML='<div class="foot-hero"><div><h1>我的足迹</h1><p>记录走过的景区，也留住下一站的念想。</p></div><div class="foot-stats"><span><b>'+fmt(visited.length)+'</b>去过的景区</span><span><b>'+fmt(new Set(visited.map(s=>s.province)).size)+'</b>到访省区</span><span><b>'+fmt(wanted.length)+'</b>想去的景区</span></div></div><div class="foot-tools"><button class="secondary" data-action="data">'+ic('layers')+'备份与同步</button><span class="smallnote" data-sync-message>'+esc(cloudSync?.message||'仅保存在此设备')+'</span></div><div class="foot-tabs"><button data-foot="visited" class="'+(view.footTab==='visited'?'active':'')+'">去过 ('+visited.length+')</button><button data-foot="want" class="'+(view.footTab==='want'?'active':'')+'">想去 ('+wanted.length+')</button></div>'+(rows.length?'<div class="footgrid">'+rows.map(s=>row(s,'footcard')).join('')+'</div>':'<div class="footempty">'+ic(view.footTab==='visited'?'foot':'bookmark')+'<h2>'+ (view.footTab==='visited'?'还没有到访记录':'想去清单是空的')+'</h2><p>在景区详情里点击「'+(view.footTab==='visited'?'标记去过':'想去')+'」，这里就会保存你的记录。</p><button class="primary" data-view="explore">'+ic('compass')+'探索地图</button></div>');
}
function openModal(title,inner){
 const modal=$('#modal');$('#modal-body').innerHTML='<div class="modal-head"><h2>'+esc(title)+'</h2><button class="iconbutton" data-action="modal-close" aria-label="关闭窗口">'+ic('close')+'</button></div>'+inner;
 if(!modal.open)modal.showModal();else modal.scrollTop=0;
}
function photoModal(s,index=0){
 const pics=s.feature?.gallery||[photoFor(s)],p=pics[index];if(!p)return;
 const lic=p.licenseUrl||(/^CC BY(-SA)? ([\d.]+)$/i.test(p.license||'')?'https://creativecommons.org/licenses/by'+(/-SA/i.test(p.license)?'-sa':'')+'/'+p.license.match(/[\d.]+/)[0]+'/':null);
 openModal('景区实景', '<img class="modal-photo" alt="'+esc(p.alt||s.displayName)+'" src="'+esc(assetPhoto(p))+'"><p class="modal-copy">'+esc(p.alt||s.displayName)+'</p><p class="smallnote">'+esc(p.author||'摄影来源见原图')+' · '+(lic?link(esc(p.license),lic):esc(p.license||''))+(p.photoUrl?' · '+link('原图与许可',p.photoUrl):'')+'<br>图片按页面尺寸缩放展示。</p>'+(pics.length>1?'<div class="route-links">'+pics.map((v,i)=>'<button data-gallery="'+i+'" aria-pressed="'+(index===i)+'">'+(index===i?ic('check'):'')+'第 '+(i+1)+' 张</button>').join('')+'</div>':''));
}
function about(){const five=catalog.filter(s=>s.level===5).length,four=catalog.length-five;
 openModal('数据与图源','<div class="modal-copy"><p>本版收录内地 '+new Set(catalog.map(s=>s.provinceCode)).size+' 个省级行政区的 '+fmt(catalog.length)+' 处景区，其中 5A 级 '+fmt(five)+' 处，4A 级 '+fmt(four)+' 处。5A 名录核对日期为 2026 年 10 月 20 日，4A 数据来自 2026 年 11 月 7 至 9 日的图集快照。等级及开放状态请以文旅部门最新公告为准。</p><hr class="spacerline"><p><strong>景区名录与导览</strong><br>基于 '+link('Atlas of China（2026）','https://www.atlasofchina.com/data/')+' 的景区及评级数据，依 '+link('CC BY 4.0','https://creativecommons.org/licenses/by/4.0/')+' 整理、中文化、合并联合评定单元。可在「资料」中核对条目和原文。'+link('文旅部 5A 级景区查询','https://zwfw.mct.gov.cn/wycx/5ajlyjq/')+'</p><p><strong>照片及百科资料</strong><br>照片按各自许可使用。点击照片上的相机可查看作者和原图。引自中文维基百科的文字保留条目链接与署名。缺少可用实景照片时显示景区位置图。</p><p><strong>地图</strong><br>省市轮廓来自 '+link('阿里云 DataV · 高德','https://datav.aliyun.com/portal/school/atlas/area_selector')+'，地形及河湖来自 '+link('Natural Earth','https://www.naturalearthdata.com/')+'（公共领域）。点位为旅游分布示意；同一评级单元有多处游览点时，地图取其中一个代表点。</p><p><strong>我的记录</strong><br>足迹和定居点保存在当前浏览器。启用同步后，记录也会写入你指定的 GitHub 私有仓库，提交历史可保留旧值。「我的足迹」提供 JSON 导出和导入。打开高德路线时，会将起终点传给高德地图。</p></div>');
}
function homeChoices(){
 const seen=new Set();homeOptions=[];
 for(const c of cities){if(c.level==='district')continue;const p=regions.find(p=>p.code===c.parent),seat=seats[c.level==='municipality'?c.parent:c.code];if(!p||!seat)continue;
  const key=p.code+'/'+c.name;if(seen.has(key))continue;seen.add(key);homeOptions.push({label:p.name===c.name?c.name:p.short+' · '+c.name,name:c.name,lng:seat[0],lat:seat[1],crs:'GCJ-02'});
 }
 homeOptions.sort((a,b)=>a.label.localeCompare(b.label,'zh-CN'));
}
async function setHome(h){
 try{await recordStore.edit(null,'home',h);cloudSync.schedule(900,true);$('#modal').close();
 toast(recordStore.issue||(h?'出发地已设为'+h.name:'已清除定居点'))}
 catch{toast('定居点保存失败，请重试。')}
}
function homeLabel(){$('#home-label').textContent=home?home.name:'设置定居点';$('#home-open').title=home?'定居点 · '+home.name:'设置定居点'}
function homeDialog(){
 openModal('设置定居点','<p class="modal-copy">选定出发城市后，每个景区都会提供从这里出发的交通路线。</p>'+(home?'<p class="route-orig" style="margin-top:10px">当前定居点 · '+esc(home.name)+'</p>':'')+'<form id="home-form"><label class="form-field">定居城市<input list="city-choices" id="home-city" autocomplete="off" placeholder="输入城市，如 杭州" required></label><datalist id="city-choices">'+homeOptions.map(c=>'<option value="'+esc(c.label)+'"></option>').join('')+'</datalist><p class="smallnote">按城市设置时，路线从市中心出发。也可以选取更准确的位置。</p><div class="route-links"><button type="button" data-action="pick">'+ic('pin')+'在地图上选点</button><button type="button" data-action="locate">'+ic('locate')+'使用当前位置</button></div><p id="home-status" class="smallnote" role="status"></p><div class="modal-actions">'+(home?'<button type="button" class="secondary" data-action="clear-home">清除定居点</button>':'')+'<button type="submit" class="primary">保存定居点</button></div></form>');
 $('#home-form').onsubmit=e=>{e.preventDefault();const v=$('#home-city').value.trim(),exact=homeOptions.find(c=>c.label===v)||homeOptions.find(c=>c.name===v)||homeOptions.find(c=>c.name.replace(/市$/,'')===v);
  if(!exact){$('#home-status').textContent='请从下拉提示中选择完整的城市名称。';return}const {label,...h}=exact;setHome(h)};
}
function pointDialog(lon,lat,fromDevice=false){
 openModal('确认定居点','<p class="modal-copy">已'+(fromDevice?'定位':'选中')+' '+lat.toFixed(5)+'° N，'+lon.toFixed(5)+'° E。</p><form id="point-form"><label class="form-field">给这个位置起个名字<input id="point-name" required maxlength="32" value="我的定居点"></label><div class="modal-actions"><button class="secondary" type="button" data-action="home">重新选择</button><button class="primary" type="submit">保存定居点</button></div></form>');
 $('#point-form').onsubmit=e=>{e.preventDefault();const name=$('#point-name').value.trim();if(name)setHome({name,lng:lon,lat,crs:'WGS84'})};
}
function showPick(on){picking=on;$('#pick-note')?.remove();if(on){$('#modal').close();setPage('explore');hideRegion();$('.map-area').insertAdjacentHTML('beforeend','<div id="pick-note" class="floatbtn">在地图上点击定居位置 <button class="iconbutton" data-action="cancel-pick" aria-label="取消选点">'+ic('close')+'</button></div>')}}
function showGroup(rows){openModal('同位置景区','<div class="group-list">'+rows.map(s=>row(s,'footcard')).join('')+'</div>')}
function handleAction(a){if(dataAction(a))return;const s=byId.get(view.selected);
 switch(a){
 case 'close':view.selected=null;update({fit:true,keepList:true});break;
 case 'home':homeDialog();break;
 case 'clear-home':setHome(null);break;
 case 'route-tab':view.tab='route';renderDetail();break;
 case 'visited':case 'want':if(s)toggleMark(s.id,a);break;
 case 'photo':if(s)photoModal(s);break;
 case 'find-photo':if(s)findPhotos(s);break;
 case 'modal-close':$('#modal').close();break;
 case 'pick':showPick(true);break;
 case 'cancel-pick':showPick(false);break;
 case 'locate':{const status=$('#home-status');if(!navigator.geolocation){status.textContent='浏览器不支持定位，请从城市列表选择或在地图上选点。';break}
 status.textContent='正在获取当前位置…';navigator.geolocation.getCurrentPosition(p=>{if(status.isConnected&&$('#modal').open)pointDialog(p.coords.longitude,p.coords.latitude,true)},()=>{if(status.isConnected)status.textContent='无法取得位置。请检查浏览器定位权限，或在地图上选点。'},{timeout:12000,maximumAge:300000});break}
 }
}
function bind(){
 document.addEventListener('click',e=>{
 const btn=e.target.closest('button,a.brand');
 if(!e.target.closest('#region-pop,.mapbar'))hideRegion();
 if(!btn)return;
 if(btn.matches('.brand')){e.preventDefault();setPage('explore');scope();return}
 if(btn.dataset.view){setPage(btn.dataset.view);return}
 if(btn.dataset.action){handleAction(btn.dataset.action);return}
 if(btn.dataset.tab){view.tab=btn.dataset.tab;renderDetail();map.room();map.redraw();return}
 if(btn.dataset.gallery!==undefined){photoModal(byId.get(view.selected),Number(btn.dataset.gallery));return}
 if(btn.dataset.id){const fromFoot=view.page==='foot';if($('#modal').open)$('#modal').close();if(fromFoot){Object.assign(view,{search:'',level:'',type:'',status:''})}selectSpot(byId.get(btn.dataset.id));return}
 if(btn.dataset.foot){view.footTab=btn.dataset.foot;renderFoot();return}
 if(btn.closest('.chips')){view[btn.closest('.chips').dataset.filter]=btn.dataset.val;view.limit=40;update();return}
 if(btn.dataset.close){hideRegion();return}
 switch(btn.id){
 case 'home-open':homeDialog();break;
 case 'reset':case 'empty-reset':reset();break;
 case 'side-open':document.body.classList.add('drawer-open');hideRegion();break;
 case 'side-close':document.body.classList.remove('drawer-open');break;
 case 'region-button':{const pop=$('#region-pop');pop.hidden=!pop.hidden;btn.setAttribute('aria-expanded',!pop.hidden);break}
 case 'region-up':scope(view.city?view.province:'');break;
 case 'region-all':scope();break;
 case 'zoom-in':map.zoomAt(1.5);break;
 case 'zoom-out':map.zoomAt(1/1.5);break;
 case 'fit':map.fit();break;
 case 'more-list':view.limit+=60;renderList(true);break;
 case 'about':about();break;
 }
 });
 $('#search').addEventListener('input',e=>{view.search=e.target.value;view.limit=40;update()});
 $('#province').onchange=e=>scope(e.target.value,'',false);$('#city').onchange=e=>scope(view.province,e.target.value);
 $('#modal').addEventListener('click',e=>{if(e.target===$('#modal')){const r=$('#modal').getBoundingClientRect();if(e.clientX<r.left||e.clientX>r.right||e.clientY<r.top||e.clientY>r.bottom)$('#modal').close()}});
 document.addEventListener('keydown',e=>{if(e.key==='Escape'){hideRegion();showPick(false);document.body.classList.remove('drawer-open')}if(e.key==='/'&&!['INPUT','TEXTAREA','SELECT'].includes(document.activeElement.tagName)&&!$('#modal').open){e.preventDefault();setPage('explore',false);if(innerWidth<=860)document.body.classList.add('drawer-open');$('#search').focus()}});
}
async function init(){
 const kinds=['provinces','cities','neighbors','rivers','lakes','islands'];
 const args=await Promise.all([loadJson('data/catalog.json'),loadJson('data/features.json'),loadJson('data/seats.json'),loadJson('data/arrivals.json'),...kinds.map(k=>loadJson('data/'+k+'.geojson'))]);
 [catalog,features,seats]=args;arrivals=Object.fromEntries(args[3].map(a=>[a.key,a]));geo=Object.fromEntries(kinds.map((k,i)=>[k,args[i+4]]));
 const terrain=new Image();terrain.onload=()=>map?.redraw();terrain.src=asset('assets/terrain.webp');
 const ev={spot:s=>selectSpot(s,true),province:name=>scope(catalog.find(s=>s.province===name)?.provinceCode||''),city:name=>{const s=filtered.find(s=>s.city===name);if(s)scope(s.provinceCode,s.cityCode)},geoProvince:p=>scope(p.code),geoCity:c=>{if(!catalog.some(s=>s.cityCode===c.code&&s.provinceCode===view.province))return false;scope(view.province,c.code);return true},pick:([lng,lat])=>{if(!picking)return false;if(lng< -180||lng>180||lat< -85||lat>85){toast('请选择有效的地图位置');return true}showPick(false);pointDialog(lng,lat);return true},group:showGroup};
 map=new ScenicMap($('#map'),geo,terrain,ev);regions=map.geo.provinces;cities=map.geo.cities;prep();homeChoices();await startPersonal();homeLabel();bind();view.selected=byId.has('jiuzhaigou')?'jiuzhaigou':catalog[0]?.id;update({fit:true});
 const detailResize=new ResizeObserver(()=>{if(!map)return;map.room();map.redraw()});detailResize.observe($('#detail'));
}
init().catch(err=>{console.error(err);$('#result-count').textContent='载入失败';$('#result-list').innerHTML='<div class="empty">景区数据未能载入。<br><button class="linkbtn" onclick="location.reload()">重新载入</button></div>'});
async function findPhotos(s){
 const term=s.name,query=[s.province,s.city===s.province?'':s.city,term].filter(Boolean).join(' ');
 const more='<div class="route-links">'+link('百度图片','https://image.baidu.com/search/index?tn=baiduimage&word='+encodeURIComponent(query))+link('Wikimedia Commons','https://commons.wikimedia.org/w/index.php?title=Special:MediaSearch&type=image&search='+encodeURIComponent(term))+'</div>';
 openModal('查找实景 · '+s.displayName,'<p class="modal-copy">当前名录尚缺这处景区的已核对照片。以下是按景区名称检索的公开图片。</p><p id="photo-search-status" class="smallnote" role="status">正在查询 Wikimedia Commons…</p><div id="photo-search-results" class="online-photos"></div>'+more);
 const status=$('#photo-search-status'),result=$('#photo-search-results'),u=new URL('https://commons.wikimedia.org/w/api.php');u.search=new URLSearchParams({action:'query',generator:'search',gsrnamespace:'6',gsrsearch:'intitle:"'+term+'" filetype:bitmap',gsrlimit:'6',prop:'imageinfo',iiprop:'url|extmetadata',iiextmetadatafilter:'Artist|LicenseShortName|LicenseUrl',iiurlwidth:'400',format:'json',origin:'*'});
 const abort=new AbortController(),timer=setTimeout(()=>abort.abort(),5500);
 try{const response=await fetch(u,{signal:abort.signal});if(!response.ok)throw Error('search');const data=await response.json();if(!result.isConnected)return;const pics=Object.values(data.query?.pages||{}).filter(p=>p.imageinfo?.[0]?.thumburl);
 status.textContent=pics.length?'在线图片检索结果，请通过原图页核对拍摄地点。':'暂未检索到同名图片，可通过下方入口继续查找。';
 result.innerHTML=pics.map(p=>{const i=p.imageinfo[0],m=i.extmetadata||{},title=p.title.replace(/^File:/,''),author=(m.Artist?.value||'').replace(/<[^>]*>/g,'').slice(0,100);return '<figure><a href="'+url(i.descriptionurl)+'" target="_blank" rel="noopener noreferrer"><img src="'+url(i.thumburl)+'" alt="'+esc(title)+'"></a><figcaption>'+esc(author)+' · '+(m.LicenseUrl?.value?link(esc(m.LicenseShortName?.value||'许可'),m.LicenseUrl.value):esc(m.LicenseShortName?.value||''))+' · '+link('原图',i.descriptionurl)+'</figcaption></figure>'}).join('')
 }catch{if(status.isConnected)status.textContent='在线图源暂不可用，可通过下方入口继续查找。'}finally{clearTimeout(timer)}
}
