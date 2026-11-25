const test=require('node:test');
const assert=require('node:assert/strict');
const records=require('../docs/records');
global.AtlasRecords=records;
const {AtlasGitHub,AtlasSync}=require('../docs/github-sync');
function delta(id,field,value,t,by='a'){
  const d=records.empty(),c={value,t,by};
  if(field==='home')d.home=c;else d.spots[id]={[field]:c};
  return d;
}
const home={name:'杭州',lng:120.1,lat:30.2,crs:'GCJ-02'};
function memory(initial){return {state:initial,async include(doc){this.state=records.merge(this.state,doc);return this.state}}}
test('default transport calls fetch with the browser global and surfaces GitHub HTTP errors',async(t)=>{
  let received=0;
  t.mock.method(globalThis,'fetch',async function(url){
    assert.equal(this,globalThis,'native browser fetch requires its global receiver');
    assert.equal(url,'https://api.github.com/user');
    received++;
    return Response.json({message:'Bad credentials'},{status:401});
  });
  const api=new AtlasGitHub('github_pat_test','atlas');
  await assert.rejects(api.identify(),{status:401,message:/令牌无效/});
  assert.equal(received,1);
});
test('independent flags, cancellations, and home deletion survive merge in both directions',()=>{
 const a=records.merge(delta('hill','visited',true,10),delta('lake','want',true,10),delta(null,'home',home,12));
 const b=records.merge(delta('hill','want',true,9),delta('lake','want',false,15),delta(null,'home',null,13));
 assert.equal(records.encode(records.merge(a,b)),records.encode(records.merge(b,a)));
 assert.equal(records.encode(records.parse(JSON.parse(records.encode(a)))),records.encode(a));
 const merged=records.merge(a,b);assert.deepEqual(records.display(merged).marks.hill,{want:true,visited:true});
 assert.equal(records.display(merged).marks.lake,undefined);assert.equal(merged.home.value,null);
 assert.equal(records.encode(records.merge(merged,a)),records.encode(merged));
});
test('old browser data imports once at a revision older than later edits',()=>{
 const a=records.legacy({hill:{visited:true},lake:{want:true}},home);
 const combined=records.merge(delta('hill','visited',false,2),a);
 assert.equal(records.display(combined).marks.hill,undefined);assert.equal(records.display(combined).home.name,'杭州');
});
test('malformed backups, unsafe keys and unknown schema versions fail without rewriting state',()=>{
 for(const bad of [{}, {...records.empty(),version:2}, {...records.empty(),spots:JSON.parse('{"__proto__":{}}')},
 delta('a','visited','yes',1),delta(null,'home',{...home,lat:190},5)]){
    assert.throws(()=>records.parse(bad));
 }
});
test('client refuses public repositories; token is sent only to the GitHub API',async()=>{
 let writes=0;
 const send=async(address,opts)=>{
  assert.equal(new URL(address).origin,'https://api.github.com');assert.equal(opts.redirect,'error');assert.equal(opts.credentials,'omit');
  if(opts.method==='PUT')writes++;
  return Response.json(address.endsWith('/user')?{login:'alice'}:{private:false,owner:{login:'alice'}});
 };
 const api=new AtlasGitHub('github_pat_'+'test','test-repo',send);
 await assert.rejects(api.identify(),/私有仓库/);assert.equal(writes,0);
});
test('visibility is rechecked before writing; private to public stops the upload',async()=>{
 let visibility=true,write=0;
 const api=new AtlasGitHub('github_pat_'+'test','data',async(address,options)=>{
  if(options.method==='PUT')write++;
  return Response.json(address.endsWith('/user')?{login:'a'}:{id:1,default_branch:'main',owner:{login:'a'},private:visibility});
 });
 await api.identify();visibility=false;await assert.rejects(api.write('{}','sha','main'));assert.equal(write,0)
});
test('a concurrent item is fetched and merged after a stale SHA, including a simultaneous first create',async()=>{
 for(const conflict of [409,422]){
  let remote=records.empty(),version=null,calls=0;
  const store=memory(delta('hill','visited',true,3)),sync=new AtlasSync(store,()=>{});
  sync.api={branch:'main',async checkRepo(){},async read(){return{doc:remote,sha:version}},
   async write(json,sha){if(!calls++){remote=delta('lake','want',true,4,'b');version='b';throw Object.assign(Error(),{status:conflict})}
    assert.equal(sha,'b');remote=records.parse(JSON.parse(json));},close(){}};
  await sync.sync();assert.equal(calls,2);assert.deepEqual(Object.keys(remote.spots).sort(),['hill','lake']);
  assert.match(sync.message,/已同步/);sync.disconnect();
 }
});
test('UTF-8 file roundtrip, pinned repository and branch, correct file SHA',async()=>{
 let payload,reads=0;const doc=delta(null,'home',home,1);
 const api=new AtlasGitHub('github_pat_'+'test','atlas',async(address,options)=>{
  if(address.endsWith('/user'))return Response.json({login:'alice'});
  if(!address.includes('/contents/'))return Response.json({id:21,name:'atlas',private:true,default_branch:'live',owner:{login:'alice'}});
  if(options.method==='PUT'){payload=JSON.parse(options.body);return Response.json({})}
  reads++;return Response.json({type:'file',size:150,encoding:'base64',content:Buffer.from(records.encode(doc)).toString('base64'),sha:'abc'});
 });
 await api.identify();const before=await api.read();await api.write(records.encode(before.doc),before.sha,api.branch);
 assert.equal(reads,1);assert.equal(payload.sha,'abc');assert.equal(payload.branch,'live');
 assert.equal(JSON.parse(Buffer.from(payload.content,'base64').toString()).home.value.name,'杭州');
 api.close();assert.equal(api.token,'');
});
test('offline failures keep the local mutation and schedule a retry',async()=>{
 const store=memory(delta('hill','visited',true,4)),sync=new AtlasSync(store,()=>{});
 sync.api=new AtlasGitHub('github_pat_test','atlas',async()=>{throw new TypeError('Failed to fetch')});
 await assert.rejects(sync.api.identify(),{message:/api\.github\.com/,retryable:true});
 await sync.sync();assert.equal(store.state.spots.hill.visited.value,true);assert.ok(sync.retry);assert.ok(sync.timer);sync.disconnect();
});
test('malformed remote JSON remains untouched',async()=>{
 let writes=0;
 const api=new AtlasGitHub('github_pat_'+'test','atlas',async(url,opt)=>{
  if(opt.method==='PUT')writes++;
  if(url.endsWith('/user'))return Response.json({login:'owner'});
  if(url.includes('/contents/'))return Response.json({type:'file',size:4,encoding:'base64',sha:'v1',content:'e2JhZA=='});
  return Response.json({id:4,private:true,default_branch:'main',owner:{login:'owner'}});
 });
 await api.identify();const sync=new AtlasSync(memory(delta('hill','want',true,3)),()=>{});
 sync.api=api;await sync.sync();assert.equal(writes,0);assert.match(sync.message,/无法解析/);sync.disconnect();
});
test('a remembered credential checks the pinned private repo before reading and syncing',async(t)=>{
  const saved={owner:'alice',repo:'atlas',repoId:21,version:'device-1',token:'github_pat_test'};
  const requests=[];
  let repoId=21;
  t.mock.method(globalThis,'fetch',async(url,options)=>{
    requests.push(new URL(url).pathname);
    assert.equal(options.headers.Authorization,'Bearer '+saved.token);
    if(url.includes('/contents/'))return Response.json({},{status:404});
    return Response.json({id:repoId,private:true,default_branch:'main',owner:{login:'alice'}});
  });
  const sync=new AtlasSync(memory(records.empty()),()=>{});
  await sync.resume(saved);
  assert.match(sync.message,/已同步/);
  assert.deepEqual(requests,['/repos/alice/atlas','/repos/alice/atlas/contents/atlas-records.json']);
  repoId=22;requests.length=0;
  await sync.resume(saved);
  assert.match(sync.message,/身份发生变化/);
  assert.deepEqual(requests,['/repos/alice/atlas']);
  sync.disconnect();
});
test('a remembered credential survives network loss and only its version is forgotten on 401',async(t)=>{
  let expired=false;
  t.mock.method(globalThis,'fetch',async()=>{
    if(expired)return Response.json({},{status:401});
    throw new TypeError('offline');
  });
  const invalidated=[];
  const sync=new AtlasSync(memory(records.empty()),()=>{},version=>invalidated.push(version));
  await sync.resume({owner:'a',repo:'atlas',repoId:21,version:'device-2',token:'github_pat_test'});
  assert.ok(sync.timer);assert.deepEqual(invalidated,[]);
  expired=true;await sync.sync();
  assert.equal(sync.api,null);assert.deepEqual(invalidated,['device-2']);assert.match(sync.message,/已过期/);
});
