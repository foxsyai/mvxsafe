import classNames from 'classnames';

// The mark: the FoxLeague fox head, hollow, with a check inside. Inline rather
// than an <img> so it inherits colour and never flashes while loading.
const styles = {
  logo: 'logo flex items-center gap-3',
  text: 'text-lg font-semibold tracking-tight text-white',
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
        stroke='#FF6E0A'
        strokeWidth='24'
        strokeLinejoin='round'
        strokeLinecap='round'
      />
      <path
        d='M 178 296 L 232 350 L 334 244'
        stroke='#F5F5F5'
        strokeWidth='26'
        strokeLinejoin='round'
        strokeLinecap='round'
      />
    </svg>
    <span className={classNames(styles.text, { [styles.textHidden]: hideTextOnMobile })}>
      mvxsafe
    </span>
  </div>
);
