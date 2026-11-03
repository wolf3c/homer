// Requirement-derived synthetic input checks in the real text/image owners.
import assert from 'node:assert/strict';

export async function annotationCommentInput(page, selector) {
 const ev=expression=>page.evaluate(expression);
 const fill=async value=>{
  await ev(`(()=>{const t=document.querySelector(${JSON.stringify(selector+' textarea')});t.focus();t.select();})()`);
  await page.command('Input.insertText',{text:value});
 };
 await fill('长'.repeat(16001));
 assert.equal(await ev(`document.querySelector(${JSON.stringify(selector+' textarea')}).value.length`),16001,'oversized paste is retained without truncation');
 assert.equal(await ev(`document.querySelector(${JSON.stringify(selector+' button[type=submit]')}).disabled`),true);
 assert.ok(await ev(`document.querySelector(${JSON.stringify(selector+' [role=alert]')})?.textContent.includes('16000')`));
 assert.equal(await ev(`document.querySelector(${JSON.stringify(selector+' textarea')}).getAttribute('aria-invalid')`),'true');
 await fill('边'.repeat(16000));
 assert.equal(await ev(`document.querySelector(${JSON.stringify(selector+' textarea')}).value.length`),16000);
 assert.equal(await ev(`document.querySelector(${JSON.stringify(selector+' button[type=submit]')}).disabled`),false);
 await fill(' \n ');
 assert.equal(await ev(`document.querySelector(${JSON.stringify(selector+' button[type=submit]')}).disabled`),true);
 await fill('组合候选');
 await ev(`(()=>{const t=document.querySelector(${JSON.stringify(selector+' textarea')});t.dispatchEvent(new CompositionEvent('compositionstart',{bubbles:true,data:'候选'}));t.form.requestSubmit();})()`);
 assert.ok(await ev(`!!document.querySelector(${JSON.stringify(selector+' textarea')})`),'composition cannot submit a note');
 await ev(`(()=>{const t=document.querySelector(${JSON.stringify(selector+' textarea')});for(const key of ['Enter','Escape'])t.dispatchEvent(new KeyboardEvent('keydown',{key,code:key,bubbles:true,isComposing:true}));})()`);
 assert.ok(await ev(`!!document.querySelector(${JSON.stringify(selector+' textarea')})`),'candidate Enter/Escape cannot close the note');
 await ev(`document.querySelector(${JSON.stringify(selector+' textarea')}).dispatchEvent(new CompositionEvent('compositionend',{bubbles:true,data:'候选'}))`);
 await fill('');
 const contrast=await ev(`(()=>{
  const form=document.querySelector(${JSON.stringify(selector)}).closest('form')??document.querySelector(${JSON.stringify(selector)}).querySelector('form'),t=form.querySelector('textarea'),canvas=document.createElement('canvas'),ctx=canvas.getContext('2d');canvas.width=canvas.height=1;
  const rgba=color=>{ctx.clearRect(0,0,1,1);ctx.fillStyle=color;ctx.fillRect(0,0,1,1);return [...ctx.getImageData(0,0,1,1).data].map(x=>x/255);};
  const over=(fg,bg)=>fg.slice(0,3).map((v,i)=>v*fg[3]+bg[i]*(1-fg[3]));
  const lum=rgb=>rgb.slice(0,3).map(x=>x<=.04045?x/12.92:((x+.055)/1.055)**2.4).reduce((v,x,i)=>v+x*[.2126,.7152,.0722][i],0);
  const ratio=(fg,bg)=>{const a=lum(over(rgba(fg),bg)),b=lum(bg);return (Math.max(a,b)+.05)/(Math.min(a,b)+.05);};
  const bg=rgba(getComputedStyle(form).backgroundColor),inputBg=over(rgba(getComputedStyle(t).backgroundColor),bg),quiet=form.querySelector('.quiet'),save=form.querySelector('.primary');
  return {title:ratio(getComputedStyle(form.querySelector('label')).color,bg),placeholder:ratio(getComputedStyle(t,'::placeholder').color,inputBg),cancel:ratio(getComputedStyle(quiet).color,bg),primary:ratio(getComputedStyle(save).color,rgba(getComputedStyle(save).backgroundColor)),focus:ratio(getComputedStyle(t).outlineColor,inputBg)};
 })()`);
 for(const [part,ratio] of Object.entries(contrast))assert.ok(ratio>=(part==='focus'?3:4.5),part+' contrast '+ratio);
}
