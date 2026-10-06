export const Footer = () => (
  <footer className='border-t border-[#1F1F27] bg-[#0E0E12]'>
    <div className='mx-auto flex w-full max-w-5xl flex-wrap items-center justify-between gap-2 px-4 py-5 text-xs text-[#6B7280]'>
      <span>
        mvxsafe.io, a multisig interface for MultiversX. Your keys never leave your
        wallet.
      </span>
      <a
        href='https://github.com/foxsyai/mvxsafe'
        target='_blank'
        rel='noreferrer'
        className='hover:text-[#FF6E0A]'
      >
        Source
      </a>
    </div>
  </footer>
);
