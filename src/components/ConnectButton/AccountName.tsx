import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { getLabel, readHerotag } from 'multisig/addressBook';

// The connected wallet in the header: its name when it has one (the label you
// gave it, else its herotag), otherwise erd1 plus as many characters from each
// end as fit, 3 + 3 at the least and 6 + 6 at the most. On a phone the room is
// measured and the count follows it; from 640px up there is room for 6 + 6.
// Pressing it copies the full address.

const MIN = 3;
const MAX = 6;

/** erd1 plus `n` characters, an ellipsis, and the last `n`. */
export const fitAddress = (address: string, n: number) =>
  `${address.slice(0, 4 + n)}…${address.slice(-n)}`;

/** The largest count whose text fits `room` pixels, measured with `measure`. */
export const bestFit = (
  address: string,
  room: number,
  measure: (text: string) => number
) => {
  let best = MIN;
  for (let n = MIN; n <= MAX; n++) {
    if (measure(fitAddress(address, n)) > room) break;
    best = n;
  }
  return best;
};

export const AccountName = ({ address }: { address: string }) => {
  const slot = useRef<HTMLButtonElement>(null);
  const [label, setLocalLabel] = useState(() => getLabel(address));
  const [herotag, setHerotag] = useState('');
  const [count, setCount] = useState(MAX);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    const refresh = () => setLocalLabel(getLabel(address));
    refresh();
    window.addEventListener('mvxsafe:labels', refresh);
    return () => window.removeEventListener('mvxsafe:labels', refresh);
  }, [address]);

  useEffect(() => {
    let cancelled = false;
    setHerotag('');
    if (!label) {
      readHerotag(address).then((name) => {
        if (!cancelled) setHerotag(name);
      });
    }
    return () => {
      cancelled = true;
    };
  }, [address, label]);

  const name = label || herotag;

  useLayoutEffect(() => {
    const element = slot.current;
    if (name || !element) return;
    const context = document.createElement('canvas').getContext?.('2d');
    const fit = () => {
      if (window.matchMedia?.('(min-width: 640px)').matches || !context) {
        setCount(MAX);
        return;
      }
      const style = window.getComputedStyle(element);
      context.font = `${style.fontWeight} ${style.fontSize} ${style.fontFamily}`;
      setCount(
        bestFit(
          address,
          element.clientWidth,
          (text) => context.measureText(text).width
        )
      );
    };
    fit();
    if (typeof ResizeObserver === 'undefined') {
      window.addEventListener('resize', fit);
      return () => window.removeEventListener('resize', fit);
    }
    const observer = new ResizeObserver(fit);
    observer.observe(element);
    return () => observer.disconnect();
  }, [address, name]);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(address);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // Clipboard refused, for example without https. Nothing else to do.
    }
  };

  return (
    <button
      ref={slot}
      type='button'
      onClick={copy}
      title={`${address}\nPress to copy the full address.`}
      aria-label={`Connected as ${name || address}. Copy the full address.`}
      className='min-w-0 flex-1 truncate text-right text-xs whitespace-nowrap text-[#9AA0A6] hover:text-white sm:flex-none'
    >
      {copied ? 'Copied' : name || fitAddress(address, count)}
    </button>
  );
};
