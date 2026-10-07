// src/setupTests.ts replaces setImmediate with jest.useRealTimers, a function that
// ignores its callback. React's scheduler adopts setImmediate when it exists and
// then never runs its work, so no asynchronous state update ever reaches the DOM
// and a page that loads data stays on "Loading..." for ever in a test. A browser
// uses MessageChannel and is not affected. Import this FIRST in a component test.
import { clearImmediate as realClearImmediate, setImmediate as realSetImmediate } from 'timers';

(globalThis as any).setImmediate = realSetImmediate;
(globalThis as any).clearImmediate = realClearImmediate;
