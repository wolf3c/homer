import { createContext, forwardRef, useCallback, useContext, useEffect, useLayoutEffect, type RefObject } from 'react';
import { useAuiState } from '@assistant-ui/react';
import { LexicalComposerInput, type LexicalComposerInputProps } from '@assistant-ui/react-lexical';
import { useLexicalComposerContext } from '@lexical/react/LexicalComposerContext';
import { mergeRegister } from '@lexical/utils';
import { $addUpdateTag, $getSelection, COMMAND_PRIORITY_CRITICAL, DROP_COMMAND, KEY_DOWN_COMMAND, PASTE_COMMAND, SKIP_SCROLL_INTO_VIEW_TAG } from 'lexical';
import './homer-composer-input.css';

// The thread owns this callback; the mounted Lexical editor supplies focus.
export const ComposerInputFocusContext = createContext<RefObject<(() => void) | null> | null>(null);
export function useComposerInputFocus() {
  const focus = useContext(ComposerInputFocusContext);
  return useCallback(() => { focus?.current?.(); }, [focus]);
}

function HomerFocusPlugin() {
  const [editor] = useLexicalComposerContext();
  const focus = useContext(ComposerInputFocusContext);
  useLayoutEffect(() => {
    if (!focus) return;
    const focusEditor = () => {
      if (!editor.isEditable()) return;
      // Lexical restores its caret (or selects the end), focuses with
      // preventScroll, and skips its separate caret scroll for this update.
      editor.update(() => { $addUpdateTag(SKIP_SCROLL_INTO_VIEW_TAG); editor.focus(); }, { discrete: true });
    };
    focus.current = focusEditor;
    return () => { if (focus.current === focusEditor) focus.current = null; };
  }, [editor, focus]);
  return null;
}

export type HomerComposerInputProps = Omit<LexicalComposerInputProps,
  'children' | 'onKeyDown' | 'onPaste' | 'onDrop' | 'submitMode' | 'formatter' | 'directivePluginProps' | 'directiveChip'> & {
  disabled?: boolean;
  /** Native events run before Lexical. preventDefault() consumes the event. */
  onKeyDown?: (event: KeyboardEvent) => void;
  onPaste?: (event: ClipboardEvent) => void;
  onDrop?: (event: DragEvent) => void;
  /** Connect to files => void uploadFiles(files); caller owns upload errors/state. */
  onFiles?: (files: File[]) => void;
};

function HomerInputPlugin({ disabled = false, onKeyDown, onPaste, onDrop, onFiles }: HomerComposerInputProps) {
  const [editor] = useLexicalComposerContext();
  const runtimeDisabled = useAuiState(s => !!(s.thread.isDisabled || s.composer.dictation?.inputDisabled));
  const blocked = disabled || runtimeDisabled;
  useEffect(() => { editor.setEditable(!blocked); }, [editor, blocked]);
  useEffect(() => mergeRegister(
    editor.registerCommand(KEY_DOWN_COMMAND, event => {
      if (blocked) return true;
      // Never submit the Enter used to confirm a Chinese/Japanese composition.
      if (editor.isComposing() || event.isComposing || event.keyCode === 229) return false;
      onKeyDown?.(event);
      if (event.defaultPrevented) return true;
      if (event.key === 'Enter' && !event.shiftKey && !event.ctrlKey && !event.metaKey && !event.altKey) {
        const form = editor.getRootElement()?.closest('form');
        if (form) { event.preventDefault(); form.requestSubmit(); return true; }
      }
      return false;
    }, COMMAND_PRIORITY_CRITICAL),
    editor.registerCommand(PASTE_COMMAND, event => {
      if (blocked) { event?.preventDefault(); return true; }
      if (!(event instanceof ClipboardEvent)) return false;
      onPaste?.(event);
      if (event.defaultPrevented) return true;
      const files = Array.from(event.clipboardData?.files ?? []);
      if (files.length && onFiles) { event.preventDefault(); const text=event.clipboardData?.getData('text/plain');if(text)$getSelection()?.insertRawText(text);onFiles(files); return true; }
      return false;
    }, COMMAND_PRIORITY_CRITICAL),
    editor.registerCommand(DROP_COMMAND, event => {
      if (blocked) { event.preventDefault(); return true; }
      onDrop?.(event);
      if (event.defaultPrevented) return true;
      const files = Array.from(event.dataTransfer?.files ?? []);
      if (files.length && onFiles) { event.preventDefault(); onFiles(files); return true; }
      return false;
    }, COMMAND_PRIORITY_CRITICAL),
  ), [editor, blocked, onKeyDown, onPaste, onDrop, onFiles]);
  return null;
}

/** Requires the same assistant-ui runtime/ComposerPrimitive.Root as the old input.
 * Official SyncPlugin owns text <-> runtime synchronization, including setText
 * draft restoration and clearing after send. PlainTextExtension accepts text,
 * not rich HTML/embedded attachments; files travel through onFiles separately.
 * Events above are native Lexical events; refs point to the outer div, not a textarea.
 * Enter requests the containing form; Shift+Enter inserts a line break.
 */
export const HomerComposerInput = forwardRef<HTMLDivElement, HomerComposerInputProps>(
  function HomerComposerInput({ disabled = false, onKeyDown, onPaste, onDrop, onFiles, className, onDragOver, ...props }, ref) {
    return <LexicalComposerInput {...props} ref={ref} submitMode="none"
      className={['homer-composer-input', className].filter(Boolean).join(' ')}
      aria-disabled={disabled || undefined}
      onDragOver={event => {
        onDragOver?.(event);
        if (onFiles && Array.from(event.dataTransfer.types).includes('Files')) event.preventDefault();
      }}>
      <HomerFocusPlugin />
      <HomerInputPlugin disabled={disabled} onKeyDown={onKeyDown} onPaste={onPaste} onDrop={onDrop} onFiles={onFiles} />
    </LexicalComposerInput>;
  },
);
