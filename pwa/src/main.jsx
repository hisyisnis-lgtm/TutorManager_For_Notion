import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App.jsx';
import { installErrorReporter } from './utils/errorReporter.js';
import './index.css';

installErrorReporter();

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
