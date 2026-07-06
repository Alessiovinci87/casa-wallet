import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import dayjs from 'dayjs'
import 'dayjs/locale/it'
import './index.css'
import App from './App.jsx'

// Date e nomi dei mesi in italiano in tutta l'app.
dayjs.locale('it')

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
