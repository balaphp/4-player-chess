import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import { AdminGate } from './components/AdminGate';
import { ResetPage } from './components/ResetPage';
import './styles.css';

// The admin console is not linked anywhere in the player UI: it is reachable
// only by navigating to /admin directly (and still requires an admin account).
const path = window.location.pathname;
const isAdminRoute = path === '/admin' || path.startsWith('/admin/');
const isResetRoute = path === '/reset';
if (isAdminRoute) document.title = 'Four Chess — Admin';

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>{isAdminRoute ? <AdminGate /> : isResetRoute ? <ResetPage /> : <App />}</React.StrictMode>,
);
