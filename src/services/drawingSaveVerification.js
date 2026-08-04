export async function verifyDrawingSave({ name, expectedEtag, loadCurrent, metadataCache }) {
  metadataCache.invalidate(name)
  try {
    const current = await loadCurrent()
    if (!current || current.etag !== expectedEtag) return null
    return {
      name,
      size: current.buffer.length,
      modifiedAt: current.fileStat.mtime.toISOString(),
      etag: current.etag
    }
  } finally {
    // A listing can repopulate the cache while the post-write verification is reading.
    metadataCache.invalidate(name)
  }
}
