// What the connected wallet may do with this safe, at a glance. Not connected,
// or connected as a stranger, is an eye: you can read everything and change
// nothing. On the board it becomes the team icon, and the safe's buttons appear.
export type Role = 'None' | 'BoardMember' | 'Proposer' | 'Unknown';

const EyeIcon = () => (
  <svg width='14' height='14' viewBox='0 0 24 24' fill='none' aria-hidden>
    <path
      d='M2 12s3.5-6.5 10-6.5S22 12 22 12s-3.5 6.5-10 6.5S2 12 2 12Z'
      stroke='currentColor'
      strokeWidth='1.8'
      strokeLinejoin='round'
    />
    <circle cx='12' cy='12' r='2.6' stroke='currentColor' strokeWidth='1.8' />
  </svg>
);

const TeamIcon = () => (
  <svg width='15' height='15' viewBox='0 0 24 24' fill='none' aria-hidden>
    <circle cx='9' cy='8' r='3.1' stroke='currentColor' strokeWidth='1.8' />
    <path
      d='M3 19c0-2.8 2.7-4.6 6-4.6s6 1.8 6 4.6'
      stroke='currentColor'
      strokeWidth='1.8'
      strokeLinecap='round'
    />
    <path
      d='M16.5 6.4a3.1 3.1 0 0 1 0 5.9M18 14.9c2 .7 3.4 2.2 3.4 4.1'
      stroke='currentColor'
      strokeWidth='1.8'
      strokeLinecap='round'
    />
  </svg>
);

export const RoleBadge = ({ role }: { role: Role }) => {
  if (role === 'BoardMember' || role === 'Proposer') {
    return (
      <span className='inline-flex items-center gap-1.5 rounded-full bg-[#FF6E0A]/15 px-2.5 py-1 text-xs text-[#FF6E0A]'>
        <TeamIcon />
        {role === 'BoardMember' ? 'board member' : 'proposer'}
      </span>
    );
  }

  return (
    <span className='inline-flex items-center gap-1.5 rounded-full border border-[#2A2A32] px-2.5 py-1 text-xs text-[#6B7280]'>
      <EyeIcon />
      read only
    </span>
  );
};
