// Not a test. src/setupTests.ts replaces global.setImmediate with
// jest.useRealTimers, a function that never calls back. React's scheduler
// prefers setImmediate under jsdom, so every render that happens outside act()
// (anything after an await in a component) is scheduled and never flushed.
// Import this first in any component test that awaits.
import { setImmediate as nodeSetImmediate } from 'timers';

(global as any).setImmediate = nodeSetImmediate;
