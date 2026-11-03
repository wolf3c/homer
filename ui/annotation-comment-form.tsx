import {forwardRef,useId,useRef} from 'react';
import {Button} from '@base-ui/react/button';
import './annotation-comment-form.css';

type Props={
 title:string;
 excerpt?:string;
 value:string;
 onChange:(value:string)=>void;
 onSave:()=>void;
 onCancel:()=>void;
 onDelete?:()=>void;
 error?:string;
 busy?:boolean;
};

// Content only. The text and image owners retain positioning, drafts,
// validation and the transaction that commits or rolls back an annotation.
export const AnnotationCommentForm=forwardRef<HTMLTextAreaElement,Props>(function AnnotationCommentForm({title,excerpt,value,onChange,onSave,onCancel,onDelete,error,busy=false},ref){
 const id=useId(),composing=useRef(false);
 const tooLong=value.length>16000;
 const message=tooLong?'批注超过16000字符，请缩短后保存。':error;
 const canSave=!busy&&!tooLong&&!!value.trim();
 return <form className="annotation-comment-form" aria-label={title} aria-busy={busy}
  onCompositionStart={()=>{composing.current=true;}} onCompositionEnd={()=>{composing.current=false;}}
  onKeyDown={event=>{
   // Candidate confirmation/cancellation belongs to the IME. Do not let
   // the enclosing Popover/Dialog treat its Escape as a dismissal.
   if((composing.current||event.nativeEvent.isComposing||event.keyCode===229)&&(event.key==='Escape'||event.key==='Enter'))event.stopPropagation();
  }}
  onSubmit={event=>{event.preventDefault();if(canSave&&!composing.current)onSave();}}>
  <label id={id+'-label'} htmlFor={id} title={title}>{title}</label>
  {excerpt&&<blockquote id={id+'-excerpt'} tabIndex={0} aria-label="选中文字">{excerpt}</blockquote>}
  <textarea ref={ref} id={id} rows={2} placeholder="希望这里怎么改？" disabled={busy} value={value}
   title="Enter保存，Shift+Enter换行" aria-description="Enter保存，Shift+Enter换行"
   aria-invalid={!!message} aria-describedby={[excerpt?id+'-excerpt':'',message?id+'-error':''].filter(Boolean).join(' ')||undefined}
   onKeyDown={event=>{
    if(composing.current||event.nativeEvent.isComposing||event.keyCode===229)return;
    if(event.key==='Enter'&&!event.shiftKey){
     event.preventDefault();event.stopPropagation();
     if(canSave)event.currentTarget.form?.requestSubmit();
    }
   }}
   onChange={event=>onChange(event.target.value)}/>
  {message&&<p id={id+'-error'} role="alert">{message}</p>}
  <div className="annotation-comment-actions">
   {onDelete&&<Button type="button" className="delete-note quiet" aria-label="删除此批注" disabled={busy} onClick={()=>{if(!composing.current)onDelete();}}>删除</Button>}
   <Button type="button" className="quiet" disabled={busy} onClick={()=>{if(!composing.current)onCancel();}}>取消</Button>
   <Button type="submit" className="primary" disabled={!canSave}>保存</Button>
  </div>
 </form>;
});
