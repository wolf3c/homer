import {createHash} from 'node:crypto';
import {existsSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {resolve} from 'node:path';
import {isUtf8} from 'node:buffer';
import {mediaProcess} from './media-decode.js';
export type DocumentText={text:string;coverage:string;limitations:string[];transform:string;sourceHash:string};
export const documentPython=resolve('.codex/private/media-tools/bin/python3');
export async function extractDocument(bytes:Buffer,filename:string,signal?:AbortSignal):Promise<DocumentText>{
 if(bytes.length>50*1024*1024)throw Error('document_size_limit');
 const sourceHash=createHash('sha256').update(bytes).digest('hex');
 // Text needs no optional runtime. Legacy binary formats are never guessed from extensions.
 if(/\.(txt|md|csv|json|log)$/i.test(filename)&&!bytes.includes(0)&&isUtf8(bytes)){
  const text=bytes.toString('utf8').replace(/^\uFEFF/,'');if(/[\x00-\x08\x0b\x0c\x0e-\x1f]/.test(text))throw Error('document_unsupported');
  return {text:text.slice(0,64000),coverage:'全文文本，最多64000字符',limitations:text.length>64000?['超过64000字符，仅覆盖截取部分']:[],transform:'utf8-text-v1',sourceHash};
 }
 if(!existsSync(documentPython))throw Error('document_reader_unavailable');
 const raw=await mediaProcess(documentPython,[fileURLToPath(new URL('./media-documents.py',import.meta.url)),filename.replace(/[\/\\\x00-\x1f]/g,'_').slice(0,120)],bytes,512*1024,signal,20000);
 const value=JSON.parse(raw.toString());if(value.error)throw Error(value.error);
 if(typeof value.text!=='string'||typeof value.coverage!=='string'||!Array.isArray(value.limitations))throw Error('document_parse_failed');
 return {...value,sourceHash};
}
