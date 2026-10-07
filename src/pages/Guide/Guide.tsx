import { ReactNode } from 'react';
import { Link } from 'react-router-dom';

// The public walkthrough. Written for someone who has never used a multisig, so
// it explains the idea before the buttons, and shows the real interface rather
// than describing it. The pictures are photographs of the live site operating a
// real safe, taken by scripts/capture/guide.mjs in the order the steps follow:
// one payment from proposal to history, by two board members. The board members
// carry the names they were given in that browser, which is the feature step 4
// explains.

const heading = 'text-xl font-semibold text-white';
const body = 'mt-3 text-sm leading-relaxed text-[#9AA0A6]';
const stepNumber =
  'flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-[#FF6E0A] text-sm font-semibold text-[#FF6E0A]';
const soon =
  'ml-3 rounded-full bg-[#2A2A32] px-2 py-0.5 align-middle text-[10px] tracking-widest text-[#9AA0A6] uppercase';

const Shot = ({ src, caption }: { src: string; caption: string }) => (
  <figure className='my-4'>
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
    <p className='text-xs font-semibold tracking-[0.25em] text-[#FF6E0A]'>
      HOW IT WORKS
    </p>
    <h1 className='mt-2 text-3xl font-semibold text-white'>
      A safe that needs more than one person
    </h1>
    <p className={body}>
      A multisig safe is an account on MultiversX that nobody controls alone. A
      small group, called the board, decides together: any member can propose
      something, the others agree by signing, and the safe carries it out once
      enough signatures are in. How many is enough is called the quorum, written
      as two of three, for example.
    </p>
    <p className={body}>
      Nothing here holds your keys. You connect your own wallet, the safe lives
      on the blockchain, and this interface only shows you what is there and
      prepares the transactions that you sign yourself.
    </p>
    <p className='mt-3 text-xs text-[#6B7280]'>
      The pictures below are of this site operating a real safe on mainnet,
      called Team safe here. Its board appears as Alice, Bob and Dave because
      they were given those names in that browser, which is what step 4 is
      about.
    </p>

    <div className='mt-10'>
      <h2 className={heading}>The whole flow, step by step</h2>

      <Step number={1} title='Add a safe you already have'>
        You start with an empty list. Paste the contract address of the
        multisig, give it a name, and it appears with what it holds, its value
        in dollars and how many signatures it needs. The list is kept in your
        browser alone: no account, nothing sent anywhere. Export writes it to a
        file and Import reads one back, so it can move to another browser or
        another machine.
        <Shot src='/shots/01-empty.jpg' caption='Before anything is added.' />
        <Shot
          src='/shots/02-add.jpg'
          caption='A name and the contract address, then Add.'
        />
        <Shot
          src='/shots/03-list-read-only.jpg'
          caption='The safe in the list: its main holding, the signatures it needs, what is waiting and how many actions it has seen. Read only means watching, with no rights over it.'
        />
      </Step>

      <Step number={2} title='Look inside, no wallet needed'>
        Everything about a safe is public, so opening one needs no wallet at
        all. You see the quorum, what it holds, the actions waiting for
        signatures, who sits on the board and the full history. Everything on
        this page is read from the contract itself.
        <Shot
          src='/shots/04-safe-read-only.jpg'
          caption='The same safe opened without a wallet. Two signatures out of three move anything, and nothing is waiting right now.'
        />
      </Step>

      <Step number={3} title='Connect your wallet'>
        Connecting proves which address you are. It cannot move anything by
        itself: every action is a separate transaction that your wallet has to
        sign. xPortal, the browser extension, a Ledger and the web wallet all
        work.
        <Shot
          src='/shots/05-connect.jpg'
          caption='The wallet chooser. xPortal shows a code to scan with your phone; the others ask for whatever they need.'
        />
        Once connected, every safe whose board you sit on changes from read only
        to board member, and the safe itself tells you what you can do there.
        <Shot
          src='/shots/06-list-board-member.jpg'
          caption='The same list, connected as Alice. The orange badge marks a safe you can act on.'
        />
        <Shot
          src='/shots/07-safe.jpg'
          caption='Inside the safe, connected: proposing, signing and carrying out are open to you.'
        />
      </Step>

      <Step number={4} title='Know who is who'>
        An address tells you nothing about whose it is, so each one can carry a
        name. If the account has a herotag, it is shown automatically. Otherwise
        the pencil lets you name it yourself, and that name follows the address
        everywhere in the app and travels in your export file. Below the board,
        the holdings are listed with their value in dollars, and under them the
        full history, each line linking to the explorer.
        <Shot
          src='/shots/08-board-holdings.jpg'
          caption='The board, named by hand, with YOU next to your own address. The names live in your browser, never on the chain.'
        />
      </Step>

      <Step number={5} title='Propose an action'>
        Sending tokens or EGLD, adding a board member or a proposer, removing
        either, changing the quorum. Proposing costs a small network fee and
        changes nothing on its own: it puts the request in front of the board,
        where it waits. Proposing also counts as your signature.
        <Shot
          src='/shots/13-propose-form.jpg'
          caption='Alice proposes a payment of 10 FOXSY to Dave: which token, to whom, how much.'
        />
        <Shot
          src='/shots/14-pending-proposer.jpg'
          caption='The proposal, waiting for the board. Alice signed it by proposing, so it stands at one of two.'
        />
      </Step>

      <Step number={6} title='See what needs you'>
        The list tells every board member where they are needed. When an action
        waits for your signature, the card of that safe says so before you even
        open it.
        <Shot
          src='/shots/15-list-needs-you.jpg'
          caption='Bob connects and sees one action waiting for him.'
        />
      </Step>

      <Step number={7} title='Read it, then sign'>
        Every pending action is written in plain words before you sign: which
        token, how much, to which address. Check it against what you were told,
        and refuse anything the interface says it cannot read. Signing is
        approval, not execution.
        <Shot
          src='/shots/16-sign.jpg'
          caption='What Bob sees: the whole action, who has signed it so far, and Sign.'
        />
        Until the action is carried out, Remove my signature takes your approval
        back if you change your mind.
      </Step>

      <Step number={8} title='Carry it out'>
        Once the signatures reach the quorum, any board member can carry the
        action out, and that is the moment the safe actually moves something.
        Usually the last person to sign does it, in the same visit.
        <Shot
          src='/shots/17-ready.jpg'
          caption='Two signatures of the two needed, so Carry it out appears. The note in the corner confirms that Bob signed.'
        />
        Afterwards the action leaves the list and joins the history, along with
        every step that led to it.
        <Shot
          src='/shots/18-history.jpg'
          caption='The history: who proposed, who signed and who carried out, each line linked to its transaction.'
        />
      </Step>

      <Step number={9} title='Or discard it'>
        An action nobody wants is discarded, which clears it from the list. The
        contract refuses to discard anything that still carries signatures, so
        nobody can throw away what others have approved. Everyone who signed has
        to remove their signature first, the person who proposed it included.
        <Shot
          src='/shots/12-discard-ready.jpg'
          caption='A small payment after Alice took her signature back. At zero signatures, Discard is open.'
        />
      </Step>

      <Step number={10} title='Change the board'>
        Adding or removing a board member or a proposer, or changing the quorum,
        goes through the same propose, sign and carry out as a payment. A
        proposer can suggest actions but never sign them. An address holds one
        role at a time, so a change can do more than it seems: while you type,
        the form says what it would really do. A change that would do nothing,
        or that the contract would refuse when it is carried out, is stopped in
        the form before anybody pays a fee.
        <Shot
          src='/shots/10-membership-note.jpg'
          caption='Making Alice a proposer: the note warns that it would take her off the board.'
        />
        <Shot
          src='/shots/11-refused.jpg'
          caption='Removing an address that holds no role. There is nothing to remove, so the form refuses it.'
        />
      </Step>

      <Step number={11} title='Create a new safe'>
        Choose who sits on the board and how many signatures an action needs, on
        the{' '}
        <Link to='/create' className='text-[#FF6E0A] hover:underline'>
          create page
        </Link>
        . Your wallet signs two transactions: the first creates the safe, the
        second hands it to itself, so nobody, not even the person who created
        it, can change its code alone. This site keeps no special access to it.
        <Shot
          src='/shots/09-create.jpg'
          caption='Three board members, two of whom have to sign. The first address is the connected wallet.'
        />
      </Step>
    </div>

    <div className='mt-12'>
      <h2 className={heading}>Worth knowing</h2>
      <ul className='mt-3 list-disc space-y-2 pl-5 text-sm leading-relaxed text-[#9AA0A6]'>
        <li>
          Your keys never reach this site. Every transaction is signed in your
          own wallet, whether that is xPortal, the browser extension, a Ledger
          or the web wallet.
        </li>
        <li>
          Read what you are signing. The description of an action is built from
          what the contract itself reports, not from what the proposer typed. An
          action the interface cannot read says so, and you should refuse it.
        </li>
        <li>
          Everything here is public. Balances, board members, signatures and
          history are on the blockchain, and anyone can verify them in the
          explorer.
        </li>
        <li>
          Losing access to this site does not lock you out of your safe. The
          contract is independent of it, and the source of this interface is
          public so anyone can run their own copy.
        </li>
        <li>
          Keep a little EGLD in your wallet. Proposing, signing and carrying out
          are transactions, and each costs a small network fee.
        </li>
        <li>
          A guarded wallet works here. If your account has a guardian switched
          on, every transaction carries it, and your wallet asks for the second
          factor as usual.
        </li>
      </ul>
    </div>

    <div className='mt-12 rounded-xl border border-[#2A2A32] bg-[#121218] p-5'>
      <h2 className='text-base font-semibold text-white'>
        If you only have to sign
      </h2>
      <p className='mt-2 text-sm text-[#9AA0A6]'>
        Someone else proposes and you approve. That is four steps, on a single
        page:{' '}
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
