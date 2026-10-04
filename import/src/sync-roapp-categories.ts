/**
 * Быстрое пакетное обновление категорий номенклатуры из warehouse-items.csv.
 *
 *   SUPABASE_URL=… SUPABASE_SERVICE_ROLE_KEY=… \
 *     npx tsx import/src/sync-roapp-categories.ts --dir import/data/roapp
 */
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import process from 'node:process'

import { createClient } from '@supabase/supabase-js'

import { parseCsv } from './csv.ts'

const CHUNK = 200

function arg(name: string, fallback = '') {
  const index = process.argv.indexOf(name)
  if (index === -1) {
    return fallback
  }
  return process.argv[index + 1] ?? fallback
}

async function main() {
  const url = process.env.SUPABASE_URL?.trim() || process.env.VITE_SUPABASE_URL?.trim()
  const key =
    process.env.SUPABASE_SERVICE_ROLE_KEY?.trim() ||
    process.env.VITE_SUPABASE_SERVICE_ROLE_KEY?.trim()
  if (!url || !key) {
    throw new Error('Нужны SUPABASE_URL и SUPABASE_SERVICE_ROLE_KEY.')
  }

  const dir = path.resolve(arg('--dir', 'import/data/roapp'))
  const csvPath = path.join(dir, 'warehouse-items.csv')
  const text = await readFile(csvPath, 'utf8')
  const { rows } = parseCsv(text)
  if (rows.length === 0) {
    throw new Error(`Пустой файл: ${csvPath}`)
  }

  const byCategory = new Map<string, { name: string; codes: string[] }>()
  for (const row of rows) {
    const code = String(row.code ?? '').trim()
    const categoryCode = String(row.category_code ?? '').trim()
    const categoryName = String(row.category_name ?? row.category_code ?? '').trim()
    if (!code || !categoryCode || !categoryName) {
      continue
    }
    const current = byCategory.get(categoryCode) ?? { name: categoryName, codes: [] }
    current.codes.push(code)
    byCategory.set(categoryCode, current)
  }

  const supabase = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  })

  const { data: setRow, error: setError } = await supabase
    .from('reference_sets')
    .select('id')
    .eq('code', 'inventory_categories')
    .single()
  if (setError || !setRow) {
    throw new Error(setError?.message ?? 'Справочник inventory_categories не найден.')
  }

  const { data: existing, error: existingError } = await supabase
    .from('reference_items')
    .select('id, code, name')
    .eq('set_id', setRow.id)
    .is('parent_id', null)
  if (existingError) {
    throw new Error(existingError.message)
  }
  const peers = existing ?? []

  const categoryIds = new Map<string, string>()
  for (const [categoryCode, meta] of byCategory) {
    const nameKey = meta.name.trim().toLocaleLowerCase('ru')
    const byName = peers.find((row) => row.name.trim().toLocaleLowerCase('ru') === nameKey)
    if (byName) {
      categoryIds.set(categoryCode, byName.id)
      process.stdout.write(`Категория «${meta.name}»: ${byName.id} (уже есть)\n`)
      continue
    }
    const byCode = peers.find((row) => row.code === categoryCode)
    if (byCode) {
      categoryIds.set(categoryCode, byCode.id)
      process.stdout.write(`Категория «${meta.name}»: ${byCode.id} (по коду)\n`)
      continue
    }
    const { data: created, error: createError } = await supabase
      .from('reference_items')
      .insert({
        set_id: setRow.id,
        code: categoryCode,
        name: meta.name.trim(),
        parent_id: null,
        is_system: false,
      })
      .select('id, code, name')
      .single()
    if (createError || !created) {
      throw new Error(createError?.message ?? `Не удалось создать «${meta.name}».`)
    }
    peers.push(created)
    categoryIds.set(categoryCode, created.id)
    process.stdout.write(`Категория «${meta.name}»: ${created.id} (создана)\n`)
  }

  let updated = 0
  for (const [categoryCode, meta] of byCategory) {
    const categoryId = categoryIds.get(categoryCode)
    if (!categoryId) {
      continue
    }
    const uniqueCodes = [...new Set(meta.codes)]
    for (let offset = 0; offset < uniqueCodes.length; offset += CHUNK) {
      const chunk = uniqueCodes.slice(offset, offset + CHUNK)
      const { data, error } = await supabase
        .from('inventory_items')
        .update({ category_id: categoryId })
        .in('code', chunk)
        .select('id')
      if (error) {
        throw new Error(error.message)
      }
      updated += data?.length ?? 0
    }
    process.stdout.write(`«${meta.name}»: обновлено позиций ${uniqueCodes.length}\n`)
  }

  process.stdout.write(`\nГотово. Обновлено строк: ${updated}\n`)
}

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.message : error}\n`)
  process.exitCode = 1
})
