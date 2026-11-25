import {XIcon} from 'lucide-react';
import type {ComponentPropsWithoutRef,HTMLAttributes,ReactNode} from 'react';

type Action=Pick<ComponentPropsWithoutRef<'button'>,'onClick'|'disabled'|'title'|'aria-haspopup'|'aria-label'> & {
 'aria-label':string;
};
type Summary={icon:ReactNode;title:string;subtitle:string;status?:ReactNode;open?:Action;remove?:Action};

type ReferenceCardProps=HTMLAttributes<HTMLElement> & {
 as?:'div'|'section'|'figure'|'a'|'li';
 href?:string;
 compact?:boolean;
 summary?:Summary;
};

export function ReferenceCard({as:Root='div',className,compact,summary,children,...props}:ReferenceCardProps){
 const classes=['reference-card',compact||summary?'reference-card-compact':null,summary?'annotation-chip':null,className].filter(Boolean).join(' ');
 if(!summary)return <Root {...props} className={classes} data-slot="reference-card">{children}</Root>;

 const {icon,title,subtitle,status,open,remove}=summary;
 const label=<>{icon}<span className="compact-context-copy"><span className="compact-context-label">{title}</span><span className="compact-context-source">{subtitle}</span></span>{status&&<span className="annotation-chip-state">{status}</span>}</>;
 return <Root {...props} className={classes} data-slot="reference-card">
  {open?<button type="button" className="annotation-chip-open" title={title} {...open}>{label}</button>
   :<div className="annotation-chip-open task-reference-chip" title={title}>{label}</div>}
  {remove&&<button type="button" className="annotation-chip-remove" {...remove}><XIcon size={14} aria-hidden/></button>}
 </Root>;
}
