import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { StarterFlow } from './ui/StarterFlow';
import './style.css';

const root = document.getElementById('root');
if (!root) throw new Error('The application root is missing.');

createRoot(root).render(
  <StrictMode>
    <main>
      <h1>Sunchaser</h1>
      <p>Compute coordinated with Torus energy.</p>
      <StarterFlow />
    </main>
  </StrictMode>,
);
