// Renders the shipped Safe page inside a router, with the network replaced by the
// fixtures and the wallet by mocks.ts, and waits until the first load is done
// (the Refresh button reappears).
import { render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { Safe } from 'pages/Safe/Safe';

export { connectAs } from './mocks';

export const renderSafe = async (address: string) => {
  const view = render(
    <MemoryRouter initialEntries={[`/safe/${address}`]}>
      <Routes>
        <Route path='/safe/:address' element={<Safe />} />
      </Routes>
    </MemoryRouter>
  );
  await screen.findByText('Refresh', {}, { timeout: 8000 });
  return view;
};
