// One-off script: deploy srmd-hub to Vercel by pre-uploading each file via
// /v2/files then creating a deployment via /v13/deployments. Bypasses the
// Vercel CLI's multi-step upload that's been failing from this terminal.

const fs = require('fs')
const path = require('path')
const crypto = require('crypto')
const https = require('https')

const TOKEN = process.env.VERCEL_TOKEN
const TEAM = 'team_NkGMOBgMNKLQx54XUDPqfLLg'
const PROJECT = 'srmd-hub'

if (!TOKEN) { console.error('Set VERCEL_TOKEN env var'); process.exit(1) }

const SKIP_DIR = new Set(['node_modules', '.next', '.vercel', '.git', '.turbo'])
const SKIP_FILE = new Set(['.env', '.env.local'])

function walk(dir) {
  const out = []
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.isDirectory() && SKIP_DIR.has(e.name)) continue
    const p = path.join(dir, e.name)
    if (e.isDirectory()) out.push(...walk(p))
    else if (e.isFile()) {
      if (SKIP_FILE.has(e.name)) continue
      out.push(p)
    }
  }
  return out
}

function sha1(buf) {
  return crypto.createHash('sha1').update(buf).digest('hex')
}

function request(opts, body) {
  return new Promise((resolve, reject) => {
    const req = https.request(opts, res => {
      const chunks = []
      res.on('data', c => chunks.push(c))
      res.on('end', () => {
        const text = Buffer.concat(chunks).toString('utf8')
        resolve({ status: res.statusCode, headers: res.headers, body: text })
      })
    })
    req.on('error', reject)
    if (body) req.write(body)
    req.end()
  })
}

async function uploadFile(buf, sha) {
  const res = await request({
    method: 'POST',
    host: 'api.vercel.com',
    path: `/v2/files?teamId=${TEAM}`,
    headers: {
      Authorization: `Bearer ${TOKEN}`,
      'Content-Type': 'application/octet-stream',
      'Content-Length': buf.length,
      'x-vercel-digest': sha,
    },
  }, buf)
  if (res.status !== 200 && res.status !== 201) {
    throw new Error(`Upload failed (${res.status}): ${res.body.slice(0, 200)}`)
  }
}

async function main() {
  const root = process.cwd()
  const allFiles = walk(root)
  console.log(`Found ${allFiles.length} files. Uploading…`)

  const fileList = []
  let uploadedSize = 0

  for (let i = 0; i < allFiles.length; i++) {
    const fullPath = allFiles[i]
    const rel = path.relative(root, fullPath).replace(/\\/g, '/')
    const buf = fs.readFileSync(fullPath)
    const sha = sha1(buf)

    let attempts = 0
    while (true) {
      try {
        await uploadFile(buf, sha)
        break
      } catch (e) {
        attempts++
        if (attempts > 3) throw e
        console.log(`  retry ${attempts} for ${rel}: ${e.message.slice(0, 80)}`)
        await new Promise(r => setTimeout(r, 1000 * attempts))
      }
    }

    uploadedSize += buf.length
    fileList.push({ file: rel, sha, size: buf.length })
    if ((i + 1) % 25 === 0 || i === allFiles.length - 1) {
      console.log(`  ${i + 1}/${allFiles.length}  (${(uploadedSize / 1024).toFixed(1)} KB)`)
    }
  }

  console.log('All files uploaded. Creating deployment…')

  const body = JSON.stringify({
    name: PROJECT,
    project: PROJECT,
    target: 'production',
    files: fileList,
    projectSettings: { framework: 'nextjs' },
  })

  const res = await request({
    method: 'POST',
    host: 'api.vercel.com',
    path: `/v13/deployments?teamId=${TEAM}&forceNew=1`,
    headers: {
      Authorization: `Bearer ${TOKEN}`,
      'Content-Type': 'application/json',
      'Content-Length': Buffer.byteLength(body),
    },
  }, body)

  console.log(`Deploy create status: ${res.status}`)
  console.log(res.body.slice(0, 600))
}

main().catch(e => { console.error(e); process.exit(1) })
