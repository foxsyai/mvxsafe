// Set by vite.config.ts at build time; absent under jest.
declare const __MVXSAFE_COMMIT__: string | undefined;
const COMMIT = typeof __MVXSAFE_COMMIT__ === 'string' ? __MVXSAFE_COMMIT__ : '';

export const Footer = () => (
  <footer className='border-t border-[#1F1F27] bg-[#0E0E12]'>
    <div className='mx-auto flex w-full max-w-5xl flex-wrap items-center justify-between gap-2 px-4 py-5 text-xs text-[#6B7280]'>
      <span>
        mvxsafe.io, a multisig interface for MultiversX. Your keys never leave your
        wallet.
      </span>
      <span className='flex items-center gap-3'>
        {/^[0-9a-f]{40}$/.test(COMMIT) && (
          <a
            href={`https://github.com/foxsyai/mvxsafe/commit/${COMMIT}`}
            target='_blank'
            rel='noreferrer'
            title='The commit this page was built from'
            className='font-mono hover:text-[#FF6E0A]'
          >
            {COMMIT.slice(0, 7)}
          </a>
        )}
        <a
          href='https://github.com/foxsyai/mvxsafe'
          target='_blank'
          rel='noreferrer'
          className='hover:text-[#FF6E0A]'
        >
          Source
        </a>
      </span>
    </div>
  </footer>
);
