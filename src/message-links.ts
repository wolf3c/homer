import { fromMarkdown } from 'mdast-util-from-markdown';
export type MessageSource = { id: string; url: string; title: string; kind: 'reply-link' };
type Node = { type: string; url?: string; identifier?: string; value?: string; children?: Node[] };
export function messageLinks(markdown: string): MessageSource[] {
  const root = fromMarkdown(markdown) as Node;
  const definitions = new Map<string, string>(), links: MessageSource[] = [], seen = new Set<string>();
  const walk = (node: Node, visit: (n: Node) => void) => { visit(node); node.children?.forEach(child => walk(child, visit)); };
  walk(root, n => { if (n.type === 'definition' && n.identifier && n.url) definitions.set(n.identifier, n.url); });
  const text = (node: Node): string => node.value ?? node.children?.map(text).join('') ?? '';
  walk(root, n => {
    if (!['link', 'linkReference'].includes(n.type)) return;
    const raw = n.url ?? definitions.get(n.identifier ?? '');
    if (!raw) return;
    let url = raw, fallback = raw;
    try { const target = new URL(raw); url = target.href; fallback = target.hostname || raw; } catch { /* Preserve page-relative destinations. */ }
    if (seen.has(url)) return;
    seen.add(url);
    links.push({ id: `link-${links.length + 1}`, url, title: text(n).trim() || fallback, kind: 'reply-link' });
  });
  return links;
}
