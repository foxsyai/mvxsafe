import { ReactNode } from 'react';
import { Link } from 'react-router-dom';

// The public walkthrough. Written for someone who has never used a multisig, so
// it explains the idea before the buttons, and shows the real interface rather
// than describing it. The pictures are photographs of the live site operating a
// real safe; the board members carry the names they were given in that browser,
// which is the feature step 4 explains.

const heading = 'text-xl font-semibold text-white';
const body = 'mt-3 text-sm leading-relaxed text-[#9AA0A6]';
const stepNumber =
  'flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-[#FF6E0A] text-sm font-semibold text-[#FF6E0A]';
const soon =
  'ml-3 rounded-full bg-[#2A2A32] px-2 py-0.5 align-middle text-[10px] tracking-widest text-[#9AA0A6] uppercase';

const Shot = ({ src, caption }: { src: string; caption: string }) => (
  <figure className='mt-4'>
    <img
      src={src}
      alt={caption}
      loading='lazy'
      className='w-full rounded-lg border border-[#2A2A32]'
    />
    <figcaption className='mt-2 text-xs text-[#6B7280]'>{caption}</figcaption>
  </figure>
);

const Step = ({
  number,
  title,
  comingSoon,
  children
}: {
  number: number;
  title: string;
  comingSoon?: boolean;
  children: ReactNode;
}) => (
  <div className='mt-10 flex gap-4'>
    <div className={stepNumber}>{number}</div>
    <div className='min-w-0 flex-1'>
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
      transactions that you sign yourself.
    </p>
    <p className='mt-3 text-xs text-[#6B7280]'>
      The pictures below are of this site operating a real safe. The board members appear
      as Alice, Bob and Carol because they were given those names in that browser, which
      is what step 4 is about.
    </p>

    <div className='mt-10'>
      <h2 className={heading}>The whole flow, step by step</h2>

      <Step number={1} title='Add a safe you already have'>
        You start with an empty list. Paste the contract address of the multisig, give it a
        name, and it appears with its balances, what it holds in dollars and how many
        signatures it needs. The list is kept in your browser alone: no account, nothing
        sent anywhere. Export writes it to a file and Import reads one back, so it can move
        to another browser or another machine.
        <Shot src='/shots/08-empty.jpg' caption='Before anything is added.' />
        <Shot
          src='/shots/09-add.jpg'
          caption='A name, the contract address, and Add. Watching a safe gives you no rights over it.'
        />
        <Shot
          src='/shots/10-list-watching.jpg'
          caption='Seven safes in the list. The eye on each one means you are only watching.'
        />
      </Step>

      <Step number={2} title='Connect your wallet'>
        Connecting proves which address you are. It cannot move anything by itself: every
        action is a separate transaction that your wallet has to sign. xPortal, the browser
        extension, a Ledger and the web wallet all work.
        <Shot
          src='/shots/11-connect-chooser.jpg'
          caption='Connecting with xPortal: the app on your phone scans the code. The other wallets ask for whatever they need instead.'
        />
        Once connected, any safe whose board you sit on changes from the eye to the team
        icon. Nothing else about the page changes.
        <Shot
          src='/shots/12-list-board-member.jpg'
          caption='The same list, connected. The team icon marks the safes you can act on.'
        />
      </Step>

      <Step number={3} title='Read the safe'>
        Opening a safe shows the quorum, what it holds, which actions are waiting, who has
        signed them, and whether you are on the board. Everything on this page is read from
        the contract itself.
        <Shot
          src='/shots/13-safe-overview.jpg'
          caption='A safe seen by one of its board members. Two signatures out of three move anything.'
        />
      </Step>

      <Step number={4} title='Know who is who'>
        An address tells you nothing about whose it is, so each one can carry a name. If the
        account has a herotag, it is shown automatically. Otherwise the pencil lets you name
        it yourself, and that name follows the address everywhere in the app and travels in
        your export file. Below the board, the holdings are listed with their value in
        dollars, and under them the full history, each line linking to the explorer.
        <Shot
          src='/shots/14-board-and-holdings.jpg'
          caption='The board, named by hand, and what the safe holds. The names live in your browser, never on the chain.'
        />
      </Step>

      <Step number={5} title='Propose an action'>
        Sending tokens or EGLD, adding or removing a member, changing the quorum. Proposing
        costs a small network fee and changes nothing on its own: it puts the request in
        front of the board, where it waits. The person who proposes has signed it by doing
        so.
        <Shot
          src='/shots/15-propose-form.jpg'
          caption='Proposing a token payment: which token, to whom, how much.'
        />
      </Step>

      <Step number={6} title='Read it, then sign'>
        Every pending action is written in plain words before you sign: which token, how
        much, to which address. Check it against what you were told, and refuse anything the
        interface says it cannot read. Signing is approval, not execution.
        <Shot
          src='/shots/17-action-to-sign.jpg'
          caption='An action waiting for you. It needs two signatures and has none yet.'
        />
        You can also take your signature back while the action is still waiting, if you
        change your mind. The card then shows who has signed so far.
        <Shot
          src='/shots/16-pending-action.jpg'
          caption='The same action after one signature. Discard is greyed out, because what others have approved cannot be thrown away.'
        />
      </Step>

      <Step number={7} title='Carry it out'>
        Once the signatures reach the quorum, any board member can carry the action out, and
        that is the moment the safe actually moves something. Usually the last person to
        sign does it, in the same visit.
      </Step>

      <Step number={8} title='Or discard it'>
        An action nobody wants is discarded, which clears it from the list. The contract
        refuses to discard anything that already carries signatures, so nobody can throw
        away what others have approved. Everyone who signed has to remove their signature
        first.
      </Step>

      <Step number={9} title='Create a new safe' comingSoon>
        Choose who sits on the board and how many signatures an action needs, then deploy it.
        The safe is yours from that moment: this site has no special access to it and can be
        replaced by any other interface that speaks to the same contract.
      </Step>
    </div>

    <div className='mt-12'>
      <h2 className={heading}>Worth knowing</h2>
      <ul className='mt-3 list-disc space-y-2 pl-5 text-sm leading-relaxed text-[#9AA0A6]'>
        <li>
          Your keys never reach this site. Every transaction is signed in your own wallet,
          whether that is xPortal, the browser extension, a Ledger or the web wallet.
        </li>
        <li>
          Read what you are signing. The description of an action is built from what the
          contract itself reports, not from what the proposer typed. An action the interface
          cannot read says so, and you should refuse it.
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
        <li>
          Keep a little EGLD in your wallet. Proposing, signing and carrying out are
          transactions, and each costs a small network fee.
        </li>
        <li>
          A guarded wallet works here. If your account has a guardian switched on, every
          transaction carries it, and your wallet asks for the second factor as usual.
        </li>
      </ul>
    </div>

    <div className='mt-12 rounded-xl border border-[#2A2A32] bg-[#121218] p-5'>
      <h2 className='text-base font-semibold text-white'>If you only have to sign</h2>
      <p className='mt-2 text-sm text-[#9AA0A6]'>
        Someone else proposes and you approve. That is four steps, with a picture of each:{' '}
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
      <p className='mt-3 text-sm text-[#9AA0A6]'>
        Everything else lives in the{' '}
        <Link to='/' className='text-[#FF6E0A] hover:underline'>
          list of safes
        </Link>
        .
      </p>
    </div>
  </div>
);
