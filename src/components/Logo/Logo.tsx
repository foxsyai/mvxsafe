import classNames from 'classnames';

// The mark: the fox head filled in orange with a thick black check. Solid
// rather than outlined because black on orange carries about three times the
// contrast of white, which is what keeps it legible at favicon size
// (chosen 6 Oct 2026). Inline rather than an <img> so it never
// flashes while loading.
const styles = {
  logo: 'logo flex items-center gap-3',
  // Below 360px wide (the smallest phones) the mark stands alone, or the
  // header has no room for "How it works" beside it.
  text: 'text-lg font-semibold tracking-tight text-white max-[359px]:hidden',
  textHidden: 'hidden sm:flex'
} satisfies Record<string, string>;

interface LogoPropsType {
  hideTextOnMobile?: boolean;
}

export const Logo = ({ hideTextOnMobile }: LogoPropsType) => (
  <div className={styles.logo}>
    <svg width='30' height='30' viewBox='0 0 512 512' fill='none' aria-hidden>
      <path
        d='M 84 24 L 180 160 L 332 160 L 428 24 L 472 300 L 256 492 L 40 300 Z'
        fill='#FF6E0A'
        stroke='#FF6E0A'
        strokeWidth='18'
        strokeLinejoin='round'
      />
      <path
        d='M 170 292 L 230 352 L 342 236'
        stroke='#09090D'
        strokeWidth='52'
        strokeLinejoin='round'
        strokeLinecap='round'
      />
    </svg>
    <span className={classNames(styles.text, { [styles.textHidden]: hideTextOnMobile })}>
      mvxsafe
    </span>
  </div>
);
