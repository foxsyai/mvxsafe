import { PropsWithChildren, useEffect, useRef, useState } from 'react';

// Two ways to explain a control.
//
// Info is a small circled "i" next to a label, for the longer sentence. It
// opens on hover for a mouse and on a click for a finger, since hover does not
// exist on a phone.
//
// Tip wraps a button and shows a short line underneath it on hover or keyboard
// focus, so every button says what it does without being pressed.

export const Info = ({ text }: { text: string }) => {
  const [open, setOpen] = useState(false);
  const holder = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    if (!open) return;
    const closeOnOutside = (event: MouseEvent) => {
      if (!holder.current?.contains(event.target as Node)) setOpen(false);
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', closeOnOutside);
    document.addEventListener('keydown', closeOnEscape);
    return () => {
      document.removeEventListener('mousedown', closeOnOutside);
      document.removeEventListener('keydown', closeOnEscape);
    };
  }, [open]);

  return (
    <span
      ref={holder}
      className='relative ml-1 inline-flex translate-y-[0.5px] items-center align-middle'
      onMouseEnter={() => setOpen(true)}
      onMouseLeave={() => setOpen(false)}
    >
      <button
        type='button'
        aria-label='What is this?'
        aria-expanded={open}
        onClick={() => setOpen((current) => !current)}
        className='flex h-3.5 w-3.5 items-center justify-center rounded-full border border-[#4B5563] text-[9px] leading-none text-[#9AA0A6] hover:border-[#FF6E0A] hover:text-[#FF6E0A]'
      >
        i
      </button>
      {open && (
        <span className='absolute top-5 left-0 z-30 w-64 rounded-lg border border-[#2A2A32] bg-[#15151C] p-3 text-xs leading-relaxed font-normal text-[#C9CDD2] shadow-lg'>
          {text}
        </span>
      )}
    </span>
  );
};

/**
 * Shown on hover or keyboard focus. Driven by state rather than by a CSS hover
 * rule: Tailwind wraps those in "(hover: hover)", which is false on a touch
 * screen and in a headless browser, so the tips could neither be seen there nor
 * tested here.
 */
export const Tip = ({ text, children }: PropsWithChildren<{ text: string }>) => {
  const [shown, setShown] = useState(false);

  return (
    <span
      className='relative inline-flex'
      onMouseEnter={() => setShown(true)}
      onMouseLeave={() => setShown(false)}
      onFocus={() => setShown(true)}
      onBlur={() => setShown(false)}
    >
      {children}
      {shown && (
        <span
          role='tooltip'
          className='pointer-events-none absolute top-full left-1/2 z-30 mt-2 w-max max-w-xs -translate-x-1/2 rounded-lg border border-[#2A2A32] bg-[#15151C] px-3 py-2 text-xs leading-snug font-normal whitespace-normal text-[#C9CDD2] shadow-lg'
        >
          {text}
        </span>
      )}
    </span>
  );
};
