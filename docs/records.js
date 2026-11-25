/* A revision belongs to one flag or to the home location. False and null are
   retained so that offline devices cannot resurrect a removal. */
const AtlasRecords = (() => {
  const format = 'shanhe-atlas-records';
  const flags = ['visited', 'want'];
  const empty = () => ({format, version: 1, spots: Object.create(null), home: null});
  const object = x => x !== null && typeof x === 'object' && !Array.isArray(x);
  const validId = id => /^[a-z0-9][a-z0-9._-]{0,159}$/i.test(id) && !['constructor','prototype','__proto__'].includes(id);
  function fail() { throw new Error('记录格式或版本不兼容，原有数据已保留。'); }
  function parseHome(h) {
    if (h === null) return null;
    if (!object(h) || typeof h.name !== 'string' || !h.name.trim() || h.name.length > 180 ||
        !Number.isFinite(h.lng) || Math.abs(h.lng)>180 || !Number.isFinite(h.lat) ||
        Math.abs(h.lat)>90 || !['GCJ-02','WGS84'].includes(h.crs)) fail();
    return {name:h.name.trim(),lng:h.lng,lat:h.lat,crs:h.crs};
  }
  function cell(c, isHome) {
    if (!object(c) || !Number.isSafeInteger(c.t) || c.t<1 || c.t>8640000000000000 ||
        typeof c.by !== 'string' || !/^[a-z0-9-]{1,64}$/i.test(c.by)) fail();
    if (!isHome && typeof c.value !== 'boolean') fail();
    return {value:isHome ? parseHome(c.value) : c.value,t:c.t,by:c.by};
  }
  function parse(doc) {
    if (!object(doc) || doc.format!==format || doc.version!==1 || !object(doc.spots) ||
        Object.keys(doc.spots).length>30000) fail();
    const out=empty();
    if (doc.home!==null) out.home=cell(doc.home,true);
    for (const [id, rec] of Object.entries(doc.spots)) {
      if (!validId(id) || !object(rec) || Object.keys(rec).some(k=>!flags.includes(k))) fail();
      const row={};
      for(const k of flags) if(Object.hasOwn(rec,k)) row[k]=cell(rec[k],false);
      if (Object.keys(row).length) out.spots[id]=row;
    }
    return out;
  }
  function newer(a,b) {
    if(!a || !b) return a||b||null;
    if(a.t!==b.t) return a.t>b.t?a:b;
    if(a.by!==b.by) return a.by>b.by?a:b;
    // Also converge deterministically if an edited backup reuses a revision.
    return JSON.stringify(a.value)>=JSON.stringify(b.value)?a:b;
  }
  function merge(...docs) {
    const out=empty();
    for (const doc of docs) {
      out.home=newer(out.home,doc.home);
      for(const [id,rec] of Object.entries(doc.spots)) {
        const row=out.spots[id]||(out.spots[id]={});
        for(const k of flags) if(rec[k]) row[k]=newer(row[k],rec[k]);
      }
    }
    return out;
  }
  function encode(doc) {
    const spots=Object.create(null);
    for(const id of Object.keys(doc.spots).sort()){
      spots[id]={}; for(const f of flags) if(doc.spots[id][f]) spots[id][f]=doc.spots[id][f];
    }
    return JSON.stringify({format,version:1,spots,home:doc.home});
  }
  function legacy(marks,home) {
    const out=empty();
    if(object(marks)) for(const [id,rec] of Object.entries(marks)) {
      if(!validId(id)||!object(rec)) continue;
      const row={};
      for(const k of flags) if(rec[k]===true) row[k]={value:true,t:1,by:'legacy'};
      if(Object.keys(row).length) out.spots[id]=row;
    }
    if(home) out.home={value:parseHome(home),t:1,by:'legacy'};
    return out;
  }
  function display(doc){
    const marks=Object.create(null);
    for (const [id,rec] of Object.entries(doc.spots)) {
      if(rec.visited?.value||rec.want?.value) marks[id]={visited:!!rec.visited?.value,want:!!rec.want?.value};
    }
    return {marks,home:doc.home?.value||null};
  }
  return {empty,parse,parseHome,merge,encode,legacy,display,validId,flags};
})();
if(typeof module!=='undefined' && module.exports) module.exports=AtlasRecords;
