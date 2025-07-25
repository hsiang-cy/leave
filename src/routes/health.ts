import { Hono } from 'hono'

const health = new Hono()

health.get('/health', (c) => c.text('功能正常'))

export default health