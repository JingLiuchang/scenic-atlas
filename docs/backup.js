let recordStore, cloudSync, deviceToken, tokenStorageIssue='';
function syncScope(){
  const path=location.pathname;
  if(location.protocol==='file:')return path;
  return location.origin+path.replace(/\/index\.html$/,'/').replace(/\/?$/,'/');
}
function backupStatus(){
  if($('#modal[open] #backup-file') && Boolean($('#cloud-connect'))===Boolean(cloudSync?.api)){
    dataDialog();return;
  }
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
  deviceToken=new AtlasDeviceToken(recordStore.db);
  cloudSync=new AtlasSync(recordStore,backupStatus,version=>{
    if(version)forgetSavedToken(version).catch(showTokenStorageError);
  });
  recordStore.channel?.addEventListener('message',event=>{
    const message=event.data;
    if(message?.type==='forget-token' && cloudSync.api?.savedVersion===message.version)cloudSync.disconnect();
  });
  try{
    const saved=await deviceToken.load();
    if(saved)cloudSync.resume(saved);
  }catch{tokenStorageIssue='此浏览器无法读取已保存的令牌。可以清除后重新连接。';cloudSync.status(tokenStorageIssue)}
  if(recordStore.issue)toast(recordStore.issue);
  window.addEventListener('online',()=>cloudSync.schedule(100));
  document.addEventListener('visibilitychange',()=>{if(!document.hidden)cloudSync.schedule(250)});
  setInterval(()=>{if(!document.hidden&&navigator.onLine)cloudSync.schedule(500)},60000);
}
async function forgetSavedToken(version){
  const removed=await deviceToken.forget(version);
  tokenStorageIssue='';
  if(removed)recordStore.channel?.postMessage({type:'forget-token',version:removed});
}
function showTokenStorageError(){
  tokenStorageIssue='浏览器未能清除保存的令牌，请重试。';cloudSync.status(tokenStorageIssue);
  if($('#modal[open] #backup-file'))dataDialog();
}
async function disconnectDevice(){
  const version=cloudSync.api?.savedVersion;
  cloudSync.disconnect();
  try{
    if(version||tokenStorageIssue)await forgetSavedToken(version);
    if($('#modal[open] #backup-file'))dataDialog();
  }catch{showTokenStorageError()}
}
function personalCounts(){
  const rows=Object.values(marks);
  return '已去过 '+rows.filter(s=>s.visited).length+' 处，想去 '+rows.filter(s=>s.want).length+' 处';
}
function dataDialog(){
  const connected=cloudSync.api, pref=connectionPreference();
  const defaultName=pref.name||'scenic-atlas-data';
  const rememberOption=deviceToken.supported
    ? '<label class="remember-token"><input id="remember-token" type="checkbox"> 在此设备上记住令牌</label><p class="smallnote">仅在自己的设备上勾选。下次用同一浏览器打开地图时会自动同步。</p>'
    : '<p class="smallnote">此浏览器仅支持本次连接。</p>';
  const clearButton='<button class="secondary" data-action="disconnect">清除此设备的令牌</button>';
  const active=connected?'<p class="modal-copy">数据仓库 <strong>'+esc(connected.owner+'/'+connected.repo)+'</strong></p><p class="smallnote">'+(connected.savedVersion?'此设备已记住令牌，下次打开会自动同步。':'此令牌仅用于本次连接。')+'</p><div class="data-actions"><button class="primary" id="sync-now" data-action="sync-now">立即同步</button>'+(connected.savedVersion?clearButton:'<button class="secondary" data-action="disconnect">断开连接</button>')+'</div>':
  '<form id="cloud-connect"><label class="form-field">你的私有数据仓库名称<input id="repo-name" name="repo" required maxlength="100" value="'+esc(defaultName)+'" autocapitalize="none" spellcheck="false"></label><label class="form-field">GitHub 细粒度访问令牌<input id="repo-token" name="token" type="password" required placeholder="github_pat_…" autocomplete="off" autocapitalize="none" spellcheck="false"></label><p class="smallnote">仅选择自己的私有数据仓库，授予 Contents 读写权限。</p>'+rememberOption+'<div class="data-actions"><button class="primary" type="submit">连接并合并记录</button>'+link('创建细粒度令牌','https://github.com/settings/personal-access-tokens/new','linkbtn')+'</div></form>'+(tokenStorageIssue?clearButton:'');
  openModal('备份与同步','<p class="modal-copy">'+esc(personalCounts())+(home?' · 定居点已设置':'')+'</p><div class="data-actions"><button class="secondary" data-action="backup-export">导出 JSON</button><button class="secondary" data-action="backup-import">导入 JSON</button><input type="file" id="backup-file" accept=".json,application/json" hidden></div><p class="smallnote">备份包含足迹和定居点。导入时逐项合并修改，包括已取消的标记。</p><hr class="spacerline"><h3 class="info-title">'+ic('layers')+'私有仓库同步</h3>'+active+'<p class="sync-status" role="status" data-sync-message></p>');
  $('#backup-file').onchange=e=>{const file=e.target.files?.[0];if(file)importBackup(file);e.target.value=''};
  if(!connected)$('#cloud-connect').onsubmit=connectData;
  backupStatus();
}
async function connectData(event){
  event.preventDefault();const form=event.currentTarget,submit=form.querySelector('[type=submit]');
  const field=$('#repo-token'), token=field.value.trim(),repo=$('#repo-name').value.trim();
  const remember=Boolean($('#remember-token')?.checked);
  field.value='';submit.disabled=true;cloudSync.status('正在核对 GitHub 账号与仓库可见性…');
  try{
    await cloudSync.connect(token,repo,async (meta,api)=>{
      const previous=connectionPreference();
      if(previous.id&&previous.id!==meta.id&&!window.confirm('当前设备曾连接 '+previous.fullName+'。将本机足迹和定居点合并到 '+meta.full_name+'？'))throw new Error('已取消切换仓库。');
      if(remember){
        api.savedVersion=await deviceToken.save(api,meta).catch(()=>{throw new Error('浏览器未能保存令牌。请重试，或取消勾选后仅连接本次。')});
        tokenStorageIssue='';
      }else if(tokenStorageIssue){await forgetSavedToken()}
      try{localStorage.setItem(recordStore.scope+':connection',JSON.stringify({id:meta.id,name:meta.name,fullName:meta.full_name}))}catch{}
    });
    if(form.isConnected&&$('#modal').open)dataDialog();
  }catch(e){cloudSync.status(e.message)}
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
  case 'disconnect':disconnectDevice();break;
  default:return false;
  }
  return true;
}
