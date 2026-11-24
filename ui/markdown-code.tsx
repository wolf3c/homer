import type { SyntaxHighlighterProps } from "@assistant-ui/react-markdown";
import hljs from "highlight.js/lib/common";
import { lazy, Suspense, useMemo, type ReactNode } from 'react';
const MermaidDiagram = lazy(() => import('./mermaid-diagram').then(module => ({ default: module.MermaidDiagram })));

export function Highlight({ language, code }: Pick<SyntaxHighlighterProps, 'language' | 'code'>) {
  if (language?.toLowerCase() === "mermaid") return <Suspense fallback={<pre className="code-block"><code>{code}</code></pre>}><MermaidDiagram code={code} /></Suspense>;
  const html = language && hljs.getLanguage(language) ? hljs.highlight(code, { language, ignoreIllegals: true }).value : hljs.highlightAuto(code).value;
  return <pre className="code-block"><code dangerouslySetInnerHTML={{ __html: html }} /></pre>;
}

const sourceLanguages = new Map(Object.entries({
  ts: 'typescript', tsx: 'typescript', mts: 'typescript', cts: 'typescript',
  js: 'javascript', jsx: 'javascript', mjs: 'javascript', cjs: 'javascript',
  json: 'json', css: 'css', py: 'python', sh: 'bash', bash: 'bash',
  html: 'xml', htm: 'xml', xml: 'xml',
}));

function sourceMarkup(name: string, code: string, size: number) {
  const language = sourceLanguages.get(/\.([^.]+)$/.exec(name.toLowerCase())?.[1] ?? '');
  if (!language || !hljs.getLanguage(language) || size > 32 * 1024 || /[\0\uFFFD]/.test(code)) return;
  const lines = code.split(/\r\n?|\n/);
  if (lines.length > 1000 || lines.some(line => line.length > 2048)) return;

  try {
    const html = hljs.highlight(code, { language, ignoreIllegals: true }).value;
    if (html.length > 96 * 1024) return;
    const template = document.createElement('template');
    // HTML parsing normalizes literal CR, including the CR in CRLF.
    template.innerHTML = html.replace(/\r/g, '&#13;');
    const content = template.content;
    if (content.textContent === code && !content.querySelector(':not(span)')) return content;
  } catch {
    // The existing plain reader also handles languages that fail to tokenize.
  }
}

type SourceRange = { from: number; to: number };

function renderSourceMarkup(content: DocumentFragment, code: string, range?: SourceRange) {
  const cuts = [range?.from ?? code.length, range?.to ?? code.length, code.length];
  let offset = 0;
  function render(parent: ParentNode): ReactNode[][] {
    const parts: ReactNode[][] = [[], [], []];
    parent.childNodes.forEach((node, key) => {
      if (node instanceof Text) {
        const end = offset + node.length;
        cuts.forEach((cut, index) => {
          const from = Math.max(offset, cuts[index - 1] ?? 0);
          const to = Math.min(end, cut);
          if (from < to) parts[index]!.push(code.slice(from, to));
        });
        offset = end;
      } else if (node instanceof Element) {
        render(node).forEach((children, index) => {
          if (children.length) parts[index]!.push(<span key={key} className={node.className}>{children}</span>);
        });
      }
    });
    return parts;
  }
  return render(content);
}

export function SourceCodePreview({ name, code, size, range }: {
  name: string; code: string; size: number; range?: SourceRange;
}) {
  const markup = useMemo(() => sourceMarkup(name, code, size), [name, code, size]);
  const parts = useMemo(() => markup && renderSourceMarkup(markup, code, range), [markup, code, range]);
  return <pre data-preview-text className={parts ? 'preview-syntax' : undefined}>
    {range ? <>
      {parts?.[0] ?? code.slice(0, range.from)}
      <mark data-preview-source-target="">{parts?.[1] ?? code.slice(range.from, range.to)}</mark>
      {parts?.[2] ?? code.slice(range.to)}
    </> : parts?.[0] ?? code}
  </pre>;
}
