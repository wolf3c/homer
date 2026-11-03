import {useId} from 'react';
import {FileRoot,FileIconDisplay,FileName} from './vendor/assistant-ui/file';

/** A stable file identity and its full, human-readable filename. */
export type FileListItem = {id:string;title:string};
export type FileListProps<T extends FileListItem> = {
  files:readonly T[];
  label:string;
  onOpen:(file:T,trigger:HTMLButtonElement)=>void;
  selectedId?:string;
  controlsId?:string;
};

function fileAppearance(name:string):{label:string;mimeType:string}{
  const dot=name.lastIndexOf('.'),extension=dot>0?name.slice(dot+1).toLowerCase():'';
  if(extension==='html'||extension==='htm')return {label:'HTML 文件',mimeType:'text/html'};
  if(extension==='md'||extension==='markdown')return {label:'Markdown 文件',mimeType:'text/markdown'};
  if(['png','jpg','jpeg','gif','webp','svg','avif'].includes(extension))return {label:'图片文件',mimeType:'image/png'};
  if(extension==='pdf')return {label:'PDF 文件',mimeType:'application/pdf'};
  if(['mp3','wav','m4a','ogg','flac'].includes(extension))return {label:'音频文件',mimeType:'audio/mpeg'};
  if(['mp4','webm','mov','mkv'].includes(extension))return {label:'视频文件',mimeType:'video/mp4'};
  if(['js','jsx','ts','tsx','json','css','xml','py','sh'].includes(extension))return {label:'代码文件',mimeType:'text/plain'};
  return {label:'文件',mimeType:'application/octet-stream'};
}

/** Presentation only: callers own authorization, ordering, selection and preview. */
export function FileList<T extends FileListItem>({files,label,onOpen,selectedId,controlsId}:FileListProps<T>){
  const descriptionId=useId();
  if(!files.length)return null;
  return <ul data-slot="file-list" className="file-list m-0 flex min-w-0 max-w-full list-none flex-col gap-2 p-0" aria-label={label}>
    {files.map((file,index)=>{
      const appearance=fileAppearance(file.title),typeId=descriptionId+'-'+index;
      return <li key={file.id} className="min-w-0">
        <button type="button" className="file-list-open w-full border-0 bg-transparent p-0 text-start" aria-label={'预览 '+file.title} aria-describedby={typeId}
          aria-controls={controlsId} aria-expanded={controlsId?selectedId===file.id:undefined}
          aria-current={selectedId===file.id?'true':undefined} onClick={event=>onOpen(file,event.currentTarget)}>
          <FileRoot className="w-full min-w-0">
            <FileIconDisplay mimeType={appearance.mimeType}/>
            <FileName title={file.title}>{file.title}</FileName>
          </FileRoot>
          <span id={typeId} className="sr-only">{appearance.label}</span>
        </button>
      </li>;
    })}
  </ul>;
}
