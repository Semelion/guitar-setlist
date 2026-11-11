import {createRoot} from 'react-dom/client';
import {installLocalApi} from './local-api';
import Home from '../app/page';
import '../app/globals.css';

// Патчим fetch до первого рендера: page.tsx обращается к /api/library только из useEffect.
installLocalApi();

createRoot(document.getElementById('root')!).render(<Home/>);
