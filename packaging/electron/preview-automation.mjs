// The generated engine is copied from pinned playwright-core at build time.
// No browser-wide endpoint or raw debugger commands are exposed to callers.
import{readFileSync}from'node:fs';
const options={isUnderTest:false,sdkLanguage:'javascript',testIdAttributeName:'data-testid',stableRafCount:1,browserName:'chromium',isUtilityWorld:true,customEngines:[]};
export function previewAutomation(enginePath){
 const source=readFileSync(enginePath,'utf8');
 const install=`(()=>{const module={};${source};globalThis.homerPageEngine=new (module.exports.InjectedScript())(globalThis,${JSON.stringify(options)});})()`;
 async function evaluate(contents,code){
  const result=await contents.executeJavaScriptInIsolatedWorld(998,[{code:`(async()=>{try{return {value:await (${code})}}catch(error){return {error:String(error.message)}}})()`}]);
  if(result.error){if(result.error.includes('strict mode violation'))throw Error('preview_target_not_unique');throw Error(/^preview_[a-z_]+$/.test(result.error)?result.error:'preview_selector_invalid');}return result.value;
 }
 async function engine(contents){await evaluate(contents,`globalThis.homerPageEngine?true:(${install},true)`);}
 async function command(contents,method,params){
  const d=contents.debugger;if(!d.isAttached())d.attach('1.3');return d.sendCommand(method,params);
 }
 return {async read(contents,{offset=0,length=12000}={}){
  await engine(contents);
  return evaluate(contents,`(()=>{const text=globalThis.homerPageEngine.ariaSnapshot(document.body,{mode:'ai'});return {content:text.slice(${offset},${offset+length}),offset:${offset},total:text.length,truncated:text.length>${offset+length}}})()`);
 },async act(contents,{selector,action,value},guard){
  if(!['click','fill','select'].includes(action))throw Error('preview_action_denied');
  await engine(contents);guard();
  const result=await evaluate(contents,`(async()=>{const engine=globalThis.homerPageEngine,element=engine.querySelector(engine.parseSelector(${JSON.stringify(selector)}),document,true);if(!element)throw Error('preview_target_missing');
   const state=await engine.checkElementStates(element,${JSON.stringify(action==='fill'?['visible','enabled','editable']:['visible','enabled'])});if(state)throw Error('preview_target_not_ready');
   if(${JSON.stringify(action)}==='fill')return {fill:engine.fill(element,${JSON.stringify(value??'')})};
   if(${JSON.stringify(action)}==='select')return {selected:engine.selectOptions(element,[{value:${JSON.stringify(value??'')}}])};
   element.scrollIntoView({block:'center',inline:'center'});const r=element.getBoundingClientRect(),x=r.left+r.width/2,y=r.top+r.height/2;
   const hit=engine.expectHitTarget({x,y},element);if(hit!=='done')throw Error('preview_target_obscured');return {x,y};})()`);
  guard();
  if(action==='fill'){
   if(result.fill==='needsinput'){
    if(value)await command(contents,'Input.insertText',{text:value});
    else{await command(contents,'Input.dispatchKeyEvent',{type:'keyDown',key:'Backspace',code:'Backspace',windowsVirtualKeyCode:8});await command(contents,'Input.dispatchKeyEvent',{type:'keyUp',key:'Backspace',code:'Backspace',windowsVirtualKeyCode:8});}
   }else if(result.fill!=='done')throw Error('preview_target_not_ready');
  }else if(action==='click'){
   await command(contents,'Input.dispatchMouseEvent',{type:'mousePressed',x:result.x,y:result.y,button:'left',clickCount:1});
   await command(contents,'Input.dispatchMouseEvent',{type:'mouseReleased',x:result.x,y:result.y,button:'left',clickCount:1});
  }else if(action==='select'&&!Array.isArray(result.selected))throw Error('preview_option_missing');
  return {executed:true};
 }};
}
