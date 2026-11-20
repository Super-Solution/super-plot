import { execFileSync } from 'node:child_process'
import { createReadStream, existsSync, statSync } from 'node:fs'
import { createServer, type Server } from 'node:http'
import { extname, join, normalize } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('../..', import.meta.url))
const dist = join(root, 'examples/dist')
const TYPES: Record<string, string> = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml' }
let server: Server

/** Build the examples against the current sources and serve them for the tests (E2E_BASE). */
export async function setup(): Promise<void> {
  execFileSync(process.execPath, [join(root, 'scripts/examples.mjs'), '--build'], { cwd: root, stdio: 'pipe' })
  server = createServer((req, res) => {
    let p = normalize(decodeURIComponent(new URL(req.url ?? '/', 'http://x').pathname)).replace(/^(\.\.[/\\])+/, '')
    if (p.endsWith('/')) p += 'index.html'
    const f = join(dist, p)
    if (!f.startsWith(dist) || !existsSync(f) || !statSync(f).isFile()) return void res.writeHead(404).end('not found')
    res.writeHead(200, { 'content-type': TYPES[extname(f)] ?? 'application/octet-stream' })
    createReadStream(f).pipe(res)
  })
  await new Promise<void>(r => server.listen(0, '127.0.0.1', r))
  const addr = server.address()
  process.env.E2E_BASE = `http://127.0.0.1:${typeof addr === 'object' && addr ? addr.port : 0}`
}

export async function teardown(): Promise<void> {
  await new Promise<void>(r => (server ? server.close(() => r()) : r()))
}
