class ScenicMap {
  constructor(canvas, geo, terrain, events) {
    this.el=canvas; this.g=canvas.getContext('2d'); this.events=events; this.terrain=terrain;
    this.geo={}; this.ratio=Math.cos(35*Math.PI/180); this.cx=104*this.ratio; this.cy=-35; this.zoom=12;
    for(const [kind,collection] of Object.entries(geo)) {
      this.geo[kind]=collection.features.map(f=>this.prepare(f));
    }
    this.records=[]; this.targets=[]; this.pointers=new Map(); this.bind();
    this.ro=new ResizeObserver(()=>{this.size();this.fit()}); this.ro.observe(canvas);
    this.size();
  }
  prepare(f) {
    const path=new Path2D(), bounds=[Infinity,Infinity,-Infinity,-Infinity], g=f.geometry;
    const line=(points,closed)=>{if(!points?.length)return;points.forEach(([lon,lat],i)=>{const x=lon*this.ratio,y=-lat;i?path.lineTo(x,y):path.moveTo(x,y);bounds[0]=Math.min(bounds[0],x);bounds[1]=Math.min(bounds[1],y);bounds[2]=Math.max(bounds[2],x);bounds[3]=Math.max(bounds[3],y)});if(closed)path.closePath()};
    if(g.type==='MultiPolygon') g.coordinates.forEach(poly=>poly.forEach(r=>line(r,true)));
    else if(g.type==='Polygon')g.coordinates.forEach(r=>line(r,true));
    else if(g.type==='MultiLineString')g.coordinates.forEach(r=>line(r,false));
    else if(g.type==='LineString')line(g.coordinates,false);
    return {...f.properties,path,bounds};
  }
  size() {
    const b=this.el.getBoundingClientRect(); this.w=b.width;this.h=b.height;this.dpr=Math.min(devicePixelRatio||1,2);
    this.el.width=Math.round(b.width*this.dpr);this.el.height=Math.round(b.height*this.dpr);
  }
  room() {
    const detail=document.querySelector('#detail'), visible=detail&&!detail.hidden, small=innerWidth<=640;
    const margin=visible?detail.getBoundingClientRect():{width:0,height:0};
    this.left=0;this.top=0;this.right=Math.max(160,this.w-(!small&&visible?margin.width+32:0));
    this.bottom=Math.max(120,this.h-(small&&visible?margin.height+10:0));
    this.ax=(this.left+this.right)/2;this.ay=(this.top+this.bottom)/2+8;
    document.querySelector('.map-area').style.setProperty('--detail-height',margin.height+'px');
  }
  visibleBounds(){return [this.cx-this.ax/this.zoom,this.cy-this.ay/this.zoom,this.cx+(this.w-this.ax)/this.zoom,this.cy+(this.h-this.ay)/this.zoom]}
  xy(lon,lat){return [(lon*this.ratio-this.cx)*this.zoom+this.ax,(-lat-this.cy)*this.zoom+this.ay]}
  world(x,y){return [((x-this.ax)/this.zoom+this.cx)/this.ratio,-((y-this.ay)/this.zoom+this.cy)]}
  setData(records,selected,prov,city,fit=false) {this.records=records;this.selected=selected;this.province=prov;this.city=city;this.room();if(fit)this.fit();else this.redraw()}
  fit(){
    if(!this.w||!this.h)return;
    this.room();
    let b=this.city?.bounds||this.province?.bounds;
    if(!this.province&&!this.city)b=[73*this.ratio,-53.8,135.5*this.ratio,-18.2];
    if(this.province?.code==='460000'&&!this.city)b=[108.4*this.ratio,-20.25,111.25*this.ratio,-17.9];
    if(!b&&this.records.length)b=this.pointBounds(this.records);
    if(!b)b=[73*this.ratio,-53.8,135.5*this.ratio,-18.2];
    this.setBounds(b);
  }
  pointBounds(rows){const b=[Infinity,Infinity,-Infinity,-Infinity];for(const s of rows){const x=s.lng*this.ratio,y=-s.lat;b[0]=Math.min(b[0],x);b[1]=Math.min(b[1],y);b[2]=Math.max(b[2],x);b[3]=Math.max(b[3],y)}return b}
  setBounds(b){const w=Math.max(130,this.right-40),h=Math.max(120,this.bottom-(innerWidth<=640?74:96));this.cx=(b[0]+b[2])/2;this.cy=(b[1]+b[3])/2;this.zoom=Math.max(3,Math.min(12000,w/Math.max(.08,b[2]-b[0]),h/Math.max(.08,b[3]-b[1])));this.redraw()}
  zoomAt(mult,x=this.ax,y=this.ay){const pt=this.world(x,y);this.zoom=Math.max(3,Math.min(20000,this.zoom*mult));this.cx=pt[0]*this.ratio-(x-this.ax)/this.zoom;this.cy=-pt[1]-(y-this.ay)/this.zoom;this.redraw()}
  redraw(){if(!this.frame)this.frame=requestAnimationFrame(()=>{this.frame=0;this.draw()})}
  bind(){
    const el=this.el,tip=document.querySelector('#map-tip');
    const pos=e=>{const b=el.getBoundingClientRect();return{x:e.clientX-b.left,y:e.clientY-b.top}};
    el.addEventListener('wheel',e=>{e.preventDefault();tip.hidden=true;const p=pos(e);this.zoomAt(Math.exp(-Math.max(-160,Math.min(160,e.deltaY))*.0026),p.x,p.y)},{passive:false});
    el.addEventListener('dblclick',e=>{const p=pos(e);this.zoomAt(1.7,p.x,p.y)});
    el.addEventListener('pointerdown',e=>{const p=pos(e);this.pointers.set(e.pointerId,p);this.down=p;this.moved=this.pointers.size>1;el.setPointerCapture(e.pointerId);tip.hidden=true;el.classList.add('dragging')});
    el.addEventListener('pointermove',e=>{
      const p=pos(e),old=this.pointers.get(e.pointerId);
      if(old) {
        if(this.pointers.size===2) {
          const other=[...this.pointers].find(([id])=>id!==e.pointerId)?.[1];if(other){const d=Math.hypot(old.x-other.x,old.y-other.y),n=Math.hypot(p.x-other.x,p.y-other.y);if(d>1&&n>1)this.zoomAt(n/d,(other.x+old.x)/2,(other.y+old.y)/2)}
          this.moved=true;
        }else{this.cx-=(p.x-old.x)/this.zoom;this.cy-=(p.y-old.y)/this.zoom;if(Math.hypot(p.x-this.down.x,p.y-this.down.y)>3)this.moved=true}
        this.pointers.set(e.pointerId,p);this.redraw();return;
      }
      const hit=this.hit(p);el.style.cursor=hit?'pointer':'grab';
      if(hit&&e.pointerType!=='touch'){tip.textContent=hit.label;tip.style.left=Math.min(this.w-160,p.x+12)+'px';tip.style.top=Math.max(2,p.y-34)+'px';tip.hidden=false}else tip.hidden=true;
    });
    const end=(e,cancel)=>{if(!this.pointers.has(e.pointerId))return;this.pointers.delete(e.pointerId);if(!cancel&&!this.moved&&!this.pointers.size)this.click(pos(e));if(!this.pointers.size){el.classList.remove('dragging');this.moved=false}};
    el.addEventListener('pointerup',e=>end(e,false));el.addEventListener('pointercancel',e=>end(e,true));
    el.addEventListener('pointerleave',()=>tip.hidden=true);
    el.addEventListener('keydown',e=>{if(['+','=','-','_','Home','ArrowLeft','ArrowRight','ArrowUp','ArrowDown'].includes(e.key)){e.preventDefault();if(e.key==='Home')this.fit();else if(['+','=','-','_'].includes(e.key))this.zoomAt(['-','_'].includes(e.key)?1/1.5:1.5);else{const k=65/this.zoom;if(e.key==='ArrowLeft')this.cx-=k;if(e.key==='ArrowRight')this.cx+=k;if(e.key==='ArrowUp')this.cy-=k;if(e.key==='ArrowDown')this.cy+=k;this.redraw()}}});
  }
  hit(p){return [...this.targets].reverse().find(t=>Math.hypot(p.x-t.x,p.y-t.y)<=t.r||(t.rect&&p.x>=t.rect[0]&&p.x<=t.rect[2]&&p.y>=t.rect[1]&&p.y<=t.rect[3]))}
  click(p){
    if(this.events.pick?.(this.world(p.x,p.y)))return;
    const hit=this.hit(p);
    if(hit){if(hit.one)this.events.spot(hit.one);else if(hit.rows){const rows=hit.rows;
      const prov=new Set(rows.map(r=>r.province)),city=new Set(rows.map(r=>r.city));
      if(!this.province&&prov.size===1){this.events.province(rows[0].province);return}
      if(this.province&&!this.city&&city.size===1){this.events.city(rows[0].city);return}
      const b=this.pointBounds(rows);if(Math.max(b[2]-b[0],b[3]-b[1])*this.zoom<8){this.events.group(rows);return}
      const old=this.zoom;this.setBounds(b);if(this.zoom<old*1.25){this.zoom=old*1.65;this.redraw()}
    }return}
    const [lon,lat]=this.world(p.x,p.y),ctx=this.g;ctx.save();ctx.setTransform(1,0,0,1,0,0);
    const find=features=>features.find(f=>ctx.isPointInPath(f.path,lon*this.ratio,-lat,'evenodd'));
    const hitCity=this.province&&!this.city?find(this.geo.cities.filter(c=>c.parent===this.province.code&&c.level!=='municipality')):null;
    const hitProvince=find(this.geo.provinces);ctx.restore();
    if(hitCity&&this.events.geoCity(hitCity))return;
    if(hitProvince&&hitProvince.code!==this.province?.code)this.events.geoProvince(hitProvince);
  }
  pathLayer(features,stroke,fill,width=1){const g=this.g, vb=this.vb;g.lineJoin='round';g.lineWidth=width/this.zoom;
    for(const f of features){const b=f.bounds;if(b[2]<vb[0]||b[3]<vb[1]||b[0]>vb[2]||b[1]>vb[3])continue;if(fill){g.fillStyle=fill;g.fill(f.path,'evenodd')}if(stroke){g.strokeStyle=stroke;g.stroke(f.path)}}}
  text(s,x,y,size,color,bold=500,stroke='rgba(245,246,225,.8)',serif=false){const g=this.g;g.font=bold+' '+size+'px '+(serif?'"Songti SC", Georgia, serif':'"PingFang SC",system-ui,sans-serif');g.textAlign='center';g.textBaseline='middle';if(stroke){g.strokeStyle=stroke;g.lineWidth=2.3;g.lineJoin='round';g.strokeText(s,x,y)}g.fillStyle=color;g.fillText(s,x,y)}
  inset(){
    const g=this.g,x=20,y=this.h-167,w=70,h=92,r=this.ratio;
    g.save();g.fillStyle='#fffdf0';g.strokeStyle='#96a68b';g.lineWidth=1;g.beginPath();g.roundRect(x,y,w,h,4);g.fill();g.stroke();
    g.save();g.beginPath();g.rect(x+3,y+3,w-6,h-22);g.clip();
    const z=Math.min((w-6)/(19*r),(h-22)/22);
    g.translate(x+w/2,y+(h-18)/2);g.scale(z,z);g.translate(-113.7*r,12.6);
    if(this.terrain.naturalWidth)g.drawImage(this.terrain,45*r,-67,120*r,67);
    for(const f of [...this.geo.provinces,...this.geo.islands]){g.strokeStyle='#64836d';g.lineWidth=.7/z;g.stroke(f.path)}
    g.restore();this.text('南海诸岛',x+w/2,y+h-10,10,'#566c59',550,null);g.restore();
  }
  draw(){
    if(!this.w||!this.h)return;
    const g=this.g,d=this.dpr,z=this.zoom;this.vb=this.visibleBounds();this.targets=[];
    g.setTransform(d,0,0,d,0,0);g.fillStyle='#c4dcde';g.fillRect(0,0,this.w,this.h);
    g.setTransform(d*z,0,0,d*z,d*(this.ax-this.cx*z),d*(this.ay-this.cy*z));
    if(this.terrain.complete&&this.terrain.naturalWidth)g.drawImage(this.terrain,45*this.ratio,-67,120*this.ratio,67);
    this.pathLayer(this.geo.neighbors,'#9aa79277',null,.7);
    this.pathLayer(this.geo.rivers.filter(f=>z>30||f.rank<6), '#72aeb793',null,z>70?1.15:.8);
    this.pathLayer(this.geo.lakes,null,'#9ac6cc');
    this.pathLayer(this.geo.provinces,'#6e886fc7','#6e987512',z>45?1.18:.95);
    this.pathLayer(this.geo.islands,'#829b8f',null,1);
    if(this.province){this.pathLayer(this.geo.cities.filter(c=>c.parent===this.province.code&&c.level!=='municipality'),'#8e9c82b0',null,.9);this.pathLayer([this.province],'#4d785d','#72a7680b',1.65)}
    if(this.city?.path)this.pathLayer([this.city],'#376c51','#6caa6925',1.7);
    g.setTransform(d,0,0,d,0,0);
    const labels=[['蒙 古',103.2,46.8],['俄 罗 斯',122,55.1],['哈萨克斯坦',70,45.3],['吉尔吉斯斯坦',72.7,40.6],['印 度',80.7,23.7],['尼泊尔',83.3,28.1],['不丹',90.9,27.5],['缅 甸',95.6,20.6],['越 南',106.4,15.7],['老 挝',101.5,19.8],['朝 鲜',127,40.2],['韩国',128,36],['日 本',136.7,35.3]];
    if(z<120){for(const [s,lon,lat]of labels){const [x,y]=this.xy(lon,lat);this.text(s,x,y,13,'#828d77',500,'#e5e7d0b3',true)}
      for(const [s,lon,lat]of [['东 海',125.1,28.2],['黄 海',123.3,35.8],['南 海',113.5,16.1],['日 本 海',133.5,40.5]]){const [x,y]=this.xy(lon,lat);this.text(s,x,y,13,'#63939e',500,'#c9e2e666',true)}}
    const occupied=[];
    const used=(x,y,w,h)=>occupied.some(r=>Math.abs(r[0]-x)<(r[2]+w)/2&&Math.abs(r[1]-y)<(r[3]+h)/2);
    const points=[];
    for(const s of this.records){const [x,y]=this.xy(s.lng,s.lat);if(x< -30||x>this.w+30||y< -30||y>this.h+30)continue;if(s.id===this.selected?.id)continue;points.push({x,y,s})}
    // World-anchored cells keep groups stable while the user pans.
    const cell=z<25?57:z<70?48:z<260?40:33,buckets=new Map();
    for(const p of points){const col=Math.floor((p.s.lng*this.ratio*z)/cell),row=Math.floor((-p.s.lat*z)/cell),key=col+','+row;
      let b=buckets.get(key);if(!b){b={x:0,y:0,rows:[]};buckets.set(key,b)}b.x+=p.x;b.y+=p.y;b.rows.push(p.s)}
    const clusters=[];
    for(const b of buckets.values()){b.x/=b.rows.length;b.y/=b.rows.length;clusters.push(b)}
    // Unite overly close neighbours along cell borders so labels stay distinct.
    clusters.sort((a,b)=>b.rows.length-a.rows.length);
    const merged=[];for(const b of clusters){const a=merged.find(a=>Math.abs(a.x-b.x)<24&&Math.abs(a.y-b.y)<22);if(!a){merged.push(b);continue}const n=a.rows.length+b.rows.length;a.x=(a.x*a.rows.length+b.x*b.rows.length)/n;a.y=(a.y*a.rows.length+b.y*b.rows.length)/n;a.rows.push(...b.rows)}
    const selected=this.selected?this.xy(this.selected.lng,this.selected.lat):null;
    if(selected)occupied.push([selected[0],selected[1]-15,70,35]);
    for(const b of merged){const n=b.rows.length,r=n===1?4.6:n<10?9.5:n<100?12.2:14.4;occupied.push([b.x,b.y,r*2+3,r*2+4])}
    const names=this.province&&z>25?this.geo.cities.filter(c=>c.parent===this.province.code&&c.level!=='municipality'):this.geo.provinces;
    for(const f of names){const [x,y]=this.xy(...f.center);if(x<0||x>this.w||y<0||y>this.h)continue;const s=f.short||f.name;const size=z>32?12:11,w=s.length*size;
      for(const dy of [0,-19,19,-33,33]){if(!used(x,y+dy,w,12)){this.text(s,x,y+dy,size,'#53684f',590,'#f0f0d7c4');occupied.push([x,y+dy,w+2,13]);break}}}
    for(const b of merged){const n=b.rows.length,one=b.rows[0];let r=n===1?4.6:n<10?9.5:n<100?12.2:14.4;
      const amber=b.rows.every(s=>s.level===4);
      g.beginPath();g.arc(b.x,b.y,r+(n===1?1.1:3.0),0,Math.PI*2);g.fillStyle=n===1?'#ffffeac9':amber?'#f2d9a5aa':'#c1d5b1bd';g.fill();
      g.beginPath();g.arc(b.x,b.y,r,0,Math.PI*2);g.fillStyle=n===1?(amber?'#c68b42':'#236e4f'):(amber?'#bd9149':n<10?'#7b9e70':n<100?'#5a8661':'#396c4f');g.fill();g.strokeStyle='#f4f5dc';g.lineWidth=1;g.stroke();
      if(n>1)this.text(String(n),b.x,b.y+.2,n>999?9:10.5,'#fffff6',700,null);
      this.targets.push({x:b.x,y:b.y,r:r+4,one:n===1?one:null,rows:b.rows,label:n===1?one.displayName:n+' 处景区 · 点击展开'});
    }
    if(selected){const [x,y]=selected,s=this.selected;const title=s.shortName||s.displayName;const label=title.length>10?title.slice(0,9)+'…':title;g.font='650 13px "PingFang SC",system-ui';const w=g.measureText(label).width+19;
      g.save();g.translate(x,y);g.shadowColor='#293a3055';g.shadowBlur=4;g.shadowOffsetY=2;g.beginPath();g.moveTo(0,1);g.bezierCurveTo(-4,-6,-13,-12,-13,-21);g.arc(0,-21,13,Math.PI,2*Math.PI);g.bezierCurveTo(13,-12,4,-5,0,1);g.fillStyle='#18513e';g.fill();g.shadowBlur=0;g.strokeStyle='#fffef0';g.lineWidth=2;g.stroke();g.beginPath();g.arc(0,-21,4.1,0,Math.PI*2);g.fillStyle='#f2de94';g.fill();g.restore();
      const bx=x-w/2,by=y-59;g.beginPath();g.roundRect(bx,by,w,22,5);g.fillStyle='#fffef4';g.fill();g.strokeStyle='#78987a';g.lineWidth=1;g.stroke();this.text(label,x,by+11,12,'#23543d',680,null);this.targets.push({x,y:y-16,r:18,rect:[bx,by,bx+w,by+22],one:s,label:title});
    }
    if(!this.province&&z<26&&this.right>480&&this.h>500)this.inset();
    const scaleKm=56/z*111.32*Math.cos((-this.cy)*Math.PI/180)/this.ratio;
    document.querySelector('#scale-text').textContent=(scaleKm>=5?Math.round(scaleKm/5)*5:scaleKm.toFixed(scaleKm<1?2:1))+' km';
  }
}
