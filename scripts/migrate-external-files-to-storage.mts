/**
 * Migrate external file URLs into Supabase Storage and rewrite DB references.
 *
 * Scope:
 * - document_templates.body / documents.body — embed images → document-template-assets
 * - order_attachments kind=url with downloadable files → order-attachments
 *
 * Safety:
 * - Never deletes rows or storage objects
 * - Keeps original external URL on order_attachments.url after conversion
 * - Idempotent: skips URLs already pointing at this project's storage
 * - Writes a JSON report under tmp/
 *
 * Usage:
 *   npx tsx scripts/migrate-external-files-to-storage.mts
 *   npx tsx scripts/migrate-external-files-to-storage.mts --dry-run
 */
import { createHash, randomUUID } from 'node:crypto'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { createClient, type SupabaseClient } from '@supabase/supabase-js'

const __dirname = dirname(fileURLToPath(import.meta.url))
const ROOT = join(__dirname, '..')
const DRY_RUN = process.argv.includes('--dry-run')

const DOC_BUCKET = 'document-template-assets'
const ORDER_BUCKET = 'order-attachments'
const MIGRATION_PREFIX = 'migrated-external'
const ROAPP_HOST_FALLBACKS = ['store.roapp.io', 'storage.roapp.io', 'storage.remonline.app'] as const

type Json = string | number | boolean | null | Json[] | { [key: string]: Json }

type UrlMap = Map<string, string>

type Report = {
  startedAt: string
  finishedAt?: string
  dryRun: boolean
  supabaseHost: string
  assets: { sourceUrl: string; publicUrl: string; path: string; bytes: number; contentType: string }[]
  templatesUpdated: { id: string; name: string; replacements: number }[]
  documentsUpdated: { id: string; replacements: number }[]
  attachmentsUpdated: {
    id: string
    orderId: string
    fileName: string | null
    kind: string
    path: string
    sourceUrl: string
  }[]
  attachmentFailures: { id: string; orderId: string; fileName: string | null; url: string; error: string }[]
  skippedAlreadyOurs: number
  errors: string[]
}

function loadEnv(): Record<string, string> {
  const raw = readFileSync(join(ROOT, '.env'), 'utf8')
  const out: Record<string, string> = {}
  for (const line of raw.split('\n')) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) continue
    const i = trimmed.indexOf('=')
    if (i < 0) continue
    const key = trimmed.slice(0, i)
    let value = trimmed.slice(i + 1)
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1)
    }
    out[key] = value
  }
  return out
}

function isOurStorageUrl(url: string, storageHost: string): boolean {
  try {
    const parsed = new URL(url)
    return parsed.host === storageHost && parsed.pathname.includes('/storage/v1/object/')
  } catch {
    return false
  }
}

function isExternalHttp(url: string, storageHost: string): boolean {
  if (!/^https?:\/\//i.test(url.trim())) return false
  return !isOurStorageUrl(url.trim(), storageHost)
}

const URL_RE = /https?:\/\/[^\s"'<>\\)]+/gi

function extractUrls(text: string): string[] {
  const out: string[] = []
  for (const match of text.matchAll(URL_RE)) {
    out.push(match[0].replace(/[.,;:!?)]+$/, ''))
  }
  return out
}

function walkCollectUrls(value: Json, found: string[] = []): string[] {
  if (value == null) return found
  if (typeof value === 'string') {
    found.push(...extractUrls(value))
    return found
  }
  if (Array.isArray(value)) {
    for (const item of value) walkCollectUrls(item as Json, found)
    return found
  }
  if (typeof value === 'object') {
    for (const item of Object.values(value)) walkCollectUrls(item as Json, found)
  }
  return found
}

function replaceUrlsInString(text: string, map: UrlMap): { text: string; count: number } {
  let count = 0
  const next = text.replace(URL_RE, (raw) => {
    const cleaned = raw.replace(/[.,;:!?)]+$/, '')
    const trailing = raw.slice(cleaned.length)
    const mapped = map.get(cleaned)
    if (!mapped) return raw
    count += 1
    return mapped + trailing
  })
  return { text: next, count }
}

function replaceUrlsInJson(value: Json, map: UrlMap): { value: Json; count: number } {
  if (value == null) return { value, count: 0 }
  if (typeof value === 'string') {
    const replaced = replaceUrlsInString(value, map)
    return { value: replaced.text, count: replaced.count }
  }
  if (Array.isArray(value)) {
    let count = 0
    const next = value.map((item) => {
      const result = replaceUrlsInJson(item as Json, map)
      count += result.count
      return result.value
    })
    return { value: next, count }
  }
  if (typeof value === 'object') {
    let count = 0
    const next: Record<string, Json> = {}
    for (const [key, item] of Object.entries(value)) {
      const result = replaceUrlsInJson(item as Json, map)
      count += result.count
      next[key] = result.value
    }
    return { value: next, count }
  }
  return { value, count: 0 }
}

function extensionFromUrlOrType(url: string, contentType: string | null, fileName: string | null): string {
  const fromName = fileName?.match(/(\.[a-zA-Z0-9]{1,8})$/)?.[1]?.toLowerCase()
  if (fromName) return fromName
  try {
    const path = new URL(url).pathname
    const fromPath = path.match(/(\.[a-zA-Z0-9]{1,8})$/)?.[1]?.toLowerCase()
    if (fromPath) return fromPath
  } catch {
    /* ignore */
  }
  const mime = (contentType ?? '').split(';')[0].trim().toLowerCase()
  const byMime: Record<string, string> = {
    'image/png': '.png',
    'image/jpeg': '.jpg',
    'image/jpg': '.jpg',
    'image/webp': '.webp',
    'image/gif': '.gif',
    'image/heic': '.heic',
    'image/heif': '.heic',
    'application/pdf': '.pdf',
    'application/zip': '.zip',
    'application/msword': '.doc',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document': '.docx',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': '.xlsx',
    'application/vnd.ms-excel': '.xls',
  }
  return byMime[mime] ?? '.bin'
}

function normalizeMime(contentType: string | null, ext: string): string {
  const mime = (contentType ?? '').split(';')[0].trim().toLowerCase()
  if (mime && mime !== 'application/octet-stream' && mime !== 'application/xml' && mime !== 'text/plain') {
    return mime === 'image/jpg' ? 'image/jpeg' : mime
  }
  const byExt: Record<string, string> = {
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.webp': 'image/webp',
    '.gif': 'image/gif',
    '.heic': 'image/heic',
    '.pdf': 'application/pdf',
    '.zip': 'application/zip',
    '.doc': 'application/msword',
    '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    '.xls': 'application/vnd.ms-excel',
  }
  return byExt[ext] ?? 'application/octet-stream'
}

function attachmentKindFor(mime: string, ext: string): 'photo' | 'pdf' {
  if (mime.startsWith('image/') || ['.png', '.jpg', '.jpeg', '.webp', '.gif', '.heic'].includes(ext)) {
    return 'photo'
  }
  // Non-image office/archives are stored as downloadable files; UI uses signed URL for both photo/pdf.
  return 'pdf'
}

function candidateDownloadUrls(sourceUrl: string): string[] {
  let pathname = ''
  try {
    const parsed = new URL(sourceUrl.trim().replace(/\?+$/, ''))
    pathname = parsed.pathname
  } catch {
    return [sourceUrl]
  }
  if (
    pathname.includes('/media/company-assets/') ||
    /roapp\.io|remonline\.app/.test(sourceUrl)
  ) {
    // Prefer currently live RoApp CDN host first, then legacy hosts.
    return [
      ...new Set(
        ROAPP_HOST_FALLBACKS.map((host) => `https://${host}${pathname}`).concat([
          sourceUrl.trim().replace(/\?+$/, ''),
          sourceUrl,
        ]),
      ),
    ]
  }
  return [sourceUrl.trim().replace(/\?+$/, ''), sourceUrl]
}

async function downloadBytes(sourceUrl: string): Promise<{
  bytes: Uint8Array
  contentType: string | null
  finalUrl: string
}> {
  let lastError = 'unreachable'
  for (const url of candidateDownloadUrls(sourceUrl)) {
    try {
      const res = await fetch(url, {
        redirect: 'follow',
        headers: {
          'User-Agent': 'EndotekaExternalFileMigration/1.0',
          Accept: '*/*',
        },
      })
      if (!res.ok) {
        lastError = `${res.status} ${url}`
        continue
      }
      const contentType = res.headers.get('content-type')
      // RoApp often returns XML/HTML error bodies with 200 on wrong host — guard tiny XML.
      const buf = new Uint8Array(await res.arrayBuffer())
      if (buf.byteLength < 64) {
        const text = new TextDecoder().decode(buf)
        if (text.includes('<?xml') || text.includes('<Error') || text.includes('<html')) {
          lastError = `empty/error body ${url}`
          continue
        }
      }
      if (
        contentType?.includes('application/xml') &&
        buf.byteLength < 2048 &&
        new TextDecoder().decode(buf).includes('<Error')
      ) {
        lastError = `xml error ${url}`
        continue
      }
      return { bytes: buf, contentType, finalUrl: url }
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error)
    }
  }
  throw new Error(lastError)
}

async function fetchAll<T>(
  client: SupabaseClient,
  table: string,
  columns: string,
  pageSize = 1000,
): Promise<T[]> {
  const rows: T[] = []
  let from = 0
  for (;;) {
    const { data, error } = await client.from(table).select(columns).range(from, from + pageSize - 1)
    if (error) throw new Error(`${table}: ${error.message}`)
    rows.push(...((data ?? []) as T[]))
    if (!data || data.length < pageSize) break
    from += pageSize
  }
  return rows
}

async function ensureAsset(
  client: SupabaseClient,
  sourceUrl: string,
  storageHost: string,
  projectUrl: string,
  cache: UrlMap,
  report: Report,
): Promise<string> {
  const existing = cache.get(sourceUrl)
  if (existing) return existing
  if (isOurStorageUrl(sourceUrl, storageHost)) {
    cache.set(sourceUrl, sourceUrl)
    report.skippedAlreadyOurs += 1
    return sourceUrl
  }

  const downloaded = await downloadBytes(sourceUrl)
  const ext = extensionFromUrlOrType(sourceUrl, downloaded.contentType, null)
  const mime = normalizeMime(downloaded.contentType, ext)
  const hash = createHash('sha256').update(downloaded.bytes).digest('hex').slice(0, 16)
  const path = `${MIGRATION_PREFIX}/${hash}${ext}`

  if (!DRY_RUN) {
    const { error: uploadError } = await client.storage.from(DOC_BUCKET).upload(path, downloaded.bytes, {
      contentType: mime,
      upsert: true,
      cacheControl: '31536000',
    })
    if (uploadError) throw new Error(`upload ${path}: ${uploadError.message}`)
  }

  const publicUrl = `${projectUrl.replace(/\/$/, '')}/storage/v1/object/public/${DOC_BUCKET}/${path}`
  cache.set(sourceUrl, publicUrl)
  report.assets.push({
    sourceUrl,
    publicUrl,
    path,
    bytes: downloaded.bytes.byteLength,
    contentType: mime,
  })
  return publicUrl
}

async function migrateDocumentBodies(client: SupabaseClient, storageHost: string, projectUrl: string, report: Report) {
  const cache: UrlMap = new Map()

  const templates = await fetchAll<{ id: string; name: string; body: Json }>(
    client,
    'document_templates',
    'id, name, body',
  )
  for (const row of templates) {
    const external = [...new Set(walkCollectUrls(row.body).filter((u) => isExternalHttp(u, storageHost)))]
    if (external.length === 0) continue
    for (const url of external) {
      await ensureAsset(client, url, storageHost, projectUrl, cache, report)
    }
    const replaced = replaceUrlsInJson(row.body, cache)
    if (replaced.count === 0) continue
    if (!DRY_RUN) {
      const { error } = await client
        .from('document_templates')
        .update({ body: replaced.value, updated_at: new Date().toISOString() })
        .eq('id', row.id)
      if (error) throw new Error(`document_templates ${row.id}: ${error.message}`)
    }
    report.templatesUpdated.push({ id: row.id, name: row.name, replacements: replaced.count })
    console.log(`template ${row.name}: ${replaced.count} url(s)`)
  }

  const documents = await fetchAll<{ id: string; body: Json }>(client, 'documents', 'id, body')
  let docProgress = 0
  for (const row of documents) {
    const external = [...new Set(walkCollectUrls(row.body).filter((u) => isExternalHttp(u, storageHost)))]
    if (external.length === 0) continue
    for (const url of external) {
      await ensureAsset(client, url, storageHost, projectUrl, cache, report)
    }
    const replaced = replaceUrlsInJson(row.body, cache)
    if (replaced.count === 0) continue
    if (!DRY_RUN) {
      const { error } = await client.from('documents').update({ body: replaced.value }).eq('id', row.id)
      if (error) throw new Error(`documents ${row.id}: ${error.message}`)
    }
    report.documentsUpdated.push({ id: row.id, replacements: replaced.count })
    docProgress += 1
    if (docProgress % 25 === 0) {
      console.log(`documents updated ${docProgress}…`)
    }
  }
  console.log(`documents updated total: ${report.documentsUpdated.length}`)
}

async function migrateOrderAttachments(client: SupabaseClient, storageHost: string, report: Report) {
  const rows = await fetchAll<{
    id: string
    order_id: string
    kind: string
    file_path: string | null
    file_name: string | null
    mime_type: string | null
    url: string | null
  }>(client, 'order_attachments', 'id, order_id, kind, file_path, file_name, mime_type, url')

  const targets = rows.filter(
    (row) => row.kind === 'url' && row.url && isExternalHttp(row.url, storageHost) && !row.file_path,
  )
  console.log(`order_attachments to migrate: ${targets.length}`)

  let i = 0
  for (const row of targets) {
    i += 1
    const sourceUrl = row.url!
    try {
      const downloaded = await downloadBytes(sourceUrl)
      const ext = extensionFromUrlOrType(sourceUrl, downloaded.contentType, row.file_name)
      const mime = normalizeMime(downloaded.contentType, ext)
      const kind = attachmentKindFor(mime, ext)
      const path = `${row.order_id}/${randomUUID()}${ext}`

      if (!DRY_RUN) {
        const { error: uploadError } = await client.storage.from(ORDER_BUCKET).upload(path, downloaded.bytes, {
          contentType: mime,
          upsert: false,
        })
        if (uploadError) throw new Error(uploadError.message)

        // Keep original external URL in `url` for audit; constraint allows it for photo/pdf.
        const { error: updateError } = await client
          .from('order_attachments')
          .update({
            kind,
            file_path: path,
            file_name: row.file_name || `file${ext}`,
            mime_type: mime,
            file_size: downloaded.bytes.byteLength,
            url: sourceUrl,
          })
          .eq('id', row.id)
        if (updateError) {
          // Roll forward: leave uploaded object (safe); record failure for retry/manual.
          throw new Error(updateError.message)
        }
      }

      report.attachmentsUpdated.push({
        id: row.id,
        orderId: row.order_id,
        fileName: row.file_name,
        kind,
        path,
        sourceUrl,
      })
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      report.attachmentFailures.push({
        id: row.id,
        orderId: row.order_id,
        fileName: row.file_name,
        url: sourceUrl,
        error: message,
      })
      console.warn(`attachment fail ${row.id}: ${message}`)
    }
    if (i % 20 === 0) {
      console.log(
        `attachments ${i}/${targets.length} ok=${report.attachmentsUpdated.length} fail=${report.attachmentFailures.length}`,
      )
    }
  }
}

async function verify(client: SupabaseClient, storageHost: string) {
  const templates = await fetchAll<{ id: string; body: Json }>(client, 'document_templates', 'id, body')
  const documents = await fetchAll<{ id: string; body: Json }>(client, 'documents', 'id, body')
  let remainingDocs = 0
  for (const row of [...templates, ...documents]) {
    const external = walkCollectUrls(row.body).filter((u) => isExternalHttp(u, storageHost))
    remainingDocs += external.length
  }
  const attachments = await fetchAll<{ id: string; kind: string; url: string | null; file_path: string | null }>(
    client,
    'order_attachments',
    'id, kind, url, file_path',
  )
  const remainingUrlKind = attachments.filter(
    (row) => row.kind === 'url' && row.url && isExternalHttp(row.url, storageHost),
  ).length
  console.log(`verify remaining external urls in template/doc bodies: ${remainingDocs}`)
  console.log(`verify remaining kind=url external attachments: ${remainingUrlKind}`)
  return { remainingDocs, remainingUrlKind }
}

async function main() {
  const env = loadEnv()
  const projectUrl = (env.VITE_SUPABASE_URL || env.SUPABASE_URL || '').trim()
  const serviceKey = (env.VITE_SUPABASE_SERVICE_ROLE_KEY || env.SUPABASE_SERVICE_ROLE_KEY || '').trim()
  if (!projectUrl || !serviceKey) {
    throw new Error('Need VITE_SUPABASE_URL and VITE_SUPABASE_SERVICE_ROLE_KEY (or SUPABASE_*).')
  }

  const storageHost = new URL(projectUrl).host
  const client = createClient(projectUrl, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  })

  const report: Report = {
    startedAt: new Date().toISOString(),
    dryRun: DRY_RUN,
    supabaseHost: storageHost,
    assets: [],
    templatesUpdated: [],
    documentsUpdated: [],
    attachmentsUpdated: [],
    attachmentFailures: [],
    skippedAlreadyOurs: 0,
    errors: [],
  }

  console.log(`Migrating external files → storage (${DRY_RUN ? 'DRY RUN' : 'LIVE'}) @ ${storageHost}`)

  await migrateDocumentBodies(client, storageHost, projectUrl, report)
  await migrateOrderAttachments(client, storageHost, report)

  if (!DRY_RUN) {
    await verify(client, storageHost)
  }

  report.finishedAt = new Date().toISOString()
  mkdirSync(join(ROOT, 'tmp'), { recursive: true })
  const reportPath = join(
    ROOT,
    'tmp',
    `migrate-external-files-${DRY_RUN ? 'dry-run-' : ''}${Date.now()}.json`,
  )
  writeFileSync(reportPath, JSON.stringify(report, null, 2))
  console.log(`\nReport: ${reportPath}`)
  console.log(
    JSON.stringify(
      {
        dryRun: DRY_RUN,
        assets: report.assets.length,
        templatesUpdated: report.templatesUpdated.length,
        documentsUpdated: report.documentsUpdated.length,
        attachmentsUpdated: report.attachmentsUpdated.length,
        attachmentFailures: report.attachmentFailures.length,
      },
      null,
      2,
    ),
  )

  if (report.attachmentFailures.length > 0) {
    process.exitCode = 2
  }
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
