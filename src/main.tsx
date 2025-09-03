import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import { HashRouter, Routes, Route, Navigate } from 'react-router-dom'
import App from './App.tsx'
import { Home } from './routes/Home'
import { Layout } from './routes/Layout'
import { Scanner } from './routes/Scanner'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <HashRouter>
      <Routes>
        <Route element={<Layout />}> 
          <Route path="/" element={<Home />} />
          <Route path="/observatories" element={<App />} />
          <Route path="/scanner" element={<Scanner />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Route>
      </Routes>
    </HashRouter>
  </StrictMode>,
)

// Register the service worker (production only)
if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    const swUrl = `${import.meta.env.BASE_URL}sw.js`;
    navigator.serviceWorker.register(swUrl).catch((err) => {
      console.error('SW registration failed:', err);
    });
  });
}
