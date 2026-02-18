import { Hono } from 'hono'
import { getCookie, setCookie } from 'hono/cookie'
import { sign, verify } from 'hono/jwt'
// @ts-ignore
import html from './chat.html'
import { verifyToken } from './totp'

export { ChatRoom } from './ChatRoom'


// Environment bindings
type Variables = {
  user: string
}

const app = new Hono<{ Bindings: CloudflareBindings, Variables: Variables }>()

// Middleware to check authentication for /ws
app.use('/ws', async (c, next) => {
  const token = getCookie(c, 'auth')
  if (!token) {
    return c.text('Unauthorized', 401)
  }

  try {
    const payload = await verify(token, c.env.JWT_SECRET || 'fallback_secret', 'HS256')
    // @ts-ignore
    c.set('user', payload.username as string) // Store username in context
    await next()
  } catch (e) {
    return c.text('Unauthorized', 401)
  }
})


// Serve the single page app
app.get('/', (c) => {
  return c.html(html)
})

// Auth endpoint
app.post('/auth', async (c) => {
  const { code } = await c.req.json()
  
  // Verify against secrets
  // We check both secrets.
  const secret1 = c.env.TOTP_SECRET_1 || 'secret1missing'
  const secret2 = c.env.TOTP_SECRET_2 || 'secret2missing'

  // TOTP verification using standalone implementation
  let username = null
  
  // Run checks in parallel
  const [valid1, valid2] = await Promise.all([
    verifyToken(secret1, code),
    verifyToken(secret2, code)
  ])

  if (valid1) {
    username = 'User1'
  } else if (valid2) {
    username = 'User2'
  }

  if (username) {
    // Generate JWT
    const secret = c.env.JWT_SECRET || 'fallback_secret'
    const token = await sign({ username, exp: Math.floor(Date.now() / 1000) + 60 * 60 * 24 * 30 }, secret) // 30 days

    // Set cookie
    setCookie(c, 'auth', token, {
      httpOnly: false, // Allow JS to read it for username display
      secure: true,
      sameSite: 'Strict',
      maxAge: 60 * 60 * 24 * 30,
      path: '/'
    })

    return c.json({ success: true, username })
  }

  return c.json({ error: 'Invalid TOTP code' }, 401)
})

// WebSocket endpoint
app.get('/ws', async (c) => {
  const upgrade = c.req.header('Upgrade')
  if (!upgrade || upgrade !== 'websocket') {
    return c.text('Expected Upgrade: websocket', 426)
  }

  // Get the Durable Object ID for the single main room
  const id = c.env.rooms.idFromName('MainRoom')
  const room = c.env.rooms.get(id)

  // Pass the username to the DO via URL params since headers might be stripped/standardized
  // However, standardized Request object preserves headers usually.
  // But URL search params is safer and explicit for DO.
  // We need to re-construct the request URL to include the username?
  // Actually, we can just fetch the DO with a modified URL.
  const url = new URL(c.req.url)
  // c.get('user') was set by middleware
  // We need to cast 'c' to something that has 'user' or just use 'any' context 
  // Hono context typing is tricky here without explicit Variable definition.
  // @ts-ignore
  const user = c.get('user') as string
  url.searchParams.set('username', user)

  // Forward the request to the Durable Object
  // We use the new Request object to ensure we pass everything correctly
  const newReq = new Request(url.toString(), c.req.raw)
  
  return room.fetch(newReq)
})

export default app
