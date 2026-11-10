import {execFile,spawn} from 'node:child_process';
import {createHash} from 'node:crypto';
import {once} from 'node:events';
import {existsSync,mkdirSync,mkdtempSync,readFileSync,realpathSync,symlinkSync,writeFileSync} from 'node:fs';
import {isAbsolute,join} from 'node:path';
import {setTimeout as delay} from 'node:timers/promises';
import {pathToFileURL} from 'node:url';
import {promisify} from 'node:util';
import {verifiedDesktopResources,type DesktopResourceIdentity} from './desktop-resources.js';
import type {Tool} from './engine.js';
import {TOOL_IMAGE_BYTES} from './interaction-limits.js';
import {mediaProcess} from './media-decode.js';
import {imageDimensions,MEDIA_POLICY} from './media-policy.js';
import {CUA_SESSION_PREFIX,WINDOWS_CUA_HELPER,holdCuaWindowsJob,pinCuaChrome,reclaimCuaSession,runCuaWindows} from './cua-processes.js';
import {processIdentity} from './processes.js';
import {windowsCommandAsync} from '../scripts/windows-security.mjs';

const run=promisify(execFile);
const digest=(value:string|Buffer)=>createHash('sha256').update(value).digest('hex');
const title={type:'string',minLength:1,maxLength:300,description:'Exact title of an already visible Chrome window. Omit to use the current Chrome window.'};
const coordinate={type:'integer',minimum:0};
const token={type:'string',minLength:1,maxLength:300};
const saveAs={type:'string',minLength:5,maxLength:110,description:'PNG filename only, for example result.png. The tool chooses the task directory.'};
export const CUA_TOOLS:Tool[]=[
 {type:'function',name:'browser_open',description:'Navigate the active tab of an existing Chrome window to an HTTP(S) URL, preserving its login. Set isolated:true on the first call only when the user requests a fresh temporary profile. An isolated session stays on its initial origin. Read with browser_read.',inputSchema:{type:'object',properties:{url:{type:'string',minLength:1,maxLength:2048},window_title:title,isolated:{type:'boolean'}},required:['url'],additionalProperties:false}},
 {type:'function',name:'browser_read',description:'Read the bound Chrome tab as a viewport image with capture_id. Set save_as to write the original viewport PNG and get its file receipt.',inputSchema:{type:'object',properties:{window_title:title,save_as:saveAs},additionalProperties:false}},
 {type:'function',name:'browser_click',description:'Click x,y in the latest browser_read viewport image using its capture_id. Read again to verify the effect. A click with an unknown result must not be replayed.',inputSchema:{type:'object',properties:{capture_id:token,x:coordinate,y:coordinate},required:['capture_id','x','y'],additionalProperties:false}},
 {type:'function',name:'desktop_read',description:'Read accessible elements of one visible app window, with one user approval for the window. Supply the exact window title if the app has multiple windows. Set save_as to deliver the original window PNG and get its file receipt.',inputSchema:{type:'object',properties:{app:{...token,description:'Application name or bundle ID.'},window_title:{...token,description:'Exact title of the visible window.'},save_as:saveAs},required:['app'],additionalProperties:false}},
 {type:'function',name:'desktop_click',description:'Click an element from the latest desktop_read of the approved window. Read again to verify. Never replay a click with an unknown result.',inputSchema:{type:'object',properties:{element_token:token},required:['element_token'],additionalProperties:false}},
 {type:'function',name:'desktop_type',description:'Type into an element from the latest desktop_read of the approved window. Read again to verify. Never replay input with an unknown result.',inputSchema:{type:'object',properties:{element_token:token,text:{type:'string',minLength:1,maxLength:4000}},required:['element_token','text'],additionalProperties:false}},
];
export const isCuaTool=(name:unknown)=>CUA_TOOLS.some(tool=>tool.name===name);

type Frame={x:number;y:number;width:number;height:number};
type Geometry={window:Frame;viewport:Frame;page:string;origin?:string};
type Target={pid:number;window_id:number};
type Window=Target&{title:string;app_name:string;layer:number;is_on_screen:boolean;z_index:number};
type Snapshot=Target&{window_bounds:Frame;screenshot_frame_valid?:boolean;screenshot_width:number;screenshot_height:number;capture_id?:string};
type Image={dataBase64:string;mimeType:string};
type Reply={isError:boolean;errorCode?:string;text?:string;structuredJson?:string;images?:Image[]};
type Driver={callTool(name:string,args:string):Promise<Reply>;metadata():Promise<{pid:number;driverVersion:string}>;shutdown():Promise<void>;uniffiDestroy():void};
type Mode='chrome'|'desktop'|'isolated';
type Session={owner:string;mode?:Mode;dir?:string;job?:ReturnType<typeof holdCuaWindowsJob>;target?:Target;app?:string;title?:string;origin?:string;driver?:Driver;pid?:number;ready?:true;closing?:Promise<boolean>;pending?:Promise<unknown>;capture?:{id:string;rect:Frame;width:number;height:number;geometry:Geometry};tokens?:Set<string>};
type Args={window_title?:string;url?:string;isolated?:boolean;save_as?:string;capture_id?:string;x?:number;y?:number;app?:string;element_token?:string;text?:string};
const session='homer-cua';
const chromeExecutable='/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const windowsChrome='chrome.exe';
const nativeActions=['click','bring_to_front','hotkey','type_text','press_key'];
const driverTools={chrome:['get_window_state',...nativeActions],desktop:['get_window_state','click','type_text']};
const sameFrame=(a:Frame,b:Frame)=>!!b&&a.x===b.x&&a.y===b.y&&a.width===b.width&&a.height===b.height;
const samePage=(a:Geometry,b:Geometry)=>a.page===b.page&&sameFrame(a.window,b.window)&&sameFrame(a.viewport,b.viewport);
const sameTarget=(a:Target,b:Target)=>a.pid===b.pid&&a.window_id===b.window_id;
export function windowElements(elements:Record<string,unknown>[],windows=false){
 const roots=elements.filter(element=>element.depth===0&&(windows?['Window','Pane'].includes(String(element.role)):element.role==='AXWindow'));
 if(roots.length!==1)return [];
 const scoped=new Set<unknown>();
 return elements.filter(element=>{
  if(typeof element.element_index!=='number'||!(element===roots[0]||scoped.has(element.parent_index)))return false;
  scoped.add(element.element_index);return true;
 });
}
const pngBytes=(image:Image|undefined)=>{
 if(image?.mimeType!=='image/png'||image.dataBase64.length>Math.ceil(MEDIA_POLICY.imageBytes/3)*4)throw Error('cua_screenshot_unavailable');
 const bytes=Buffer.from(image.dataBase64,'base64'),size=imageDimensions(bytes,'image/png');
 if(!size||bytes.length>MEDIA_POLICY.imageBytes||size.width*size.height>MEDIA_POLICY.maxPixels)throw Error('cua_screenshot_unavailable');
 return {bytes,size};
};

export function viewportPixels(before:Geometry,after:Geometry,shot:Snapshot,width:number,height:number,windows=false):Frame{
 const {window,viewport}=before;
 if(!samePage(before,after)||!sameFrame(window,shot.window_bounds)||width!==shot.screenshot_width||height!==shot.screenshot_height||
   (windows?width!==window.width-2||height!==window.height-2:shot.screenshot_frame_valid!==true))
  throw Error('chrome_viewport_changed');
 if(windows){
  // 0.46.1 uses physical DWM bounds and trims one pixel on each side of its PrintWindow frame.
  const left=viewport.x-window.x,top=viewport.y-window.y,right=left+viewport.width,bottom=top+viewport.height;
  if(![left,top,right,bottom].every(Number.isSafeInteger)||left<0||top<0||right>window.width||bottom>window.height)throw Error('chrome_viewport_unavailable');
  const x=Math.max(0,left-1),y=Math.max(0,top-1),w=Math.min(width,right-1)-x,h=Math.min(height,bottom-1)-y;
  if(w<=0||h<=0)throw Error('chrome_viewport_unavailable');
  return {x,y,width:w,height:h};
 }
 const scale=width/window.width;
 const x=Math.round((viewport.x-window.x)*scale),y=Math.round((viewport.y-window.y)*scale);
 const right=Math.round((viewport.x+viewport.width-window.x)*scale),bottom=Math.round((viewport.y+viewport.height-window.y)*scale);
 if(![x,y,right,bottom].every(Number.isSafeInteger)||Math.abs(window.height*scale-height)>1||x<0||y<0||right>width||bottom>height||right<=x||bottom<=y)
  throw Error('chrome_viewport_unavailable');
 return {x,y,width:right-x,height:bottom-y};
}

function desktopChrome(identity:DesktopResourceIdentity|undefined){
 const windows=process.platform==='win32'&&process.arch==='x64';
 if(!identity||!windows&&(process.platform!=='darwin'||process.arch!=='arm64'))return;
 const helper=windows?WINDOWS_CUA_HELPER:'runtime/cua/chrome-viewport';
 if(!existsSync(join(identity.bundleRoot,windows?'resources':'Contents/Resources',helper)))return;
 const trusted=verifiedDesktopResources(identity);
 if(!trusted.files.some(file=>file.path.replaceAll('\\','/')===helper))return;
 return trusted;
}

async function deadline<T>(work:Promise<T>,ms:number){
 let timer:NodeJS.Timeout|undefined;
 try{return await Promise.race([work,new Promise<never>((_resolve,reject)=>{timer=setTimeout(()=>reject(Error('cua_driver_timeout')),ms);})]);}
 finally{clearTimeout(timer);}
}

export class DesktopCua {
 static create(identity:DesktopResourceIdentity|undefined,runtime:string){
  const trusted=desktopChrome(identity);
  if(trusted)return new DesktopCua(trusted,runtime);
 }
 private active?:Session;
 private sdk?:Promise<any>;
 private readonly directory:string;
 private readonly windowsHelper?:string;
 private constructor(private readonly trusted:NonNullable<ReturnType<typeof desktopChrome>>,private readonly runtime:string){
  this.directory=join(trusted.resources,'runtime/cua');
  if(process.platform==='win32')this.windowsHelper=join(trusted.resources,WINDOWS_CUA_HELPER);
 }
 private load(){
  return this.sdk??=(async()=>{
   for(const {path,sha256} of this.trusted.files.filter(file=>file.path.replaceAll('\\','/').startsWith('runtime/cua/'))){
    const file=join(this.trusted.resources,path);
    if(realpathSync(file)!==file||digest(readFileSync(file))!==sha256)throw Error('desktop_resource_changed');
   }
   return import(pathToFileURL(join(this.directory,'node_modules/@trycua/cua-driver/dist/index.js')).href);
  })();
 }
 private async call(driver:Driver,name:string,args:object,guard:()=>void){
  guard();
  let reply:Reply;
  const action=nativeActions.includes(name);
  try{reply=await deadline(driver.callTool(name,JSON.stringify(args)),12000);}
  catch(error){
   const current=this.active;
   if(current?.driver===driver&&error instanceof Error&&error.message==='cua_driver_timeout')void this.close(current.owner,false).catch(()=>{});
   throw Error(action?'cua_action_unconfirmed':error instanceof Error&&error.message==='cua_driver_timeout'?'cua_driver_timeout':'cua_driver_unavailable');
  }
  guard();
  if(reply.isError){
   const data=JSON.parse(reply.structuredJson??'{}');
   const code=reply.errorCode??data.code??(reply.text?.startsWith('AX action failed:')?'ax_action_failed':undefined);
   const detail=typeof code==='string'&&/^[a-z][a-z_0-9]{1,40}$/.test(code)?'_'+code:'';
   throw Error((action?'cua_action_unconfirmed':'cua_driver_refused')+detail);
  }
  const data=JSON.parse(reply.structuredJson??'{}');
  if(name==='get_window_state'&&typeof data.degraded_reason==='string'&&data.degraded_reason.startsWith('screen_locked:'))throw Error('cua_screen_locked');
  return {data,image:reply.images?.[0]};
 }
 private async resolveWindow(app:string,windowTitle:string|undefined,frontmost:boolean,guard:()=>void,pid?:number){
  const {CuaDriver}=await this.load();
  guard();
  const discover:Driver=CuaDriver.create({embedded:true});
  try{
   for(let attempt=0;attempt<(pid?30:1);attempt++){
    const {data}=await this.call(discover,'list_windows',{...(pid?{pid}:{app}),on_screen_only:true},guard);
    const matches=(data.windows as Window[])
     .filter(window=>window.layer===0&&window.is_on_screen&&(!pid||window.pid===pid)&&(!frontmost||window.title)&&
      (app!==windowsChrome||window.app_name.toLowerCase()===windowsChrome)&&(windowTitle===undefined||window.title===windowTitle))
     .sort((a,b)=>b.z_index-a.z_index);
    const chosen=matches[0];
    if(!chosen){if(pid)await delay(150);continue;}
    if(matches.length>1&&(pid||!frontmost||windowTitle!==undefined||!Number.isSafeInteger(chosen.z_index)||!Number.isSafeInteger(matches[1]!.z_index)||chosen.z_index===matches[1]!.z_index))
     throw Error(frontmost||pid?'chrome_window_ambiguous':'desktop_window_ambiguous');
    return chosen;
   }
   throw Error(frontmost||pid?'chrome_window_not_found':'desktop_window_not_found');
  }finally{try{await discover.shutdown();}finally{discover.uniffiDestroy();}}
 }
 private async sessionDir(current:Session,guard:()=>void){
  guard();
  const dir=current.dir??=mkdtempSync(join(realpathSync(this.runtime),CUA_SESSION_PREFIX));
  if(this.windowsHelper){
   current.job??=holdCuaWindowsJob(this.windowsHelper,dir);
   await current.job.ready;
   guard();
  }
  return dir;
 }
 private async start(current:Session,desktop:boolean,guard:()=>void){
  const {CuaDriver,SessionPermissionMode}=await this.load();
  guard();
  const bundleId=this.windowsHelper?'app.homer.desktop':(await run('/usr/bin/plutil',['-extract','CFBundleIdentifier','raw','-o','-',join(this.trusted.bundleRoot,'Contents/Info.plist')],{timeout:2000,maxBuffer:256})).stdout.trim();
  if(!/^[\w.-]{1,200}$/.test(bundleId))throw Error('desktop_resource_changed');
  const dir=await this.sessionDir(current,guard);
  const manifest=join(dir,'capabilities.json'),binary=this.windowsHelper??join(dir,'cua-driver');
  if(!this.windowsHelper)symlinkSync(join(this.directory,'cua-driver'),binary);
  writeFileSync(manifest,JSON.stringify({version:3,expires_after:'15m',idle_timeout:'5m',resources:{desktop:{windows:[current.target]}},
   allow:{tools:['check_permissions','start_session','end_session',...driverTools[desktop?'desktop':'chrome']]}}),{mode:0o600});
  const bounded=SessionPermissionMode.Bounded;
  const driver:Driver=current.driver=CuaDriver.createPrivateWorker({
   binaryPath:binary,hostBundleId:bundleId,startupTimeoutMs:3000n,shutdownTimeoutMs:3000n,inheritStderr:false,
   environment:[{name:'HOME',value:dir},...(this.windowsHelper?[{name:'CUA_DRIVER_RS_HOME',value:dir}]:[]),{name:'CUA_DRIVER_RS_TELEMETRY_ENABLED',value:'0'},{name:'CUA_DRIVER_RS_UPDATE_CHECK',value:'0'}],
   configuredDriver:{claudeCodeCompatibility:false,authorization:{allowedModes:[bounded],compatibilityMode:bounded,compatibilityCapabilityManifestPath:manifest,unrestrictedAcknowledged:false,maxSessionTtlSeconds:900n,maxIdleTtlSeconds:300n}},
  });
  const {pid,driverVersion}=await deadline(driver.metadata(),3000);
  if(!Number.isSafeInteger(pid)||pid<=1||driverVersion!=='0.46.1')throw Error('cua_driver_unavailable');
  current.pid=pid;
  const {data}=await this.call(driver,'check_permissions',{session,prompt:false},guard);
  if(this.windowsHelper?data.uia!==true:data.accessibility!==true||data.screen_recording!==true)
   throw Error(this.windowsHelper?'cua_windows_permissions_unavailable':'cua_macos_permissions_required');
  await this.call(driver,'start_session',{session},guard);
  current.ready=true;
 }
 private async launchGuest(current:Session,url:URL,guard:()=>void){
  if(this.windowsHelper){
   const chrome=await windowsCommandAsync(String.raw`
if ([Security.Principal.WindowsPrincipal]::new([Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) { 'elevated'; return }
foreach ($hive in 'HKEY_LOCAL_MACHINE','HKEY_CURRENT_USER') {
  foreach ($prefix in 'SOFTWARE','SOFTWARE\WOW6432Node') {
    $policy = Get-ItemProperty -LiteralPath "Registry::$hive\$prefix\Policies\Google\Chrome" -ErrorAction SilentlyContinue
    if ($null -ne $policy.UserDataDir -or $policy.BrowserGuestModeEnabled -eq 0) { 'managed'; return }
  }
}
$roots = Get-ItemProperty 'HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion'
$candidates = @(
  foreach ($key in 'HKCU:\SOFTWARE','HKLM:\SOFTWARE','HKLM:\SOFTWARE\WOW6432Node') {
    $entry = Get-Item -LiteralPath "$key\Microsoft\Windows\CurrentVersion\App Paths\chrome.exe" -ErrorAction SilentlyContinue
    if ($entry) { $entry.GetValue('') }
  }
  foreach ($root in $roots.ProgramFilesDir, $roots.'ProgramFilesDir (x86)', $env:LOCALAPPDATA) {
    if ($root) { Join-Path $root 'Google\Chrome\Application\chrome.exe' }
  }
)
foreach ($candidate in $candidates) {
  if ($candidate -notmatch '^[a-zA-Z]:\\' -or [IO.Path]::GetFileName($candidate) -ine 'chrome.exe') { continue }
  $file = Get-Item -LiteralPath $candidate -ErrorAction SilentlyContinue
  if (!$file -or $file.PSIsContainer) { continue }
  $s = Get-AuthenticodeSignature -LiteralPath $file.FullName
  if ($s.Status -eq 'Valid' -and $s.SignerCertificate.GetNameInfo('SimpleName',$false) -in @('Google LLC','Google Inc')) { $file.FullName; return }
}`,{LOCALAPPDATA:process.env.LOCALAPPDATA??''}).catch(()=> '');
   if(chrome==='managed')throw Error('chrome_isolation_managed');
   if(chrome==='elevated')throw Error('chrome_isolation_requires_standard_user');
   try{if(!isAbsolute(chrome)||realpathSync(chrome).toLowerCase()!==chrome.toLowerCase())throw Error();}
   catch{throw Error('chrome_installation_unverified');}
   await this.load();
   const dir=await this.sessionDir(current,guard);
   mkdirSync(join(dir,'profile'),{mode:0o700});
   const {stdout}=await runCuaWindows(this.windowsHelper,['guest',dir,chrome]).catch(()=>{throw Error('chrome_launch_failed');});
   const pid=Number(stdout.trim());
   if(!Number.isSafeInteger(pid)||pid<=1)throw Error('chrome_launch_failed');
   return this.resolveWindow(windowsChrome,undefined,false,guard,pid);
  }
  try{
   if(realpathSync(chromeExecutable)!==chromeExecutable)throw Error();
   await run('/usr/bin/codesign',['--verify','-R','=anchor apple generic and identifier "com.google.Chrome" and certificate leaf[subject.OU] = "EQHXZ8M8AV"',chromeExecutable],{timeout:3000});
  }catch{throw Error('chrome_installation_unverified');}
  guard();
  const dir=current.dir=mkdtempSync(join(realpathSync(this.runtime),CUA_SESSION_PREFIX));
  const profile=join(dir,'profile');mkdirSync(profile,{mode:0o700});
  // A guest window keeps site state in memory and avoids persistent cookie Keychain startup.
  const child=spawn(chromeExecutable,['--guest','--user-data-dir='+profile,'--no-first-run','--no-default-browser-check',url.href],
   {detached:true,stdio:'ignore',env:{HOME:dir,PATH:'/usr/bin:/bin:/usr/sbin:/sbin',LANG:process.env.LANG??'en_US.UTF-8'}});
  try{await once(child,'spawn');}catch{throw Error('chrome_launch_failed');}
  child.unref();
  pinCuaChrome(dir,child.pid!);
  return this.resolveWindow('com.google.Chrome',undefined,false,guard,child.pid);
 }
 private async geometry(current:Session,mode?:'address'|'window'|'frame'){
  const {pid,window_id}=current.target!;
  try{
   const ids=[String(pid),String(window_id)];
   const {stdout}=this.windowsHelper?await runCuaWindows(this.windowsHelper,[mode??'page',...ids,...(current.mode==='isolated'?[current.dir!]:[])]):
    await run(join(this.directory,'chrome-viewport'),[...ids,...(mode?[mode]:[])],{timeout:3000,maxBuffer:2048});
   return stdout.trim();
  }catch{throw Error(mode==='address'?'chrome_address_not_focused':mode==='window'?'chrome_window_not_found':
    mode==='frame'?'desktop_screenshot_unavailable':'chrome_viewport_unavailable');}
 }
 private async confirmAddress(current:Session,guard:()=>void,expected?:string){
  for(const pause of [0,150,350]){
   if(pause)await delay(pause);
   guard();
   const value=await this.geometry(current,'address').catch(()=>undefined);
   if(value&&(expected===undefined||value===expected))return;
  }
  throw Error(expected===undefined?'chrome_address_not_focused':'chrome_address_unconfirmed');
 }
 private async page(current:Session):Promise<Geometry>{
  const geometry:Geometry=JSON.parse(await this.geometry(current));
  if(current.origin&&(!geometry.origin||new URL(geometry.origin).origin!==current.origin))throw Error('cua_isolated_origin_denied');
  return geometry;
 }
 private async capture(current:Session,edge:number,guard:()=>void){
  const target=current.target!,driver=current.driver!;
  const before=await this.page(current).catch(async(error:Error)=>{
   if(error.message!=='chrome_viewport_unavailable')throw error;
   // A fresh Chromium page may have only its native chrome in the AX tree.
   await this.call(driver,'get_window_state',{session,...target,include_screenshot:false,max_elements:40},guard);
   return this.page(current);
  });
  const windows=!!this.windowsHelper;
  const {data,image}=await this.call(driver,'get_window_state',{session,...target,include_accessibility_tree:false,max_image_dimension:windows?0:edge},guard);
  const after=await this.page(current);
  guard();
  if(!sameTarget(target,data))throw Error('chrome_screenshot_unavailable');
  const {bytes:png,size}=pngBytes(image);
  const rect=viewportPixels(before,after,data,size.width,size.height,windows);
  const crop=['crop',...[rect.x,rect.y,rect.width,rect.height].map(String)];
  const decode=(size:number)=>mediaProcess(windows?process.execPath:this.trusted.imageDecoder,
   windows?[this.trusted.imageDecoder,...crop,String(size)]:crop,png,MEDIA_POLICY.imageBytes,undefined,8000);
  let cropped=await decode(edge);
  if(windows&&edge&&cropped.length>TOOL_IMAGE_BYTES){guard();cropped=await decode(600);}
  guard();
  const observed=imageDimensions(cropped,'image/png');
  if(!observed||(windows&&edge?
   observed.width>Math.min(edge,rect.width)||observed.height>Math.min(edge,rect.height):
   observed.width!==rect.width||observed.height!==rect.height))throw Error('chrome_screenshot_unavailable');
  return {bytes:cropped,rect,...observed,geometry:before,id:data.capture_id as string|undefined};
 }
 invoke(owner:string,name:string,args:Args,guard:()=>void,save:(filename:string,bytes:Buffer)=>unknown,approve:(app:string,title:string)=>Promise<void>){
  guard();
  if(this.active&&(this.active.owner!==owner||this.active.pending||this.active.closing))throw Error('cua_busy');
  const current=this.active??={owner};
  const check=()=>{guard();if(current.closing)throw Error('cua_stopped');};
  const pending=this.perform(current,name,args,check,save,approve);
  current.pending=pending;
  return pending.finally(()=>{current.pending=undefined;});
 }
 private async perform(current:Session,name:string,args:Args,guard:()=>void,save:(filename:string,bytes:Buffer)=>unknown,approve:(app:string,title:string)=>Promise<void>){
  let url:URL|undefined;
  if(name==='browser_open'){
   try{url=new URL(args.url!);}catch{throw Error('chrome_url_invalid');}
   if(!['http:','https:'].includes(url.protocol)||url.username||url.password)throw Error('chrome_url_invalid');
  }
  if(args.save_as&&!/^[\p{L}\p{N}_-][\p{L}\p{N}_.-]{0,105}\.png$/iu.test(args.save_as))throw Error('artifact_path_denied');
  const desktop=name.startsWith('desktop_');
  const mode=desktop?'desktop':(args.isolated??(current.mode==='isolated'))?'isolated':'chrome';
  if((mode==='isolated'&&args.window_title!==undefined)||current.mode&&(mode!==current.mode||
    (args.window_title!==undefined&&args.window_title!==current.title)||(desktop&&args.app!==undefined&&args.app!==current.app)))
   throw Error('cua_target_already_bound');
  if(!current.mode){
   if(name!=='desktop_read'&&name!=='browser_read'&&!url)throw Error('cua_snapshot_stale');
   const app=desktop?args.app!:this.windowsHelper?windowsChrome:'com.google.Chrome';
   let target:Window;
   if(mode==='isolated'){
    current.mode=mode;current.origin=url!.origin;
    target=await this.launchGuest(current,url!,guard);
    if(!this.windowsHelper)url=undefined; // macOS starts the isolated instance at the requested URL.
   }else target=await this.resolveWindow(app,args.window_title,!desktop,guard);
   if(desktop){
    const identity=processIdentity(target.pid);
    if(!identity)throw Error('desktop_window_not_found');
    current.mode=mode;
    await approve(target.app_name,target.title);
    guard();
    const approved=await this.resolveWindow(app,target.title||undefined,false,guard);
    if(!sameTarget(approved,target)||approved.title!==target.title||processIdentity(target.pid)!==identity)throw Error('desktop_window_changed');
   }
   current.target={pid:target.pid,window_id:target.window_id};current.title=target.title;current.app=app;
   current.mode=mode;
   await this.start(current,desktop,guard);
  }
  if(!current.ready)throw Error('cua_not_ready');
  if(desktop)return this.desktop(current,name,args,guard,save);
  const target=current.target!,driver=current.driver!;
  if(name==='browser_open'&&!url)return {state:'submitted'};
  if(url){
   if(current.origin&&url.origin!==current.origin)throw Error('cua_isolated_origin_denied');
   current.capture=undefined;
   const foreground={session,...target,delivery_mode:'foreground'};
   await this.geometry(current,'window');
   await this.call(driver,'get_window_state',{session,...target,include_screenshot:false,max_elements:40},guard);
   // Chrome loses its address-bar focus when the preceding app is restored between keys.
   const {data:activation}=await this.call(driver,'bring_to_front',{session,...target},guard);
   if((this.windowsHelper?activation.landed_on_target:activation.activated)!==true)throw Error('chrome_window_not_front');
   await this.call(driver,'hotkey',{...foreground,keys:[this.windowsHelper?'ctrl':'cmd','l']},guard);
   await this.confirmAddress(current,guard);
   await this.call(driver,'type_text',{...foreground,text:url.href},guard);
   await this.confirmAddress(current,guard,digest(url.href));
   await this.call(driver,'press_key',{...foreground,key:'Return'},guard);
   return {state:'submitted'};
  }
  if(name==='browser_click'){
   const capture=current.capture;
   const {x,y}=args;
   if(!capture||capture.id!==args.capture_id||x===undefined||y===undefined||!Number.isSafeInteger(x)||!Number.isSafeInteger(y)||x<0||y<0||x>=capture.width||y>=capture.height)
    throw Error('chrome_capture_stale');
   current.capture=undefined;
   if(!samePage(capture.geometry,await this.page(current)))throw Error('chrome_viewport_changed');
   await this.call(driver,'click',{session,...target,
    x:capture.rect.x+Math.floor((x+0.5)*capture.rect.width/capture.width),
    y:capture.rect.y+Math.floor((y+0.5)*capture.rect.height/capture.height),
    capture_id:capture.id,...(this.windowsHelper?{delivery_mode:'background'}:{})},guard);
   return {state:'submitted'};
  }
  current.capture=undefined;
  if(args.save_as){
   const image=await this.capture(current,0,guard);
   return save(args.save_as,image.bytes);
  }
  let image=await this.capture(current,1100,guard);
  if(!this.windowsHelper&&image.bytes.length>TOOL_IMAGE_BYTES)image=await this.capture(current,600,guard);
  if(!image.id||image.bytes.length>TOOL_IMAGE_BYTES)throw Error('chrome_screenshot_unavailable');
  const {id,rect,width,height,geometry}=image;
  current.capture={id,rect,width,height,geometry};
  return {mediaContent:[{type:'text',text:JSON.stringify({capture_id:id,width,height})},{type:'image',mimeType:'image/png',data:image.bytes.toString('base64')}]};
 }
 private async desktop(current:Session,name:string,args:Args,guard:()=>void,save:(filename:string,bytes:Buffer)=>unknown){
  const target={session,...current.target!},driver=current.driver!;
  const tokens=current.tokens;current.tokens=undefined;
  if(name!=='desktop_read'){
   if(!args.element_token||!tokens?.has(args.element_token))throw Error('cua_snapshot_stale');
   const type=name==='desktop_type';
   await this.call(driver,type?'type_text':'click',{...target,element_token:args.element_token,...(type?{text:args.text}:{})},guard);
   return {state:'submitted'};
  }
  const frame=this.windowsHelper&&args.save_as?await this.geometry(current,'frame'):undefined;
  const {data,image}=await this.call(driver,'get_window_state',{...target,tree_format:'elements',max_elements:100,
   include_screenshot:!!args.save_as,include_accessibility_tree:!args.save_as,max_image_dimension:0},guard);
  if(!sameTarget(target,data))throw Error('desktop_window_changed');
  if(args.save_as){
   const {bytes,size}=pngBytes(image);
   if(frame!==undefined){
    const raw:Frame=JSON.parse(frame);
    // The pinned driver can return a full GetWindowRect-sized desktop crop if window capture fails.
    if(size.width===raw.width&&size.height===raw.height||size.width!==data.screenshot_width||
      size.height!==data.screenshot_height||frame!==await this.geometry(current,'frame'))throw Error('desktop_screenshot_unavailable');
    guard();
   }
   return save(args.save_as,bytes);
  }
  const elements=windowElements(data.elements??[],!!this.windowsHelper);
  if(!elements.length)throw Error('desktop_window_unreadable');
  current.tokens=new Set(elements.flatMap(({element_token})=>typeof element_token==='string'?[element_token]:[]));
  return {elements};
 }
 async close(owner:string,release=true){
  const current=this.active;
  if(!current||current.owner!==owner)return true;
  const stopped=await (current.closing??=Promise.resolve().then(async()=>{
   const graceful=(async()=>{
    await current.pending?.catch(()=>{});
    if(!current.driver)return;
    const driver=current.driver;
    try{await driver.callTool('end_session',JSON.stringify({session}));}catch{}
    try{await driver.shutdown();}finally{driver.uniffiDestroy();}
   })();
   await deadline(graceful,4000).catch(()=>{});
   if(current.dir&&!await reclaimCuaSession(current.dir,current.pid,this.windowsHelper,current.job))return false;
   await deadline(graceful,2000).catch(()=>{});
   if(current.pid&&!this.windowsHelper){
    try{process.kill(current.pid,0);return false;}
    catch(error){if((error as NodeJS.ErrnoException).code!=='ESRCH')return false;}
   }
   return true;
  }));
  // A timed-out isolated call must not fall back to a personal tab in the same turn.
  if(stopped&&release&&this.active===current)this.active=undefined;
  return stopped;
 }
}
