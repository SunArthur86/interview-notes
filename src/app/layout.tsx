import './globals.css';
import ClientBootstrap from '@/components/ClientBootstrap';
import type { Metadata, Viewport } from 'next';

export const metadata: Metadata = {
  title: '面试随手记',
  description: '随手记录网上搜索的面试题，涵盖 Java、AI、算法、系统设计等全方向，含费曼快学、第一性原理、遗忘曲线智能复习。',
  manifest: '/manifest.json',
};

export const viewport: Viewport = {
  themeColor: '#34C759',
  width: 'device-width',
  initialScale: 1,
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="zh-CN" suppressHydrationWarning>
      <head>
        <script
          dangerouslySetInnerHTML={{
            __html: `(function(){try{var s=localStorage.getItem('interview-notes');var t='light';if(s){var j=JSON.parse(s);t=j.state&&j.state.theme||t;}else if(localStorage.getItem('interview-notes.theme')){t=JSON.parse(localStorage.getItem('interview-notes.theme'));}document.documentElement.setAttribute('data-theme',t);}catch(e){}})();`,
          }}
        />
      </head>
      <body>
        <ClientBootstrap>{children}</ClientBootstrap>
      </body>
    </html>
  );
}
