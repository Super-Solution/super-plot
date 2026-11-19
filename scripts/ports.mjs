// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 SUPER SOLUTION LABS INC
// Tests (and optionally fuzzes) the Go and Python ports against the reference implementation.
//   node scripts/ports.mjs            conformance tests of both ports
//   node scripts/ports.mjs --fuzz     also compare ~190k random numbers and 15k random specs (3 seeds)
// A missing toolchain fails the run, so the gate never passes by skipping a port. SKIP_PORTS=1 skips on purpose.
import { execFileSync, spawnSync } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const root = new URL('..', import.meta.url).pathname
if (process.env.SKIP_PORTS) { console.log('ports: skipped (SKIP_PORTS)'); process.exit(0) }
const fuzz = process.argv.includes('--fuzz')
let failed = false

function run(name, cmd, args, cwd, env = {}) {
  const r = spawnSync(cmd, args, { cwd, encoding: 'utf8', env: { ...process.env, ...env } })
  if (r.error) { console.error(`  x ${name}: ${r.error.code === 'ENOENT' ? `${cmd} is not installed` : r.error.message}`); failed = true; return '' }
  if (r.status !== 0) { console.error(`  x ${name}\n${r.stdout}${r.stderr}`); failed = true; return '' }
  const last = (r.stdout + r.stderr).trim().split('\n').slice(-1)[0]
  console.log(`  ok ${name}: ${last}`)
  return r.stdout
}

const py = join(root, 'ports/python')
const go = join(root, 'ports/go')
run('python conformance', 'python3', ['-m', 'unittest', 'discover', '-s', 'tests'], py, { PYTHONPATH: 'src' })
run('go conformance', 'go', ['test', '-count=1', './...'], go)
run('go vet', 'go', ['vet', './...'], go)

if (fuzz) {
  const dir = mkdtempSync(join(tmpdir(), 'super-plot-fuzz-'))
  try {
    for (const seed of [7, 2026, 90210]) {
      const file = join(dir, `cases-${seed}.json`)
      execFileSync('node', [join(root, 'ports/fuzz/generate.mjs'), String(seed), file], { stdio: 'inherit' })
      run(`python fuzz ${seed}`, 'python3', [join(root, 'ports/fuzz/check.py'), file], py)
      run(`go fuzz ${seed}`, 'go', ['run', './cmd/fuzzcheck', file], go)
    }
  } finally { rmSync(dir, { recursive: true, force: true }) }
}
if (failed) process.exit(1)
console.log('ports OK')
