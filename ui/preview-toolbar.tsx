import type{ReactNode}from'react';
import './preview-toolbar.css';
/** Shared Preview strip: identity, scene controls, then primary actions. Tabs stay separate. */
export function PreviewToolbar({title,detail,leading,children}:{title:string;detail?:string;leading?:ReactNode;children?:ReactNode}){
 return <div className="preview-toolbar" role="group" aria-label="预览状态与操作">{leading&&<div className="preview-toolbar-navigation">{leading}</div>}<div className="preview-toolbar-identity" title={[title,detail].filter(Boolean).join(' · ')}><span>{title}</span>{detail&&<small>{detail}</small>}</div><div className="preview-toolbar-actions">{children}</div></div>;
}
