import { PropsWithChildren } from 'react';
import { Footer } from '../Footer';
import { Header } from '../Header';

// The template wrapped this in AuthRedirectWrapper, which sends a logged-in
// visitor to a dashboard route. There is no login in this milestone and every
// page is public, so the wrapper would only get in the way.
export const Layout = ({ children }: PropsWithChildren) => (
  <div className='flex min-h-screen flex-col bg-[#0E0E12]'>
    <Header />
    <main className='flex flex-grow items-stretch justify-center'>{children}</main>
    <Footer />
  </div>
);
