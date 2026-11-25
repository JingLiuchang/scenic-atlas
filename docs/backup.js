let recordStore, cloudSync;
function syncScope(){
  const path=location.pathname;
  if(location.protocol==='file:')return path;
  return location.origin+path.replace(/\/index\.html$/,'/').replace(/\/?$/,'/');
}
function backupStatus(){
  const text=cloudSync?.message||'仅保存在此设备';
  document.querySelectorAll('[data-sync-message]').forEach(el=>el.textContent=text);
  const button=document.querySelector('#sync-now');
  if(button)button.disabled=!cloudSync?.api||text==='正在同步…';
}
function refreshPersonal(){
  if(!recordStore)return;
  const current=AtlasRecords.display(recordStore.state);
  marks=current.marks;home=current.home;
  if(map&&regions.length){homeLabel();update({keepList:true})}
  backupStatus();
}
function connectionPreference(){
  try{return JSON.parse(localStorage.getItem(recordStore.scope+':connection'))||{}}catch{return {}}
}
async function startPersonal(){
  let legacy=AtlasRecords.empty();
  // github.io shares an origin among project paths. A new fork starts clean.
  if(!location.hostname.endsWith('.github.io')){
    try{legacy=AtlasRecords.legacy(read('records',{}),read('home',null))}catch{legacy=AtlasRecords.legacy(read('records',{}),null)}
  }
  recordStore=new AtlasRecordStore(syncScope(),refreshPersonal);
  await recordStore.open(legacy);refreshPersonal();
  cloudSync=new AtlasSync(recordStore,backupStatus);
  if(recordStore.issue)toast(recordStore.issue);
  window.addEventListener('online',()=>cloudSync.schedule(100));
  document.addEventListener('visibilitychange',()=>{if(!document.hidden)cloudSync.schedule(250)});
  setInterval(()=>{if(!document.hidden&&navigator.onLine)cloudSync.schedule(500)},60000);
}
function personalCounts(){
  const rows=Object.values(marks);
  return '已去过 '+rows.filter(s=>s.visited).length+' 处，想去 '+rows.filter(s=>s.want).length+' 处';
}
function dataDialog(){
  const connected=cloudSync.api, pref=connectionPreference();
  const defaultName=pref.name||'scenic-atlas-data';
  const active=connected?'<p class="modal-copy">已连接 <strong>'+esc(connected.owner+'/'+connected.repo)+'</strong></p><div class="data-actions"><button class="primary" id="sync-now" data-action="sync-now">立即同步</button><button class="secondary" data-action="disconnect">断开连接</button></div>':
  '<form id="cloud-connect"><label class="form-field">你的私有数据仓库名称<input id="repo-name" name="repo" required maxlength="100" value="'+esc(defaultName)+'" autocapitalize="none" spellcheck="false"></label><label class="form-field">GitHub 细粒度访问令牌<input id="repo-token" name="token" type="password" required placeholder="github_pat_…" autocomplete="off" autocapitalize="none" spellcheck="false"></label><p class="smallnote">仅选择你自己的私有数据仓库，授予 Contents 读写权限。令牌只在此页面内存中使用，刷新后需重新输入。</p><div class="data-actions"><button class="primary" type="submit">连接并合并记录</button>'+link('创建细粒度令牌','https://github.com/settings/personal-access-tokens/new','linkbtn')+'</div></form>';
  openModal('备份与同步','<p class="modal-copy">'+esc(personalCounts())+(home?' · 定居点已设置':'')+'</p><div class="data-actions"><button class="secondary" data-action="backup-export">导出 JSON</button><button class="secondary" data-action="backup-import">导入 JSON</button><input type="file" id="backup-file" accept=".json,application/json" hidden></div><p class="smallnote">备份包含足迹和定居点。导入时逐项合并修改，包括已取消的标记。</p><hr class="spacerline"><h3 class="info-title">'+ic('layers')+'私有仓库同步</h3>'+active+'<p class="sync-status" role="status" data-sync-message></p>');
  $('#backup-file').onchange=e=>{const file=e.target.files?.[0];if(file)importBackup(file);e.target.value=''};
  if(!connected)$('#cloud-connect').onsubmit=connectData;
  backupStatus();
}
async function connectData(event){
  event.preventDefault();const form=event.currentTarget,submit=form.querySelector('[type=submit]');
  const field=$('#repo-token'), token=field.value.trim(),repo=$('#repo-name').value.trim();
  field.value='';submit.disabled=true;cloudSync.status('正在核对 GitHub 账号与仓库可见性…');
  try{
    await cloudSync.connect(token,repo,async meta=>{
      const previous=connectionPreference();
      if(previous.id&&previous.id!==meta.id&&!window.confirm('当前设备曾连接 '+previous.fullName+'。将本机足迹和定居点合并到 '+meta.full_name+'？'))throw new Error('已取消切换仓库。');
      try{localStorage.setItem(recordStore.scope+':connection',JSON.stringify({id:meta.id,name:meta.name,fullName:meta.full_name}))}catch{}
    });
    if(form.isConnected&&$('#modal').open)dataDialog();
  }catch(e){cloudSync.status(e.name==='TypeError'?'无法连接 GitHub，请检查网络后再试。':e.message)}
  finally{submit.disabled=false}
}
async function exportBackup(){
  await recordStore.queue;
  const blob=new Blob([AtlasRecords.encode(recordStore.state)+'\n'],{type:'application/json;charset=utf-8'});
  const href=URL.createObjectURL(blob),a=document.createElement('a');
  a.href=href;a.download='shanhe-backup-'+new Date().toISOString().slice(0,10)+'.json';document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(href),60000);
}
async function importBackup(file){
  try{
    if(file.size>8*1024*1024)throw new Error('备份文件超过 8 MB。');
    const parsed=JSON.parse(await file.text());
    const doc=AtlasRecords.parse(parsed);
    await recordStore.include(doc);cloudSync.schedule(900,true);dataDialog();
    toast('已合并备份。'+personalCounts());
  }catch(e){toast(e instanceof SyntaxError?'文件不是有效的 JSON，现有记录已保留。':e.message)}
}
function dataAction(action){
  switch(action){
  case 'data':dataDialog();break;
  case 'backup-export':exportBackup().catch(()=>toast('导出失败，请重试。'));break;
  case 'backup-import':$('#backup-file').click();break;
  case 'sync-now':cloudSync.sync();break;
  case 'disconnect':cloudSync.disconnect();dataDialog();break;
  default:return false;
  }
  return true;
}
