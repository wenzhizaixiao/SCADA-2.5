export function isImeCompositionEvent(event, compositionActive = false) {
  return Boolean(
    compositionActive ||
    event?.isComposing ||
    event?.target?.composing ||
    event?.key === 'Process' ||
    Number(event?.keyCode) === 229 ||
    Number(event?.which) === 229
  )
}
