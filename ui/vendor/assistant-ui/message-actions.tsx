// assistant-ui 1f41f91643fdb56e5d8dbd14db65f742740738a1, MIT.
// Two-action adaptation; see README.md for the source and deliberate changes.
"use client";

import type {ComponentProps} from 'react';
import {CheckIcon,CopyIcon,MessageCirclePlus} from 'lucide-react';
import './message-actions.css';

export interface MessageActionsProps extends ComponentProps<'div'>{
 copied:boolean;
 copying:boolean;
 onCopy:()=>void;
 onQuote?:()=>void;
 quoteDisabled?:boolean;
}
export function MessageActions({copied,copying,onCopy,onQuote,quoteDisabled,className,children,...props}:MessageActionsProps){
 return <div data-slot="message-actions" className={['aui-message-actions',className].filter(Boolean).join(' ')} {...props}>
  <button type="button" aria-label="复制" title={copied?'已复制':'复制'} aria-busy={copying} disabled={copying} onClick={onCopy}
   className={'aui-message-action aui-message-copy'+(copied?' is-copied':'')}>
   <CopyIcon aria-hidden="true" className={'aui-message-action-icon '+(copied?'is-out':'is-in')}/>
   <CheckIcon aria-hidden="true" className={'aui-message-action-icon '+(copied?'is-in':'is-out')}/>
  </button>
  {onQuote&&<button type="button" aria-label="引用" title="引用" disabled={quoteDisabled} onClick={onQuote} className="aui-message-action">
   <MessageCirclePlus aria-hidden="true"/>
  </button>}
  {children}
 </div>;
}
