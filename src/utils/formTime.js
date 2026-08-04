const formats = new Set(['time', 'time-seconds', 'date', 'datetime-local', 'datetime-seconds', 'month', 'week'])

function normalizeTimeFormat(format) {
  return formats.has(format) ? format : 'time'
}

export function timeInputType(format) {
  const normalized = normalizeTimeFormat(format)
  if (normalized === 'time-seconds') return 'time'
  if (normalized === 'datetime-seconds') return 'datetime-local'
  return normalized
}

export function timeInputStep(format, step = 60) {
  const normalized = normalizeTimeFormat(format)
  if (['time-seconds', 'datetime-seconds'].includes(normalized)) return 1
  if (normalized === 'time' || normalized === 'datetime-local') return Math.max(1, Number(step) || 60)
  return 1
}

function pad(value) {
  return String(value).padStart(2, '0')
}

function isoWeek(date) {
  const day = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()))
  const weekday = day.getUTCDay() || 7
  day.setUTCDate(day.getUTCDate() + 4 - weekday)
  const yearStart = new Date(Date.UTC(day.getUTCFullYear(), 0, 1))
  const week = Math.ceil((((day - yearStart) / 86400000) + 1) / 7)
  return `${day.getUTCFullYear()}-W${pad(week)}`
}

export function formatTimeValue(value, format = 'time') {
  const date = value instanceof Date ? value : new Date(value)
  if (Number.isNaN(date.getTime())) return ''
  const year = date.getFullYear()
  const month = pad(date.getMonth() + 1)
  const day = pad(date.getDate())
  const hour = pad(date.getHours())
  const minute = pad(date.getMinutes())
  const second = pad(date.getSeconds())
  switch (normalizeTimeFormat(format)) {
    case 'time-seconds': return `${hour}:${minute}:${second}`
    case 'date': return `${year}-${month}-${day}`
    case 'datetime-local': return `${year}-${month}-${day}T${hour}:${minute}`
    case 'datetime-seconds': return `${year}-${month}-${day}T${hour}:${minute}:${second}`
    case 'month': return `${year}-${month}`
    case 'week': return isoWeek(date)
    default: return `${hour}:${minute}`
  }
}

export function parseTimeValue(value, format = 'time', reference = Date.now()) {
  const normalized = normalizeTimeFormat(format)
  const text = String(value || '').trim()
  const referenceDate = new Date(reference)
  if (!text || Number.isNaN(referenceDate.getTime())) return Number.NaN
  if (normalized === 'time' || normalized === 'time-seconds') {
    const match = /^(\d{2}):(\d{2})(?::(\d{2}))?$/.exec(text)
    if (!match) return Number.NaN
    const date = new Date(referenceDate)
    date.setHours(Number(match[1]), Number(match[2]), Number(match[3] || 0), 0)
    return date.getTime()
  }
  if (normalized === 'month') {
    const date = new Date(`${text}-01T00:00:00`)
    return date.getTime()
  }
  if (normalized === 'week') {
    const match = /^(\d{4})-W(\d{2})$/.exec(text)
    if (!match) return Number.NaN
    const year = Number(match[1])
    const week = Number(match[2])
    const januaryFourth = new Date(year, 0, 4)
    const mondayOffset = (januaryFourth.getDay() || 7) - 1
    const monday = new Date(year, 0, 4 - mondayOffset + (week - 1) * 7)
    monday.setHours(0, 0, 0, 0)
    return monday.getTime()
  }
  const date = new Date(normalized === 'date' ? `${text}T00:00:00` : text)
  return date.getTime()
}

export function resolveTimeValue(node, currentTime = Date.now()) {
  const format = normalizeTimeFormat(node?.timeFormat)
  const now = Number(currentTime) || Date.now()
  if (node?.timeUseServer) {
    if (node.timeRunning) return formatTimeValue(now, format)
    return String(node.timeFrozenValue || node.defaultValue || node.value || formatTimeValue(now, format))
  }
  const baseValue = String(node?.defaultValue || node?.value || formatTimeValue(now, format))
  if (node?.timeMode !== 'elapsed' || !node?.timeRunning) return baseValue
  const baseTime = parseTimeValue(baseValue, format, now)
  const startedAt = Number(node.timeStartedAt) || now
  if (!Number.isFinite(baseTime)) return formatTimeValue(now, format)
  return formatTimeValue(baseTime + Math.max(0, now - startedAt), format)
}
