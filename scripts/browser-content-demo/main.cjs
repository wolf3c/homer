const {app,BrowserWindow,WebContentsView,ipcMain}=require('electron');
const {readFileSync}=require('node:fs');
const {join}=require('node:path');
app.setPath('userData',process.env.DEMO_PROFILE);
const base=process.env.DEMO_ORIGIN,build=process.env.DEMO_BUILD;
let host;const pages=new Map();let selected='a';
const runtime=readFileSync(join(build,'content.js'),'utf8');
const css=readFileSync(join(build,'content.css'),'utf8');
const snapshot=p=>({id:p.id,task:p.task,version:p.version,url:p.view.webContents.getURL(),title:p.view.webContents.getTitle(),owner:p.owner,source:p.source});
const state=()=>[...pages.values()].map(snapshot);
function publish(){if(host&&!host.isDestroyed())host.webContents.send('state',state());}
function show(id){selected=id;for(const p of pages.values()){p.view.setVisible(p.id===id);if(p.id===id)p.view.setBounds({x:310,y:0,width:890,height:800});}publish();}
async function mount(p){
 if(p.closed)return;
 p.source={kind:'web',messageId:'demo-message-'+p.version,sourceId:'demo-link-'+p.version,url:p.view.webContents.getURL(),title:p.view.webContents.getTitle()};
 // Demo-only synthetic source record. This is not Homer service validation.
 p.record=structuredClone(p.source);
 await p.view.webContents.executeJavaScriptInIsolatedWorld(999,[{code:`globalThis.demoCss=${JSON.stringify(css)};\n${runtime}`}]);
 publish();
}
app.whenReady().then(async()=>{
 host=new BrowserWindow({width:1200,height:800,useContentSize:true,title:'Homer · 网页内容技术 Demo',webPreferences:{preload:join(__dirname,'host-preload.cjs'),sandbox:true,contextIsolation:true,nodeIntegration:false}});
 await host.loadURL(base+'/host');
 for(const [id,task]of [['a','task-a'],['b','task-b']]){
  const view=new WebContentsView({webPreferences:{preload:join(__dirname,'content-preload.cjs'),sandbox:true,contextIsolation:true,nodeIntegration:false,partition:'persist:demo-pages',backgroundThrottling:false}});
  const p={id,task,view,version:0,owner:'agent',closed:false,tail:Promise.resolve()};pages.set(id,p);host.contentView.addChildView(view);
  view.webContents.on('did-start-navigation',d=>{if(d.isMainFrame&&!d.isSameDocument)p.version++;});
  view.webContents.on('did-finish-load',()=>void mount(p).catch(e=>console.error('mount',e)));
  view.webContents.setWindowOpenHandler(()=>({action:'deny'}));
  await view.webContents.loadURL(base+'/page/'+id);
 }
 show('a');host.on('closed',()=>{for(const p of pages.values())if(!p.view.webContents.isDestroyed())p.view.webContents.close();app.quit();});
});
function lookup(id){const p=pages.get(id);if(!p||p.closed||p.view.webContents.isDestroyed())throw Error('page_unavailable');return p;}
async function content(id,code){return lookup(id).view.webContents.executeJavaScriptInIsolatedWorld(999,[{code}]);}
const userAction=async(action,id)=>{
 const p=lookup(id);show(id);
 if(action==='takeover'){p.owner='user';await p.tail;}
 else if(action==='resume')p.owner='agent';
 else if(action==='annotate'){p.owner='user';await p.tail;await content(id,'globalThis.annotationDemo.mode(true)');}
 else if(action==='browse')await content(id,'globalThis.annotationDemo.mode(false)');
 publish();return snapshot(p);
};
ipcMain.handle('host-action',async(event,action,id)=>{
 if(event.sender!==host.webContents||event.senderFrame!==host.webContents.mainFrame)throw Error('wrong_sender');
 if(!['show','takeover','resume','annotate','browse'].includes(action))throw Error('invalid_action');
 return userAction(action,id);
});
ipcMain.handle('annotation-save',async(event,input)=>{
 const p=[...pages.values()].find(p=>p.view.webContents===event.sender);
 if(!p||p.closed||event.senderFrame!==p.view.webContents.mainFrame)throw Error('wrong_sender');
 if(p.owner!=='user'||input.version!==p.version)throw Error('document_changed');
 const candidate={...input,source:p.source};
 if(p.record.url!==candidate.source.url||p.record.title!==candidate.source.title)throw Error('source_mismatch');
 return host.webContents.executeJavaScript(`(()=>{try{return globalThis.demoCommit(${JSON.stringify(candidate)})}catch(e){return {error:e.message}}})()`);
});
ipcMain.handle('annotation-state',async event=>{
 const p=[...pages.values()].find(p=>p.view.webContents===event.sender);
 if(!p||event.senderFrame!==p.view.webContents.mainFrame)throw Error('wrong_sender');return {...snapshot(p),draft:await host.webContents.executeJavaScript('globalThis.demoReadDraft()')};
});
// Called only through Playwright's main-process inspector, not exposed to websites.
globalThis.demo={state,show,userAction,content,zoom(id,value){lookup(id).view.webContents.setZoomFactor(value);},begin(task,id,version){
 const p=lookup(id);
 const guard=()=>{if(p.task!==task)throw Error('wrong_task');if(p.owner!=='agent')throw Error('user_control');if(p.version!==version)throw Error('document_changed');if(p.closed)throw Error('page_unavailable');};
 guard();if(p.pending)throw Error('page_busy');p.pending=true;p.tail=new Promise(resolve=>{p.finish=resolve;});return snapshot(p);
},finish(id){const p=pages.get(id);if(p){p.pending=false;p.finish?.();}},async close(id){const p=lookup(id);p.closed=true;host.contentView.removeChildView(p.view);p.view.webContents.close();pages.delete(id);publish();},selected:()=>selected};
