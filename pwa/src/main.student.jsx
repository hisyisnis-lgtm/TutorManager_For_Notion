import React from 'react';
import ReactDOM from 'react-dom/client';
import StudentApp from './StudentApp.jsx';
import ErrorBoundary from './components/ui/ErrorBoundary.jsx';
import { installErrorReporter } from './utils/errorReporter.js';
import './index.css';

installErrorReporter();
ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode><ErrorBoundary><StudentApp /></ErrorBoundary></React.StrictMode>,
);
