import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import App from './App.tsx'
import { Home } from './routes/Home'
import { Layout } from './routes/Layout'
import { Scanner } from './routes/Scanner'
import { BridgePlanner } from './routes/BridgePlanner'
import { AuthProvider } from './components/AuthProvider'
import { RequireAccess } from './components/RequireAccess'
import { AuthCallback } from './routes/AuthCallback'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <BrowserRouter>
      <AuthProvider>
        <Routes>
          <Route element={<Layout />}>
            <Route path="/" element={<Home />} />
            <Route path="/auth/callback" element={<AuthCallback />} />
            <Route path="/observatories" element={<RequireAccess tool="observatories"><App /></RequireAccess>} />
            <Route path="/scanner" element={<RequireAccess tool="scanner"><Scanner /></RequireAccess>} />
            <Route path="/bridge-planner" element={<RequireAccess tool="bridgePlanner"><BridgePlanner /></RequireAccess>} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Route>
        </Routes>
      </AuthProvider>
    </BrowserRouter>
  </StrictMode>,
)
