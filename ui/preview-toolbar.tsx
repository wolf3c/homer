import type{ReactNode}from'react';
import './preview-toolbar.css';
/** Shared Preview strip: identity, scene controls, then primary actions. Tabs stay separate. */
export function PreviewToolbar({title,detail,leading,identityStart,identityEnd,children}:{title:string;detail?:string;leading?:ReactNode;identityStart?:ReactNode;identityEnd?:ReactNode;children?:ReactNode}){
 const identity=<div className="preview-toolbar-identity" title={[title,detail].filter(Boolean).join(' · ')}><span>{title}</span>{detail&&<small>{detail}</small>}</div>;
 return <div className="preview-toolbar" role="group" aria-label="预览状态与操作">{leading&&<div className="preview-toolbar-navigation">{leading}</div>}{identityStart||identityEnd?<div className="preview-toolbar-site">{identityStart}{identity}{identityEnd}</div>:identity}<div className="preview-toolbar-actions">{children}</div></div>;
}
