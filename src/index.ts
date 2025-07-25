import { Hono } from 'hono'
import { initializeDatabase } from './tools/database/db.js'
import { cors } from 'hono/cors'
import { serveStatic } from '@hono/node-server/serve-static'

// 導入路由模塊
import healthRoutes from './routes/health.js'
import authRoutes from './routes/auth.js'
import emailRoutes from './routes/need_token/email.js'
import modifydocxRoutes from './routes/modifydocx.js'

const app = new Hono()

app.use('/*', cors())

// 初始化資料庫
initializeDatabase()

// 提供靜態文件服務 - 將 src/tools/html 映射到 /html
app.use('/html/*', serveStatic({ 
    root: './src/tools/',
    rewriteRequestPath: (path) => path.replace(/^\/html/, '/html')
}))

// 正確的路由註冊方式
app.route('/', healthRoutes)        // /health
app.route('/auth', authRoutes)      // /auth/google, /auth/google/callback
app.route('/email', emailRoutes)
app.route('/api', modifydocxRoutes) // /api/modifydocx, /api/docx-files, /api/docx-download/:filename, /api/docx-delete/:filename

export default {
    port: 3000,
    fetch: app.fetch,
    development: true,
    idleTimeout: 60,
}