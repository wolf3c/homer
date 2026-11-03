import { useEffect, useId, useRef, useState } from "react";
import { render } from "pele";

// Application-owned options: diagram authors never supply options or icon SVG.
export const diagramLimits = { limit: 20_000, outputLimit: 1_000_000, maxEdges: 300 } as const;

export function MermaidDiagram({ code }: { code: string }) {
  const container = useRef<HTMLDivElement>(null);
  const id = useId();
  const [result, setResult] = useState<{ source: string; svg?: string; error?: string }>();
  useEffect(() => {
    const element = container.current;
    if (!element) return;
    let disposed = false, frame = 0, lastWidth = -1;
    const draw = () => {
      if (disposed) return;
      lastWidth = Math.floor(element.getBoundingClientRect().width);
      try {
        const { svg } = render(code, {
          ...diagramLimits, images: false, links: false,
          idPrefix: `homer-mermaid-${id.replace(/[^a-zA-Z0-9_-]/g, "")}`,
          maxWidth: Math.max(1, lastWidth), responsive: true,
          fontFamily: getComputedStyle(element).fontFamily,
        });
        setResult({ source: code, svg });
      } catch (error) {
        setResult({ source: code, error: error instanceof Error ? error.message.slice(0, 500) : "图表暂时无法渲染" });
      }
    };
    draw();
    const observer = new ResizeObserver(() => {
      if (Math.floor(element.getBoundingClientRect().width) === lastWidth) return;
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(draw);
    });
    observer.observe(element);
    // Also remeasure if the system font was not ready on the initial render.
    void document.fonts?.ready.then(() => { if (!disposed) draw(); });
    return () => { disposed = true; observer.disconnect(); cancelAnimationFrame(frame); };
  }, [code, id]);
  const current = result?.source === code ? result : undefined;
  return <div className="mermaid-diagram" ref={container}>
    {current?.svg ? <div className="mermaid-output" dangerouslySetInnerHTML={{ __html: current.svg }} /> : <>
      <p className="mermaid-status" role="status">{current?.error ? `图表未完成或无法渲染：${current.error}` : "图表生成中…"}</p>
      <pre className="code-block"><code>{code}</code></pre>
    </>}
  </div>;
}
