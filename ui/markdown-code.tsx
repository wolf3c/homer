import type { SyntaxHighlighterProps } from "@assistant-ui/react-markdown";
import hljs from "highlight.js/lib/common";
import { lazy, Suspense } from 'react';
const MermaidDiagram = lazy(() => import('./mermaid-diagram').then(module => ({ default: module.MermaidDiagram })));

export function Highlight({ language, code }: Pick<SyntaxHighlighterProps, 'language' | 'code'>) {
  if (language?.toLowerCase() === "mermaid") return <Suspense fallback={<pre className="code-block"><code>{code}</code></pre>}><MermaidDiagram code={code} /></Suspense>;
  const html = language && hljs.getLanguage(language) ? hljs.highlight(code, { language, ignoreIllegals: true }).value : hljs.highlightAuto(code).value;
  return <pre className="code-block"><code dangerouslySetInnerHTML={{ __html: html }} /></pre>;
}
