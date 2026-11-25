/* IndexedDB read/write transactions serialize edits across tabs. One document
   contains both record types, so an import either commits in full or retries. */
class AtlasRecordStore {
  constructor(scope, onChange) {
    this.scope='shanhe.records.v2:'+scope;this.onChange=onChange;
    this.state=AtlasRecords.empty();this.db=null;this.mode='memory';this.issue='';
    this.writer=Array.from(crypto.getRandomValues(new Uint8Array(12)),n=>n.toString(16).padStart(2,'0')).join('');
    this.queue=Promise.resolve();
  }
  async open(legacy) {
    try {
      this.db=await new Promise((resolve,reject)=>{
        const q=indexedDB.open(this.scope,1);
        q.onupgradeneeded=()=>q.result.createObjectStore('atlas');
        q.onsuccess=()=>resolve(q.result);q.onerror=()=>reject(q.error);
      });
      this.mode='idb';this.db.onversionchange=()=>this.db.close();
    } catch {
      try {
        localStorage.setItem(this.scope+':probe','1');localStorage.removeItem(this.scope+':probe');
        this.mode='local';
      } catch { this.issue='当前浏览器无法持久保存，请在关闭前导出备份。'; }
    }
    // The legacy snapshot is imported only into an uninitialized profile.
    await this.transact(current=>current||legacy);
    if('BroadcastChannel' in window) try {
      this.channel=new BroadcastChannel(this.scope);
      this.channel.onmessage=()=>this.transact(s=>s||this.state).catch(()=>{});
    } catch {}
    window.addEventListener('storage',e=>{if(this.mode==='local' && e.key===this.scope && e.newValue) {
      try {this.accept(AtlasRecords.merge(this.state,AtlasRecords.parse(JSON.parse(e.newValue))));} catch {}
    }});
  }
  accept(next) {
    const changed=AtlasRecords.encode(this.state)!==AtlasRecords.encode(next);
    this.state=next;if(changed)this.onChange();
  }
  transact(change) {
    const run=async()=>{
      let result;
      if(this.mode==='idb'){
        result=await new Promise((resolve,reject)=>{
          const tx=this.db.transaction('atlas','readwrite'),st=tx.objectStore('atlas');
          const q=st.get('records');let next;
          q.onsuccess=()=>{
            try {const old=q.result?AtlasRecords.parse(q.result):null;next=change(old);
              if(!old||AtlasRecords.encode(old)!==AtlasRecords.encode(next))st.put(next,'records');
            } catch(e){reject(e);tx.abort()}
          };
          tx.oncomplete=()=>resolve(next);
          tx.onabort=tx.onerror=()=>reject(tx.error||new Error('记录写入失败。'));
        });
      }else if(this.mode==='local'){
        const save=()=>{
          const raw=localStorage.getItem(this.scope),previous=raw?AtlasRecords.parse(JSON.parse(raw)):null;
          const next=change(previous?AtlasRecords.merge(previous,this.state):null);
          localStorage.setItem(this.scope,AtlasRecords.encode(next));return next;
        };
        result=navigator.locks?await navigator.locks.request(this.scope,save):save();
      }else result=change(this.memoryReady?this.state:null);
      this.memoryReady=true; this.accept(result);return result;
    };
    const task=this.queue.then(run);this.queue=task.catch(()=>{});return task;
  }
  async edit(id,field,value) {
    await this.transact(current=>{
      const doc=AtlasRecords.merge(this.state,current||AtlasRecords.empty());
      const old=field==='home'?doc.home:doc.spots[id]?.[field];
      const revision={value,t:Math.max(Date.now(),(old?.t||0)+1),by:this.writer};
      if(field==='home')doc.home=revision;
      else (doc.spots[id]||(doc.spots[id]={}))[field]=revision;
      return doc;
    });
    this.channel?.postMessage('changed');
  }
  async include(incoming) {
    await this.transact(current=>AtlasRecords.merge(this.state,current||AtlasRecords.empty(),incoming));
    this.channel?.postMessage('changed');return this.state;
  }
}
