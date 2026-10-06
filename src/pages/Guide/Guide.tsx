import { Link } from 'react-router-dom';

// The public walkthrough. Written for someone who has never used a multisig, so
// it explains the idea before the buttons. Steps that the app cannot do yet are
// marked rather than quietly promised.

const section = 'mt-10';
const heading = 'text-xl font-semibold text-white';
const body = 'mt-3 text-sm leading-relaxed text-[#9AA0A6]';
const stepNumber =
  'flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-[#FF6E0A] text-sm font-semibold text-[#FF6E0A]';
const soon =
  'ml-3 rounded-full bg-[#2A2A32] px-2 py-0.5 align-middle text-[10px] tracking-widest text-[#9AA0A6] uppercase';

const Step = ({
  number,
  title,
  comingSoon,
  children
}: {
  number: number;
  title: string;
  comingSoon?: boolean;
  children: React.ReactNode;
}) => (
  <div className='mt-8 flex gap-4'>
    <div className={stepNumber}>{number}</div>
    <div className='flex-1'>
      <h3 className='text-lg font-semibold text-white'>
        {title}
        {comingSoon && <span className={soon}>coming soon</span>}
      </h3>
      <div className={body}>{children}</div>
    </div>
  </div>
);

export const Guide = () => (
  <div className='mx-auto w-full max-w-3xl px-4 py-10'>
    <p className='text-xs font-semibold tracking-[0.25em] text-[#FF6E0A]'>HOW IT WORKS</p>
    <h1 className='mt-2 text-3xl font-semibold text-white'>
      A safe that needs more than one person
    </h1>
    <p className={body}>
      A multisig safe is an account on MultiversX that nobody controls alone. A small
      group, called the board, decides together: any member can propose something, the
      others agree by signing, and the safe carries it out once enough signatures are in.
      How many is enough is called the quorum, written as two of three, for example.
    </p>
    <p className={body}>
      Nothing here holds your keys. You connect your own wallet, the safe lives on the
      blockchain, and this interface only shows you what is there and prepares the
      transactions you sign yourself.
    </p>

    <div className={section}>
      <h2 className={heading}>The whole flow, step by step</h2>

      <Step number={1} title='Add a safe you already have'>
        On the <Link to='/' className='text-[#FF6E0A] hover:underline'>Safes</Link> page,
        paste the contract address of the multisig and give it a name. It appears in your
        list with its balances, its board and anything waiting for a signature. The list
        is kept in your browser alone: no account, nothing sent anywhere.
      </Step>

      <Step number={2} title='Or create a new safe' comingSoon>
        Choose who sits on the board and how many signatures an action needs, then deploy
        it. The safe is yours from that moment: this site has no special access to it and
        can be replaced by any other interface that speaks to the same contract.
      </Step>

      <Step number={3} title='The board and the quorum'>
        Board members can propose, sign and carry out actions. Proposers, an optional
        second role, can only propose. The quorum is the number of signatures an action
        needs before it can happen. Adding a member, removing one or changing the quorum
        are themselves actions that the board has to approve, so no single person can
        change the rules.
      </Step>

      <Step number={4} title='Propose an action' comingSoon>
        Sending tokens, adding or removing a member, changing the quorum, or calling
        another contract. Proposing costs a small network fee and changes nothing on its
        own: it only puts the request in front of the board, where it waits.
      </Step>

      <Step number={5} title='Read it, then sign' comingSoon>
        Every pending action is shown in plain words before you sign: which token, how
        much, to which address, and what function is being called. Signing is approval,
        not execution. You can also unsign while an action is still waiting, if you change
        your mind.
      </Step>

      <Step number={6} title='Carry it out' comingSoon>
        Once the signatures reach the quorum, any board member can perform the action, and
        that is the moment the safe actually moves anything. Usually the last person to
        sign does it, in the same visit.
      </Step>

      <Step number={7} title='Or discard it' comingSoon>
        An action that is no longer wanted is discarded, which clears it from the list.
        Nothing is spent and nothing moves.
      </Step>
    </div>

    <div className={section}>
      <h2 className={heading}>Worth knowing</h2>
      <ul className='mt-3 list-disc space-y-2 pl-5 text-sm leading-relaxed text-[#9AA0A6]'>
        <li>
          Your keys never reach this site. Every transaction is signed in your own wallet,
          whether that is xPortal, the browser extension, a Ledger or the web wallet.
        </li>
        <li>
          Read what you are signing. The description of an action is built from what the
          contract itself reports, not from what the proposer typed.
        </li>
        <li>
          Everything here is public. Balances, board members, signatures and history are on
          the blockchain, and anyone can verify them in the explorer.
        </li>
        <li>
          Losing access to this site does not lock you out of your safe. The contract is
          independent of it, and the source of this interface is public so anyone can run
          their own copy.
        </li>
      </ul>
    </div>

    <div className='mt-12 rounded-xl border border-[#2A2A32] bg-[#121218] p-5'>
      <h2 className='text-base font-semibold text-white'>If you only have to sign</h2>
      <p className='mt-2 text-sm text-[#9AA0A6]'>
        Someone else proposes and you approve. That is four steps, on one page:{' '}
        <a
          href='/mvxsafe-for-signers.pdf'
          target='_blank'
          rel='noreferrer'
          className='text-[#FF6E0A] hover:underline'
        >
          download the signer's guide (PDF)
        </a>
        . Written to be read by someone who has never touched a blockchain.
      </p>
    </div>
  </div>
);
