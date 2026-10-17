import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { createContext, runInContext } from "node:vm";
import { build } from "esbuild";
import { checkDirectory } from "../../tools/compat-check/check.mjs";

const directory = await mkdtemp(join(tmpdir(), "talos-contract-compat-"));
try {
  const output = join(directory, "contract.js");
  await build({
    entryPoints: [fileURLToPath(new URL("./src/index.ts", import.meta.url))],
    outfile: output,
    bundle: true,
    format: "iife",
    platform: "browser",
    globalName: "TalosContract",
    target: ["chrome70", "es2018"],
    legalComments: "none",
  });
  const { files, findings } = checkDirectory(directory, [
    {
      file: "contract.js",
      rule: "BigInt",
      justification:
        "Pinned Zod 3 includes optional bigint/coercion validators. Contract schemas never use them; the full registry is exercised below with BigInt unavailable. BigInt syntax is still rejected by the ES2018 parser.",
    },
  ]);
  assert.equal(
    files,
    1,
    "Compatibility scan must inspect the generated bundle",
  );
  assert.deepEqual(findings, [], "Chrome 70 syntax or unsupported API found");
  // A fresh realm prevents this probe from changing the build process's built-ins.
  const context = createContext({
    BigInt: undefined,
    globalThis: undefined,
    queueMicrotask: undefined,
    structuredClone: undefined,
    TextEncoder,
    TextDecoder,
  });
  runInContext(
    `Object.fromEntries = undefined; Promise.allSettled = undefined;
     String.prototype.matchAll = undefined; String.prototype.replaceAll = undefined;
     Array.prototype.at = undefined; String.prototype.at = undefined;`,
    context,
  );
  runInContext(await readFile(output, "utf8"), context, { timeout: 5000 });
  const result = await runInContext(
    `(async function () {
      var c = TalosContract;
      var id = '01ARZ3NDEKTSV4RRFFQ69G5FAV';
      var hash = new Array(65).join('a');
      var user = {id:id,name:'测试',handle:'test',roles:['administrator'],features:['offline']};
      var session = {user:user,token:hash,expires:1000,credentialVersion:0};
      var register = {v:{theme:'dark',nested:[1,true,null]},t:{ms:1000,counter:0},op:id};
      var setting = {id:'theme',key:'theme',value:register};
      var delta = {scopes:{},gone:[],added:[]};
      var settings = {retention:5,daily:true,cloudEnabled:false,autoCheck:false,manifestUrl:''};
      var update = {build:'test',phase:'idle',candidate:null,progress:0,lastError:null,launcher:false};
      var ticket = {ticket:'ticket',url:'/dl/ticket',expires:1000};
      var conversation = {id:id,kind:'group',type:'normal',name:'测试群',handle:'test-group',parent:null,owner:id,discoverable:true,membersHidden:false,adminOnly:false,noLeave:false,passwordRequired:false,created:1000,rev:1};
      var member = {user:id,conversation:id,name:'测试',handle:'test',hidden:false,joined:1000,rev:1};
      var post = {id:id,conversation:id,seq:1,rev:1,author:id,authorName:'测试',kind:'text',preview:'你好',bodyLength:2,replyTo:null,created:1000,edited:null,deletedAt:null,sticker:null,image:null};
      var boolState = {v:false,t:{ms:1000,counter:0},op:id};
      var chatState = {id:id,conversation:id,readSeq:0,pin:boolState,mute:boolState,draft:{v:'草稿',t:{ms:1000,counter:0},op:id},draftTextId:null,retention:{v:'auto',t:{ms:1000,counter:0},op:id},lastSeq:1,lastPost:post,updated:1000,mutedUntil:0};
      var file = {rid:hash,size:100,mime:'image/png',width:10,height:10};
      var sticker = {id:'pack:test',pack:'测试包',name:'测试贴纸',file:file};
      var announcement = {id:'current',revision:1,title:'公告',text:'测试公告',published:1000};
      var chunk = {size:6,offset:0,eof:true};
      var adminUser = {id:id,handle:'test',name:'测试',roles:['administrator'],features:['offline'],mutedUntil:0,banned:false,bannedUntil:null,deactivated:false,created:1000};
      var adminDevice = {id:id,label:'测试设备',lastSeen:1000,whitelisted:true,locked:false,boundUser:null,persistent:true};
      var adminSettings = {whitelist:false,systemLock:false,idleLock:false,identitySignals:['clientId'],maxVolume:1};
      var adminGroup = {id:id,handle:'group',name:'测试群',type:'normal',memberCount:1,parent:null,owner:id,discoverable:true,membersHidden:false,adminOnly:false,noLeave:false,passwordRequired:false};
      var aiConversation = {id:id,title:'AI',tags:[],lastSeq:0,readSeq:0,running:null,updated:0};
      var aiCredit = {id:'account',configured:false,topup:0,reserved:0,daily:0,weekly:0,dayUsed:0,weekUsed:0,available:0,planEnds:0,required:1000000};
      var aiFile = {path:'note.md',mime:'text/markdown',size:1,rev:1};
      var aiPolicy = {daily:100000000,weekly:300000000,days:30};
      var mediaTrack = {id:id,source:'fake',providerId:'one',title:'测试曲目',artists:['艺人'],album:null,durationMs:1000,audio:{id:hash,size:100,mime:'audio/wav'}};
      var mediaPlaylist = {id:id,owner:id,title:'测试歌单',tracks:[id],created:1000};
      var mediaState = {id:id,favorites:{},queue:[id],queueStamp:{t:{ms:1000,counter:0},op:id},recents:[id],stopAtEnd:false,stopStamp:null};
      var values = {
        'netbooks.search': [{query:'测试'},{books:[{id:'10001',title:'测试',author:'作者',abstract:'摘要'}],retryAt:6000,serverTime:1000}],
        'netbooks.download': [{book:'10001',collection:id},{job:id,joined:true}],
        'media.search': [{query:'测试',limit:20},{tracks:[mediaTrack],collections:[{kind:'playlist',id:'PL1',title:'歌单',subtitle:'测试',thumbnail:null}],collection:null,next:20}],
        'media.collection.open': [{kind:'playlist',id:'PL1'},{tracks:[mediaTrack],collections:[],collection:{kind:'playlist',id:'PL1',title:'歌单',subtitle:'测试',thumbnail:null},next:null}],
        'media.track.resolve': [{source:'fake',providerId:'one'},{track:mediaTrack}],
        'media.library.get': [{},{tracks:[mediaTrack],playlists:[mediaPlaylist],state:mediaState,maxVolume:0.5}],
        'media.track.play': [{track:id},{track:mediaTrack,download:ticket,job:null,maxVolume:0.5}],
        'media.track.prepare': [{track:id},{track:mediaTrack,download:ticket,job:null}],
        'media.favorite.set': [{track:id,value:{v:true,t:{ms:1000,counter:0},op:id}},{ok:true}],
        'media.queue.set': [{tracks:[id],t:{ms:1000,counter:0},op:id},{ok:true}],
        'media.stopAtEnd.set': [{value:true,t:{ms:1000,counter:0},op:id},{ok:true}],
        'media.playlist.create': [{title:'测试歌单'},{playlist:mediaPlaylist}],
        'media.playlist.delete': [{playlist:id},{ok:true}],
        'media.playlist.items': [{playlist:id,tracks:[id]},{playlist:mediaPlaylist}],
        'media.retention.set': [{kind:'playlist',id:id,value:{v:30,t:{ms:1000,counter:0},op:id}},{ok:true}],
        'media.track.recordPlay': [{track:id,t:{ms:1000,counter:0},op:id},{ok:true}],
        'media.playlist.recordPlay': [{playlist:id,t:{ms:1000,counter:0},op:id},{ok:true}],
        'media.playlist.share': [{playlist:id,principalType:'user',principal:id,level:'read'},{ok:true}],
        'media.playlist.grants': [{playlist:id},{grants:[],canShare:true}],
        'media.playlist.principals': [{},{principals:[{id:id,type:'user',name:'测试'}]}],
        'ai.text.put': [{id:id,offset:0,total:1,text:'x'},{ok:true}],
        'ai.content.fetch': [{kind:'message',id:id,offset:0},{size:0,eof:true}],
        'ai.conversation.create': [{title:'AI'},aiConversation],
        'ai.conversation.update': [{id:id,title:'AI',tags:[]},{ok:true}],
        'ai.conversation.fork': [{message:id},aiConversation],
        'ai.conversation.read': [{id:id,seq:1},{ok:true}],
        'ai.message.page': [{conversation:id},{messages:[],more:false,rev:1}],
        'ai.draft.set': [{id:id,value:{v:'草稿',t:{ms:1,counter:0},op:id}},{ok:true}],
        'ai.run.start': [{conversation:id,text:'你好'},{id:id}],
        'ai.run.stop': [{id:id},{ok:true}],
        'ai.account.get': [{},aiCredit],
        'ai.workspace.list': [{},[aiFile]],
        'ai.workspace.read': [{path:'note.md'},{file:aiFile,content:'x'}],
        'ai.workspace.write': [{path:'note.md',content:'x',expected:null},aiFile],
        'ai.workspace.delete': [{path:'note.md',expected:1},{ok:true}],
        'ai.workspace.image': [{upload:id,mime:'image/png'},aiFile],
        'ai.admin.users': [{query:''},[{id:id,name:'测试',handle:'test'}]],
        'ai.admin.stats': [{},{policy:aiPolicy,topup:0,planStock:0,consumed:0,days:[],ledger:[]}],
        'ai.admin.account': [{user:id},aiCredit],
        'ai.admin.assign': [{user:id,key:id,amount:1000000,days:30,note:''},aiCredit],
        'ai.admin.policy': [aiPolicy,{ok:true}],
        'admin.user.list': [{offset:0,limit:50,sort:'handle'},{items:[adminUser],total:1}],
        'admin.user.create': [{handle:'test',name:'测试',pin:'123456'},{user:adminUser}],
        'admin.user.update': [{id:id,name:'新名称'},{user:adminUser}],
        'admin.user.bulk': [{ids:[id],changes:{mutedUntil:1000}},{results:[{id:id,ok:true}]}],
        'admin.user.purge': [{id:id},{jobId:id}],
        'admin.invitation.list': [{offset:0,limit:50},{items:[{id:id,created:1000,expires:2000,claimedBy:null}],total:1}],
        'admin.invitation.revoke': [{id:id},{ok:true}],
        'admin.invitation.bulkRevoke': [{ids:[id]},{results:[{id:id,ok:true}]}],
        'admin.device.list': [{offset:0,limit:50},{items:[adminDevice],total:1}],
        'admin.device.update': [{id:id,label:'新设备'},{device:adminDevice}],
        'admin.device.delete': [{id:id},{ok:true}],
        'admin.device.policy.get': [{},adminSettings],
        'admin.device.policy.set': [{whitelist:true},adminSettings],
        'admin.group.list': [{offset:0,limit:50},{items:[adminGroup],total:1}],
        'admin.group.create': [{name:'测试群',handle:'test-group'},{group:adminGroup}],
        'admin.group.update': [{id:id,name:'新群名'},{group:adminGroup}],
        'admin.group.delete': [{id:id,name:'测试群'},{ok:true}],
        'admin.group.members': [{id:id},[member]],
        'admin.group.member': [{id:id,user:id,operation:'kick'},{ok:true}],
        'admin.announcement.list': [{offset:0,limit:50},{items:[Object.assign({},announcement,{acknowledged:1,audience:2})],total:1}],
        'admin.announcement.publish': [{title:'公告',text:'测试公告'},{announcement:announcement}],
        'admin.settings.get': [{},adminSettings],
        'admin.settings.set': [{maxVolume:0.5},adminSettings],
        'admin.audit.list': [{offset:0,limit:50},{items:[{id:id,actor:id,action:'admin.user.create',target:id,details:'{}',created:1000}],total:1}],
        'admin.incident.report': [{name:'Error',stack:' at widget',kind:'error',build:'test',environment:'Chrome/70 device/test'},{ok:true}],
        'admin.incident.list': [{offset:0,limit:50},{items:[{id:id,fingerprint:hash,source:'server',build:'test',environment:'linux node/test',count:1,first:1000,last:1000,summary:'Error: self-test'}],total:1}],
        'admin.incident.detail': [{id:id},{id:id,summary:'Error: self-test',source:'server',build:'test',environment:'linux node/test',stack:'Error',level:'error',module:'admin',relatedIds:[],count:1,first:1000,last:1000}],
        'admin.incident.download': [{},ticket],
        'admin.incident.selfTest': [{},{id:id}],
        'community.group.list': [{},[conversation]],
        'community.group.create': [{name:'测试群',discoverable:true},conversation],
        'community.group.find': [{query:'测试'},[conversation]],
        'community.group.children': [{group:id},[conversation]],
        'community.group.join': [{group:id,source:{type:'search'}},conversation],
        'community.group.leave': [{group:id},{ok:true}],
        'community.group.members': [{group:id},{members:[member],self:member,hidden:false}],
        'community.group.hide': [{group:id,hidden:true},{ok:true}],
        'community.dm.open': [{user:id,group:id},Object.assign({},conversation,{kind:'dm'})],
        'chat.post.send': [{id:id,conversation:id,kind:'text',text:'你好'},{post:post}],
        'chat.post.page': [{conversation:id,anchor:1,direction:'around',limit:40},{posts:[post],first:1,last:1,latest:1,hasBefore:false,hasAfter:false,rev:1}],
        'chat.post.edit': [{id:id,text:'你好'},{post:post}],
        'chat.post.delete': [{id:id},{post:Object.assign({},post,{deletedAt:1000,preview:'',bodyLength:0})}],
        'chat.post.body': [{id:id,offset:0},chunk],
        'chat.post.image': [{id:id,conversation:id,upload:id},{post:Object.assign({},post,{kind:'image',image:{original:file,thumbnail:file},bodyLength:0,preview:'[图片]'})}],
        'chat.text.put': [{id:id,offset:0,total:2,text:'你好'},{offset:2}],
        'chat.text.fetch': [{id:id,offset:0},chunk],
        'chat.file.fetch': [{rid:hash,conversation:id,offset:0},chunk],
        'chat.sticker.list': [{offset:0,limit:100},{stickers:[sticker],next:null}],
        'chat.state.set': [{conversation:id,key:'pin',value:boolState},{state:chatState}],
        'chat.state.read': [{conversation:id,seq:1},{state:chatState}],
        'chat.announcement.ack': [{revision:1},{ok:true}],
        'chat.announcement.publish': [{title:'公告',text:'测试公告'},{announcement:announcement}],
        'chat.user.mute': [{user:id,until:2000},{ok:true}],
        'ops.settings.get': [{},settings],
        'ops.settings.set': [settings,settings],
        'ops.backup.list': [{},[]],
        'ops.backup.create': [{},{id:id,created:1000,size:100}],
        'ops.backup.delete': [{id:id},{ok:true}],
        'ops.backup.download': [{id:id},ticket],
        'ops.update.status': [{},update],
        'ops.update.stage': [{upload:id},update],
        'ops.update.apply': [{},{ok:true}],
        'ops.update.confirm': [{},{ok:true}],
        'ops.update.check': [{},update],
        'ops.update.install': [{},update],
        'ops.https.status': [{},{domain:null,listeners:[],expiry:null,redirect:false,ca:false}],
        'ops.host.status': [{},{available:false}],
        'ops.host.run': [{action:'kill-wps'},{ok:true}],
        'ops.office.list': [{},{available:false,files:[]}],
        'ops.office.refresh': [{},{available:false,files:[]}],
        'ops.office.clear': [{},{ok:true}],
        'ops.office.download': [{id:id},ticket],
        'sys.info': [{},{version:1,build:'test',now:1000}],
        'sys.time': [{},{now:1000}],
        'auth.device.register': [{label:'tablet'},{device:id}],
        'auth.login': [{pin:'123456'},session],
        'auth.resume': [{token:hash},session],
        'auth.logout': [{},{ok:true}],
        'auth.lock': [{},{ok:true}],
        'identity.invitation.create': [{},{id:id,pin:'456789',expires:1000}],
        'identity.onboarding.complete': [{invitationToken:hash,pins:['123456','654321'],handle:'test',name:'测试'},session],
        'identity.profile.update': [{name:'新名称'},{user:user}],
        'identity.pins.replace': [{currentPin:'123456',pins:['654321']},{ok:true,credentialVersion:1}],
        'authority.access.set': [{user:id,roles:['administrator'],features:['offline']},{ok:true}],
        'authority.grant.set': [{resource:'collection:example',principalType:'user',principal:id,level:'read'},{ok:true}],
        'sync.pull': [{cursors:{}},delta],
        'sync.push': [{ops:[{op:id,method:'me.setting.set',args:{key:'theme',value:register}}]},{results:[{op:id}]}],
        'upload.begin': [{kind:'file',size:1024},{id:id,offset:0}],
        'upload.append': [{id:id,offset:0},{offset:1024}],
        'upload.commit': [{id:id},{id:id,object:{id:hash,size:1024}}],
        'upload.abort': [{id:id},{ok:true}],
        'upload.ticket': [{id:id,filename:'file.bin',mime:'application/octet-stream'},{ticket:'ticket',url:'/dl/ticket',expires:1000}],
        'library.doc.importText': [{title:'测试',body:'正文'},{doc:id,job:id}],
        'library.doc.importFile': [{title:'测试',name:'测试.pdf',upload:id},{doc:id,job:id}],
        'library.doc.open': [{doc:id},{document:{id:id,title:'测试',owner:id,created:1000,kind:'flow',status:'ready',pack:{id:hash,size:100},units:1,chars:2},manifest:{v:1,kind:'flow',meta:{},units:[],shared:[],resources:{}},pack:{id:hash,size:100},download:ticket}],
        'library.doc.describe': [{doc:id},{document:{id:id,title:'测试',owner:id,created:1000,kind:'flow',status:'ready',pack:{id:hash,size:100},units:1,chars:2},pack:{id:hash,size:100},download:ticket}],
        'library.doc.fetch': [{doc:id,rids:[hash]},{ok:true}],
        'library.doc.delete': [{doc:id},{ok:true}],
        'library.collection.transfer': [{source:id,target:id,doc:id},{ok:true}],
        'library.collection.create': [{title:'书单'},{id:id}],
        'library.collection.items': [{collection:id,docs:[id]},{ok:true}],
        'library.collection.delete': [{collection:id},{ok:true}],
        'library.sharing.principals': [{},{principals:[{id:id,type:'user',name:'测试'}]}],
        'library.sharing.list': [{collection:id},{grants:[],canShare:true}],
        'library.sharing.set': [{collection:id,principalType:'user',principal:id,level:'read',delegate:false},{ok:true}],
        'library.favourite.set': [{doc:id,value:{v:true,t:{ms:1000,counter:0},op:id}},{ok:true}],
        'library.collection.recordRead': [{collection:id,t:{ms:1000,counter:0},op:id},{ok:true}],
        'library.retention.set': [{kind:'doc',id:id,value:{v:7,t:{ms:1000,counter:0},op:id}},{ok:true}],
        'library.progress.set': [{doc:id,resume:{v:{unit:0,offset:0},t:{ms:1000,counter:0},op:id},furthest:0,seconds:1,device:id},{ok:true}],
        'tasks.retry': [{id:id},{ok:true}],
        'tasks.cancel': [{id:id},{ok:true}],
        'tasks.clear': [{},{ok:true}],
        'me.setting.set': [{key:'theme',value:register},{setting:setting}],
        'learning.corpus.import': [{text:'apple#苹果'},{imported:1,skipped:0,total:1,version:1}],
        'learning.answer.record': [{word:id,device:id,counter:{learned:1,wrong:0,answered:1,lastAt:1000}},{ok:true}],
        'learning.discipline.assign': [{user:id,enabled:true},{ok:true}]
      };
      c.methods.forEach(function (method) {
        if (!values[method.name]) throw new Error('Missing compatibility fixture: '+method.name);
        method.args.parse(values[method.name][0]);
        method.result.parse(values[method.name][1]);
      });
      c.events['sync.delta'].data.parse(delta);
      c.entities.profile.schema.parse(user);
      c.entities.grant.schema.parse({id:id,resource:'collection:example',principalType:'user',principal:id,level:'read'});
      c.contract.auth.login.result.parse({onboarding:true,invitationToken:hash});
      c.contract.auth.logout.args.parse({token:hash});
      if (c.contract.identity.onboarding.complete.args.safeParse({invitationToken:hash,pins:['123456','123456'],handle:'test',name:'测试'}).success) throw new Error('Duplicate PIN validator failed');
      c.entities.setting.schema.parse(setting);
      c.entities.communityConversation.schema.parse(conversation);
      c.entities.communityMember.schema.parse(member);
      c.entities.communitySelf.schema.parse(member);
      c.entities.post.schema.parse(post);
      c.entities.chatState.schema.parse(chatState);
      c.entities.announcement.schema.parse(announcement);
      c.entities.announcementAck.schema.parse({id:'current',revision:1});
      c.contract.chat.post.send.args.parse({id:id,conversation:id,kind:'sticker',sticker:'pack:test'});
      c.contract.chat.post.send.args.parse({id:id,conversation:id,kind:'text',textId:id});
      c.contract.community.group.join.args.parse({group:id,source:{type:'group',group:id},password:'secret'});
      if (c.contract.chat.state.set.args.safeParse({conversation:id,key:'pin',value:{v:'wrong',t:{ms:1000,counter:0},op:id}}).success) throw new Error('Chat setting validator failed');
      c.entities.job.schema.parse({id:id,kind:'debug.sleep',owner:id,state:'queued',progress:0,message:'',result:null,error:null,attempts:0,created:1000,updated:1000});
      if (c.contract.auth.login.args.safeParse({pin:'bad'}).success) throw new Error('PIN validator failed');
      var calls = 0;
      var api = c.createApi(function (name,args,options) {
        calls++;
        if (name !== 'me.setting.set' || options.op !== id || args.key !== 'theme') throw new Error('Typed API forwarding failed');
        return Promise.resolve({data:{setting:setting},body:new Uint8Array(0)});
      });
      var reply = await api.me.setting.set({key:'theme',value:register},{op:id});
      if (reply.setting.value.v.theme !== 'dark' || calls !== 1) throw new Error('Typed API response failed');
      return {methods:c.methods.length,fixtures:Object.keys(values).length};
    })()`,
    context,
    { timeout: 5000 },
  );
  assert.equal(
    result.methods,
    result.fixtures,
    "All contract methods must have runtime fixtures",
  );
  process.stdout.write(
    `Contract compatibility: ES2018 syntax, Chrome 70 API scan, and ${result.methods}-method restricted-runtime probe passed.\n`,
  );
} finally {
  await rm(directory, { recursive: true, force: true });
}
