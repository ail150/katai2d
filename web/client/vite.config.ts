import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
export default defineConfig({plugins:[react()],server:{proxy:{'/api':process.env.KATAI_API_URL||'http://192.168.40.143:8000'}}})
