class AtlasGitHub {
  constructor(token, repo, send=fetch) {
    if(!/^[a-z0-9][a-z0-9._-]{0,99}$/i.test(repo))throw new Error('请输入仓库名称，例如 scenic-atlas-data。');
    if(!token.startsWith('github_pat_'))throw new Error('请使用仅授权给私人数据仓库的细粒度令牌。');
    this.token=token;this.repo=repo;this.send=send;this.controller=new AbortController();
  }
  async request(path,options={}) {
    const response=await this.send('https://api.github.com'+path,{
      method:options.method||'GET',body:options.body?JSON.stringify(options.body):undefined,
      headers:{Accept:'application/vnd.github+json',Authorization:'Bearer '+this.token,
        'X-GitHub-Api-Version':'2022-11-28',...(options.body?{'Content-Type':'application/json'}:{})},
      credentials:'omit',redirect:'error',cache:'no-store',referrerPolicy:'no-referrer',signal:this.controller.signal
    });
    if(response.status===404 && options.missing)return null;
    if(!response.ok){
      const messages={401:'令牌无效或已过期，请重新连接。',403:'GitHub 拒绝此次操作，请检查仓库内容权限、令牌有效期和 API 配额。',404:'找不到数据仓库，请确认已创建私有仓库并将它授权给令牌。',409:'另一台设备刚刚提交了更改。',422:'GitHub 无法写入文件，请检查默认分支及其写入规则。',429:'请求频率过高，稍后将重试。'};
      const err=new Error(messages[response.status]||'GitHub 服务暂不可用，请稍后重试。');
      err.status=response.status;throw err;
    }
    return response.json();
  }
  async identify() {
    const user=await this.request('/user');this.owner=user.login;
    this.base='/repos/'+encodeURIComponent(this.owner)+'/'+encodeURIComponent(this.repo);
    return this.checkRepo();
  }
  async checkRepo() {
    const meta=await this.request(this.base);
    if(meta.private!==true||meta.visibility==='internal'||meta.owner?.login?.toLowerCase()!==this.owner.toLowerCase()||meta.archived||meta.disabled)
      throw new Error('仅可同步到此 GitHub 账号拥有的、可写的私有仓库。');
    if(this.repoId && meta.id!==this.repoId)throw new Error('数据仓库身份发生变化，请重新连接。');
    this.repoId=meta.id;this.branch=meta.default_branch;return meta;
  }
  async read() {
    const url=this.base+'/contents/atlas-records.json?ref='+encodeURIComponent(this.branch);
    const file=await this.request(url,{missing:true});
    if(!file)return {doc:AtlasRecords.empty(),sha:null};
    if(file.type!=='file'||!Number.isSafeInteger(file.size)||file.size>8*1024*1024)throw new Error('云端记录文件类型或大小不受支持，已保留原文件。');
    const blob=file.encoding==='base64'?file:await this.request(this.base+'/git/blobs/'+encodeURIComponent(file.sha));
    const bytes=Uint8Array.from(atob(blob.content),c=>c.charCodeAt(0));
    let parsed;try{parsed=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes));}catch{throw new Error('云端记录文件无法解析，已保留原文件。')}
    return {doc:AtlasRecords.parse(parsed),sha:file.sha};
  }
  async write(json,sha,branch) {
    // Recheck visibility and identity immediately before every write.
    await this.checkRepo();
    if(this.branch!==branch){const e=new Error('默认分支已更改。');e.status=409;throw e}
    const bytes=new TextEncoder().encode(json+'\n');let binary='';
    for(let i=0;i<bytes.length;i+=8192)binary+=String.fromCharCode(...bytes.subarray(i,i+8192));
    const body={message:'Sync atlas records',content:btoa(binary),branch};
    if(sha)body.sha=sha;
    await this.request(this.base+'/contents/atlas-records.json',{method:'PUT',body});
  }
  close(){this.controller.abort();this.token=''}
}
class AtlasSync {
  constructor(store,notify) {
    this.store=store;this.notify=notify;this.api=null;this.running=null;this.timer=null;this.retry=0;
    this.message='仅保存在此设备';this.again=false;this.generation=0;
  }
  status(msg){this.message=msg;this.notify()}
  async connect(token,repo,accept) {
    this.disconnect(false);
    const generation=this.generation,api=new AtlasGitHub(token,repo);this.connecting=api;
    try {
      const meta=await api.identify();if(generation!==this.generation)return;
      await accept(meta);if(generation!==this.generation)return;
      this.api=api;this.connecting=null;await this.sync();
    }catch(err){if(generation===this.generation){this.connecting=null;api.close();this.api=null;this.status(err.message)}throw err}
  }
  disconnect(show=true){
    this.generation++;this.api?.close();this.connecting?.close();this.connecting=null;this.api=null;
    clearTimeout(this.timer);this.running=null;this.again=false;this.retry=0;
    if(show)this.status('云同步已断开，记录保存在此设备');
  }
  schedule(delay=900,dirty=false){
    if(!this.api)return;
    clearTimeout(this.timer);
    if(this.running){this.again=true;return}
    if(dirty)this.status('本地更改待同步');
    this.timer=setTimeout(()=>this.sync(),delay);
  }
  sync() {
    if(!this.api)return Promise.resolve();
    if(this.running){this.again=true;return this.running}
    clearTimeout(this.timer);const generation=this.generation,api=this.api;
    const active=()=>generation===this.generation;
    this.again=false;this.status('正在同步…');
    this.running=(async()=>{
      try{
        for(let attempt=0;attempt<4;attempt++){
          await api.checkRepo();const branch=api.branch;
          const remote=await api.read();if(!active())return;
          const combined=await this.store.include(remote.doc);if(!active())return;
          const data=AtlasRecords.encode(combined);
          // Empty profiles may stay empty. A missing remote is created at first edit.
          if(data!==AtlasRecords.encode(remote.doc)) {
            try {await api.write(data,remote.sha,branch)}
            catch(e){if((e.status===409||(!remote.sha&&e.status===422))&&attempt<3)continue;throw e}
          }
          if(!active())return;
          this.retry=0;this.status('已同步 · '+new Date().toLocaleTimeString('zh-CN',{hour:'2-digit',minute:'2-digit'}));return;
        }
      }catch(e){
        if(!active())return;
        const transient=!e.status&&e.name==='TypeError'||[409,429,500,502,503,504].includes(e.status);
        if(transient){this.retry=Math.min(6,this.retry+1);this.status('连接暂不可用，更改已留在本机，将自动重试。')}
        else {this.retry=0;this.status(e.message);if(e.status===401){this.disconnect(false);this.status(e.message)}}
      }finally{
        if(active()){
          this.running=null;
          if(this.again)this.schedule();
          else if(this.retry)this.schedule(2000*(2**this.retry));
        }
      }
    })();return this.running;
  }
}
if(typeof module!=='undefined'&&module.exports)module.exports={AtlasGitHub,AtlasSync};
