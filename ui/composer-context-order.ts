type ContextKind='ref'|'quote'|'attachment';
export const contextKey=(kind:ContextKind,...parts:string[])=>JSON.stringify([kind,...parts]);
function kindOf(key:string):ContextKind|undefined{try{const value:unknown=JSON.parse(key);if(Array.isArray(value)&&['ref','quote','attachment'].includes(value[0])&&value.slice(1).every(v=>typeof v==='string'))return value[0] as ContextKind;}catch{}return undefined;}
/** Display order only. The server payload continues to use the original owners. */
export class ContextOrder{
 private keys:string[];
 constructor(saved:unknown=[]){this.keys=Array.isArray(saved)?[...new Set(saved.filter((v):v is string=>typeof v==='string'&&!!kindOf(v)))]:[];}
 reconcile(kind:ContextKind,current:readonly string[]){const existing=new Set(current);this.keys=this.keys.filter(key=>kindOf(key)!==kind||existing.has(key));const seen=new Set(this.keys);for(const key of current)if(kindOf(key)===kind&&!seen.has(key)){this.keys.push(key);seen.add(key);}}
 record(key:string){if(kindOf(key)&&!this.keys.includes(key))this.keys.push(key);}
 rename(before:string,after:string){const index=this.keys.indexOf(before);if(index<0||before===after)return;this.keys[index]=after;this.keys=this.keys.filter((key,i,all)=>all.indexOf(key)===i);}
 remove(key:string){this.keys=this.keys.filter(value=>value!==key);}
 snapshot(){return [...this.keys];}
}
