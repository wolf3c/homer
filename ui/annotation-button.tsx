import{forwardRef,type ComponentPropsWithoutRef}from'react';
import{MessageCirclePlus}from'lucide-react';
import{TooltipIconButton}from'./vendor/assistant-ui/attachment-icon-button';
import './preview-toolbar.css';
export const AnnotationButton=forwardRef<HTMLButtonElement,ComponentPropsWithoutRef<typeof TooltipIconButton>&{active?:boolean}>(function AnnotationButton({active=false,children,className,...props},ref){
 return <TooltipIconButton side="top" {...props} ref={ref} aria-pressed={active} className={'preview-annotation-button '+(className??'')}><MessageCirclePlus size={16} aria-hidden/><span className="preview-annotation-label">批注</span>{children}</TooltipIconButton>;
});
