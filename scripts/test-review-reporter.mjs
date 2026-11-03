// Synthetic checks only. Omit assertion bodies, object dumps, tool arguments,
// prompts, source excerpts and HTTP/provider diagnostics.
export default async function* reporter(events){
 for await(const event of events){
  if(event.type==='test:fail'){
   const d=event.data,e=d.details?.error?.cause??d.details?.error;
   const primitive=value=>typeof value==='boolean'||typeof value==='number'?value:typeof value==='string'&&/^[a-z_ -]{1,60}$/.test(value)?value:undefined;
   yield JSON.stringify({test:d.name,code:e?.code,message:/^[a-z0-9_:-]{1,150}$/.test(e?.message??'')?e.message:'assertion_or_structured_error',actual:primitive(e?.actual),expected:primitive(e?.expected),location:e?.stack?.split('\n').filter(line=>line.includes('.test.')).at(-1)?.trim()})+'\n';
  }
  if(event.type==='test:summary')yield JSON.stringify({summary:event.data})+'\n';
 }
}
