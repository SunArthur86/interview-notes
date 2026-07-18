'use client';

import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import rehypeHighlight from 'rehype-highlight';
import rehypeRaw from 'rehype-raw';
import MermaidDiagram from './MermaidDiagram';

export default function Markdown({ children }: { children: string }) {
  return (
    <div className="markdown-body">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        rehypePlugins={[rehypeRaw, rehypeHighlight]}
        components={{
          pre({ node, children, ...props }) {
            // Check if this is a mermaid code block
            const child = Array.isArray(children) ? children[0] : children;
            if (
              child &&
              typeof child === 'object' &&
              'props' in child
            ) {
              const childProps = child.props as { className?: string; children?: string };
              const className = childProps.className || '';
              if (className.includes('language-mermaid')) {
                const code = String(childProps.children || '').replace(/\n$/, '');
                return <MermaidDiagram chart={code} />;
              }
            }
            return <pre {...props}>{children}</pre>;
          },
        }}
      >
        {children}
      </ReactMarkdown>
    </div>
  );
}
