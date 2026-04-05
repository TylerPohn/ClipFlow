import './global.css';
import Providers from '@/components/Providers';
import NavBar from '@/components/NavBar';
import Footer from '@/components/Footer';

export const metadata = {
  title: 'Cliptopus',
  description: 'Repurpose your videos across every platform',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <script
          dangerouslySetInnerHTML={{
            __html: `(function(){try{var t=localStorage.getItem('cliptopus-theme');if(t==='dark'||t==='light'){document.documentElement.setAttribute('data-theme',t)}else{document.documentElement.setAttribute('data-theme','light')}}catch(e){document.documentElement.setAttribute('data-theme','light')}})()`,
          }}
        />
      </head>
      <body style={{ display: 'flex', flexDirection: 'column', minHeight: '100vh' }}>
        <Providers>
          <NavBar />
          <main style={{ flex: 1 }}>{children}</main>
          <Footer />
        </Providers>
      </body>
    </html>
  );
}
