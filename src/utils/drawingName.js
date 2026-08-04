export function drawingComparisonKey(value, caseSensitive = true) {
  const normalized = String(value || '').normalize('NFC')
  return caseSensitive ? normalized : normalized.toLocaleLowerCase('en-US')
}

export function drawingNamesMatch(left, right, caseSensitive = true) {
  return drawingComparisonKey(left, caseSensitive) === drawingComparisonKey(right, caseSensitive)
}
