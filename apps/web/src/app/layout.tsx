import type { Metadata } from 'next';
import type { ReactNode } from 'react';

export const metadata: Metadata = {
  title: 'Submittal Builder',
  description: 'Assemble submittal packages from manufacturer PDFs.',
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body
        style={{
          margin: 0,
          fontFamily:
            "system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif",
          background: '#fafafa',
          color: '#111',
        }}
      >
        {children}
      </body>
    </html>
  );
}
