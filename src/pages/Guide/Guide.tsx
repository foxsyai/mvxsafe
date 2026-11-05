import { ReactNode } from 'react';
import { Link } from 'react-router-dom';

// The public walkthrough. Written for someone who has never used a multisig, so
// it explains the idea before the buttons, and shows the real interface rather
// than describing it. The pictures are photographs of the live devnet site
// operating a test safe, taken by scripts/capture/guide.mjs in the order the steps
// follow: one payment from proposal to history, by two board members. The board
// members carry the names they were given in that browser, which is the feature
// step 4 explains.

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

// The one-page guides, made from docs/*-guide.html by scripts/make-guide-pdfs.js.
const ONE_PAGERS = [
  {
    title: 'If you only have to create a safe',
    text: 'You choose the board and the quorum, then sign two transactions. On a single page:',
    href: '/mvxsafe-create-a-safe.pdf',
    link: "download the creator's guide (PDF)"
  },
  {
    title: 'If you only have to propose',
    text: 'You ask the board to send funds and carry it out once enough have signed. On a single page:',
    href: '/mvxsafe-propose.pdf',
    link: "download the proposer's guide (PDF)"
  },
  {
    title: 'If you only have to sign',
    text: 'Someone else proposes and you approve. That is four steps, on a single page:',
    href: '/mvxsafe-for-signers.pdf',
    link: "download the signer's guide (PDF)"
  }
];

export const Guide = () => (
  <div className='mx-auto w-full max-w-3xl px-4 py-10'>
    <p className='text-xs font-semibold tracking-[0.25em] text-[#FF6E0A]'>
      HOW IT WORKS
    </p>
    <h1 className='mt-2 text-3xl font-semibold text-white'>
      A safe that needs more than one person
    </h1>
    {/* First, for someone with one job: one page each, in the order the jobs
        come. Whoever wants the whole picture reads on (2 Nov 2026). */}
    <div className='mt-6 grid gap-3 sm:grid-cols-3'>
      {ONE_PAGERS.map(({ title, text, href, link }) => (
        <div
          key={href}
          className='rounded-xl border border-[#2A2A32] bg-[#121218] p-5'
        >
          <h2 className='text-base font-semibold text-white'>{title}</h2>
          <p className='mt-2 text-sm text-[#9AA0A6]'>
            {text}{' '}
            <a
              href={href}
              target='_blank'
              rel='noreferrer'
              className='text-[#FF6E0A] hover:underline'
            >
              {link}
            </a>
            .
          </p>
        </div>
      ))}
    </div>
    <p className={body}>
      A multisig safe is an account on MultiversX that nobody controls alone. A
      small group, called the board, decides together: any member can propose
      something and the others agree by signing. Once enough signatures are in,
      the safe carries it out. How many is enough is called the quorum, written
      as two of three, for example.
    </p>
    <p className={body}>
      Nothing here holds your keys. You connect your own wallet and the safe
      lives on the blockchain. This interface only shows you what is there and
      prepares the transactions that you sign yourself.
    </p>
    <p className={body}>
      The pictures come from the test network, devnet, with test wallets and a
      test token, so they carry a DEVNET badge. The real thing at mvxsafe.io
      works the same way.
    </p>

    <div className='mt-10'>
      <h2 className={heading}>The whole flow, step by step</h2>

      <Step number={1} title='Add a safe you already have'>
        You start with an empty list. Paste the contract address of the multisig
        and give it a name. It appears with what it holds, its value in dollars
        and how many signatures it needs. The list is kept in your browser
        alone: no account, nothing sent anywhere. Export writes it to a file and
        Import reads one back, so it can move to another browser or another
        machine.
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
        signatures, who sits on the board and the full history. The quorum, the
        board and the actions are read from the contract itself. The history and
        the dollar values come from public network services.
        <Shot
          src='/shots/04-safe-read-only.jpg'
          caption='The same safe opened without a wallet. Two signatures out of three move anything. Nothing is waiting right now.'
        />
      </Step>

      <Step number={3} title='Connect your wallet'>
        Connecting proves which address you are: your wallet asks you to sign a
        short sign-in message for mvxsafe.io. It is a message and not a
        transaction: it cannot move anything. Every action is a separate
        transaction that your wallet has to sign. A sign-in lasts a day, then
        you connect again. xPortal, the browser extension, a Ledger, the web
        wallet and MetaMask all work. MetaMask signs through the MultiversX Snap
        and only on a computer: the chooser shows no MetaMask on a phone. The
        first time, MetaMask asks you to connect to snap.multiversx.com, the
        Snap's own page that mvxsafe opens for it.
        <Shot
          src='/shots/05-connect.jpg'
          caption='The wallet chooser. xPortal shows a code to scan with your phone; the others ask for whatever they need.'
        />
        Once connected, every safe whose board you sit on changes from read only
        to board member. The safe itself tells you what you can do there.
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
        the pencil lets you name it yourself. That name follows the address
        everywhere in the app and travels in your export file. Below the board,
        the holdings are listed with their value in dollars. Under them comes
        the full history, each line linking to the explorer.
        <Shot
          src='/shots/08-board-holdings.jpg'
          caption='The board, named by hand, with YOU next to your own address. The names live in your browser, never on the chain.'
        />
      </Step>

      <Step number={5} title='Propose an action'>
        Sending tokens or EGLD, adding a board member or a proposer, removing
        either, changing the quorum, calling a contract or upgrading one.
        Proposing costs a small network fee and changes nothing on its own: it
        puts the request in front of the board, where it waits. A board member
        who proposes has signed by doing so. A proposer has not, as proposers
        never sign.
        <Shot
          src='/shots/13-propose-form.jpg'
          caption='Alice proposes a payment of 10 TSAFED to Carol: which token, to whom, how much.'
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
          caption='Bob connects and sees one action waiting for a signature.'
        />
      </Step>

      <Step number={7} title='Read it, then sign'>
        Every pending action is written in plain words before you sign: which
        token, how much, to which address. Check it against what you were told.
        Refuse anything the interface says it cannot read. Signing is approval,
        not execution.
        <Shot
          src='/shots/16-sign.jpg'
          caption='What Bob sees: the whole action, who has signed it so far and the Sign button.'
        />
        Until the action is carried out, Remove my signature takes your approval
        back if you change your mind. MetaMask shows the safe address cut short,
        the name of the call and its raw data, such as sign@0a for action #10:
        the number in hex. The card shows the same @0a next to #10, so match the
        two. Numbers start again in every safe: check too that the address it
        shows begins and ends like the safe address at the top of this page. It
        does not say what the action does: read the card here first.
      </Step>

      <Step number={8} title='Carry it out'>
        Once the signatures reach the quorum, any board member or proposer can
        carry the action out. That is the moment the safe actually moves
        something. Usually the last person to sign does it, in the same visit.
        For a payment, a call or an upgrade, the card shows the gas the
        transaction will be given and about what it costs. The figure is worked
        out for that action, so leave it unless you have a reason to change it.
        A change of members or quorum shows no gas line: the network works its
        gas out when you carry it out.
        <Shot
          src='/shots/17-ready.jpg'
          caption='Two signatures of the two needed, so Carry it out appears, with the gas it will be given.'
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
          caption='A small payment after Alice took back the signature. At zero signatures, Discard is open.'
        />
      </Step>

      <Step number={10} title='Change the board'>
        Adding or removing a board member or a proposer goes through the same
        propose, sign and carry out as a payment. So does changing the quorum. A
        proposer can suggest actions and carry them out but never sign them. An
        address holds one role at a time, so a change can do more than it seems:
        while you type, the form says what it would really do. A change that
        would do nothing is stopped in the form before anybody pays a fee. So is
        a change the contract would refuse when it is carried out.
        <Shot
          src='/shots/10-membership-note.jpg'
          caption='Making Alice a proposer: the note warns that this would take Alice off the board.'
        />
        <Shot
          src='/shots/11-refused.jpg'
          caption='Removing an address that holds no role. There is nothing to remove, so the form refuses it.'
        />
      </Step>

      <Step number={11} title='Act on a contract the safe owns'>
        A safe can own other contracts. Only a vote of its board can change
        those. Call a contract has the safe call one of a contract's functions,
        to set a fee or pause it for example. The form shows the sentence the
        signers will read and tries the call as the safe would send it. A call
        that fails the try is not proposed. But a call cannot always be tried in
        advance, for example on a contract in another shard. The action then
        says so in amber and may still fail when it is carried out, so read that
        line before signing. A call on the safe itself is refused: it would act
        with all of the board's authority.
        <Shot
          src='/shots/19-call-form.jpg'
          caption='A call on a contract the safe owns: what the signers will read and the result of trying it.'
        />
        Upgrade a contract replaces a contract's code with the code of a source
        contract in the safe's shard. Its address and storage stay. The form
        wants the code hash of the release, which has to match the source. Every
        signer sees both code hashes on the action and can paste the release's
        hash there to check it. Take that hash from the release itself, not from
        the person proposing.
        <Shot
          src='/shots/20-upgrade-form.jpg'
          caption='An upgrade being filled in: the code the contract runs today, the code it would run and the checks the signers will see.'
        />
      </Step>

      <Step number={12} title='Create a new safe'>
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
      <h2 className={heading}>When the page warns you</h2>
      <p className={body}>
        A red box means stop and read it. Ask the rest of the board before doing
        anything. These are the ones at the top of a safe:
      </p>
      <Shot
        src='/shots/21-other-code.jpg'
        caption='A contract running other code. Everything that signs is held, with no way round it.'
      />
      <ul className='mt-3 list-disc space-y-2 pl-5 text-sm leading-relaxed text-[#9AA0A6]'>
        <li>
          This contract does not run the multisig code mvxsafe knows. What the
          page shows is only that contract's own word. Nothing can be signed,
          carried out, discarded or proposed from it. Do not send it funds.
        </li>
        <li>
          This safe is not in its own hands. Whoever owns it can replace its
          code alone, without the board. Ask that owner to hand it to itself
          before trusting it with funds.
        </li>
        <li>
          This safe needs no signatures. Its quorum is 0, so anyone with a role
          can carry out any action alone. Propose a new quorum before anything
          else.
        </li>
      </ul>
      <p className={body}>
        Each action also carries its own checks, in green, amber or red. When
        the network does not answer or something could not be read, Sign and
        Carry it out wait until it can be. They unlock by themselves or after
        Refresh.
      </p>
    </div>

    <div className='mt-12'>
      <h2 className={heading}>Worth knowing</h2>
      <ul className='mt-3 list-disc space-y-2 pl-5 text-sm leading-relaxed text-[#9AA0A6]'>
        <li>
          Your keys never reach this site. Every transaction is signed in your
          own wallet, whether that is xPortal, the browser extension, a Ledger,
          the web wallet or MetaMask.
        </li>
        <li>
          Read what you are signing. The description of an action is built from
          what the contract itself reports, not from what the proposer typed. An
          action the interface cannot read says so. Refuse it.
        </li>
        <li>
          A long list of waiting actions is read in parts. Those with a
          signature come first, then the newest. Load more reads the rest. If
          the page says the list is not complete, an older action may still be
          waiting. Go to action # opens any action by its number.
        </li>
        <li>
          Everything here is public. Balances, board members, signatures and
          history are on the blockchain. Anyone can verify them in the explorer.
        </li>
        <li>
          Losing access to this site does not lock you out of your safe. The
          contract is independent of it. The source of this interface is public
          so anyone can run their own copy.
        </li>
        <li>
          Keep a little EGLD in your wallet. Proposing, signing and carrying out
          are transactions. Each costs a small network fee.
        </li>
        <li>
          Keep a little EGLD in the safe too, about 0.01. The network tries a
          token payment or a call in advance only for a safe that could pay its
          fee. Without it, the action says in amber that it could not be tried.
          The try spends nothing and the safe never pays gas: whoever sends a
          transaction pays for it.
        </li>
        <li>
          A guarded wallet works here. If your account has a guardian switched
          on, every transaction carries it. Your wallet asks for the second
          factor as usual.
        </li>
      </ul>
    </div>

    <p className='mt-12 text-sm text-[#9AA0A6]'>
      Everything else lives in the{' '}
      <Link to='/' className='text-[#FF6E0A] hover:underline'>
        list of safes
      </Link>
      .
    </p>
  </div>
);
