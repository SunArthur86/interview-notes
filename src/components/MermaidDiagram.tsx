'use client';

import { useEffect, useRef, useState } from 'react';

let mermaidLoaded = false;
let loadPromise: Promise<any> | null = null;

async function loadMermaid() {
  if (mermaidLoaded) return loadPromise!;
  loadPromise = import('mermaid').then((mod) => {
    const mermaid = mod.default;
    mermaid.initialize({
      startOnLoad: false,
      theme: document.documentElement.getAttribute('data-theme') === 'dark' ? 'dark' : 'default',
      securityLevel: 'loose',
      fontFamily: 'inherit',
    });
    mermaidLoaded = true;
    return mermaid;
  });
  return loadPromise;
}

let renderId = 0;

export default function MermaidDiagram({ chart }: { chart: string }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [svg, setSvg] = useState<string>('');
  const [error, setError] = useState<string>('');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    const id = `mermaid-${renderId++}`;

    (async () => {
      try {
        const mermaid = await loadMermaid();
        if (cancelled) return;
        const { svg: rendered } = await mermaid.render(id, chart);
        if (!cancelled) {
          setSvg(rendered);
          setLoading(false);
        }
      } catch (err) {
        if (!cancelled) {
          setError(String(err));
          setLoading(false);
        }
      }
    })();

    return () => { cancelled = true; };
  }, [chart]);

  if (loading) {
    return (
      <div ref={containerRef} style={{ textAlign: 'center', padding: '20px', color: 'var(--text-tertiary)' }}>
        <div style={{ width: '28px', height: '28px', border: '3px solid var(--border)', borderTopColor: 'var(--primary)', borderRadius: '50%', animation: 'spin 0.8s linear infinite', margin: '0 auto 8px' }} />
        <style>{'@keyframes spin{to{transform:rotate(360deg)}}'}</style>
        渲染图表中...
      </div>
    );
  }

  if (error) {
    return (
      <div style={{ textAlign: 'center', padding: '16px', color: 'var(--danger)', fontSize: '13px' }}>
        图表渲染失败
        <pre style={{ marginTop: '8px', fontSize: '11px', textAlign: 'left', color: 'var(--text-tertiary)' }}>{chart}</pre>
      </div>
    );
  }

  return <div ref={containerRef} dangerouslySetInnerHTML={{ __html: svg }} style={{ overflowX: 'auto' }} />;
}
