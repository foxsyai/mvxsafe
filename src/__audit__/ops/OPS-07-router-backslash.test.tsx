// OPS-07, the react-router part (8 Oct 2026, GHSA-wrjc-x8rr-h8h6). Before 7.18
// navigate('/\evil.example') asked the History API for what a browser reads as
// "//evil.example", another origin; pushState refused, and the router fell back
// to window.location.assign, leaving the site. 7.18 refuses the navigation.
// mvxsafe navigates only to its own routes and to checked erd1 addresses, so
// nothing reaches this today; the test pins the library behaviour.
//
// <Link> is a different matter on purpose: React Router renders a link to an
// absolute or "//" target as an ordinary external link, in every version. Never
// give <Link> a target built from input.
import { fireEvent, render, screen } from '@testing-library/react';
import { BrowserRouter, useNavigate } from 'react-router-dom';

const Jump = ({ to, onResult }: { to: string; onResult: (result: string) => void }) => {
  const navigate = useNavigate();
  return (
    <button
      onClick={() => {
        try {
          navigate(to);
          onResult('navigated');
        } catch {
          onResult('refused');
        }
      }}
    >
      jump
    </button>
  );
};

/** Jumps to `to`, and reports whether the page tried to load another document. */
const jump = (to: string) => {
  const errors = jest.spyOn(console, 'error').mockImplementation(() => {});
  let result = '';
  render(
    <BrowserRouter>
      <Jump to={to} onResult={(value) => (result = value)} />
    </BrowserRouter>
  );
  fireEvent.click(screen.getByText('jump'));
  // jsdom cannot load another document and says so on the console; that is
  // the trace of window.location.assign.
  const leftThePage = errors.mock.calls.some((call) => /Not implemented: navigation/.test(String(call[0])));
  errors.mockRestore();
  return { result, leftThePage, path: window.location.pathname };
};

afterEach(() => window.history.replaceState(null, '', '/'));

test('control: an ordinary navigation stays inside the app', () => {
  expect(jump('/guide')).toEqual({ result: 'navigated', leftThePage: false, path: '/guide' });
});

test('a navigation to a path that starts with a backslash does not leave the site', () => {
  const outcome = jump('/\\evil.example');
  expect(outcome.leftThePage).toBe(false);
  expect(outcome.path).toBe('/');
});
