import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { Core } from './core/Core';
import './style.css';

const root = document.getElementById('root');
if (!root) throw new Error('The application root is missing.');

createRoot(root).render(
  <StrictMode>
    <Core />
  </StrictMode>,
);
