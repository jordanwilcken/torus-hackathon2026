import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { createPublicGridClient } from './data/createPublicGridClient';
import { DemoWorkspace } from './ui/DemoWorkspace';
import './style.css';
import './ui/DemoApplication.css';

const publicGrid = createPublicGridClient();
const root = document.getElementById('root');
if (!root) throw new Error('The application root is missing.');
createRoot(root).render(<StrictMode><DemoWorkspace grid={publicGrid} /></StrictMode>);
