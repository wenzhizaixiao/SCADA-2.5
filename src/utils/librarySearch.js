function normalizedSearchText(value) {
  return String(value ?? '').trim().toLocaleLowerCase('zh-CN')
}

export function filterPaperEntries(entries, query) {
  const source = Array.isArray(entries) ? entries : []
  const normalizedQuery = normalizedSearchText(query)
  if (!normalizedQuery) return source
  return source.filter(entry => [entry?.title, entry?.targetName]
    .some(value => normalizedSearchText(value).includes(normalizedQuery)))
}
