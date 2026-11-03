import { Navigate, Route, Routes } from 'react-router-dom'
import { Layout } from './components/Layout'
import { BriefsPage } from './pages/Briefs'
import { ChatPage } from './pages/Chat'
import { MasterPromptPage } from './pages/MasterPrompt'
import { SettingsPage } from './pages/Settings'

export function App() {
  return (
    <Layout>
      <Routes>
        <Route path="/" element={<ChatPage />} />
        <Route path="/prompt" element={<MasterPromptPage />} />
        <Route path="/briefs" element={<BriefsPage />} />
        <Route path="/briefs/:date" element={<BriefsPage />} />
        <Route path="/settings" element={<SettingsPage />} />
        <Route path="*" element={<Navigate to="/briefs" replace />} />
      </Routes>
    </Layout>
  )
}
