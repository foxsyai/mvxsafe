import ReactDOM from 'react-dom/client';
import { settleTrackedTransactions } from 'helpers/settleTrackedTransactions';
import { initApp } from 'lib';
import { App } from './App';
import { config } from './initConfig';

initApp(config).then(() => {
  // After initApp: it watches the store initApp sets up.
  settleTrackedTransactions();
  ReactDOM.createRoot(document.getElementById('root')!).render(<App />);
});
