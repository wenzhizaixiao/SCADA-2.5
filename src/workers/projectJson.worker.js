import {
  createPreparedProjectChunkMessages,
  executeProjectJsonOperation,
  serializeProjectJsonOperationError,
  usesPreparedProjectChunkResponse
} from '../utils/projectJsonOperations.js'
import {
  createPreparedWorkspaceSessionChunkMessages,
  executeWorkspaceSessionJsonOperation,
  usesPreparedWorkspaceSessionChunkResponse,
  WORKSPACE_SESSION_JSON_OPERATION
} from '../utils/workspaceSessionJsonOperations.js'

self.onmessage = async event => {
  const id = event.data?.id
  try {
    if (event.data?.operation === WORKSPACE_SESSION_JSON_OPERATION) {
      const value = await executeWorkspaceSessionJsonOperation(event.data)
      if (value && usesPreparedWorkspaceSessionChunkResponse(event.data)) {
        for (const message of createPreparedWorkspaceSessionChunkMessages(value)) {
          self.postMessage({ id, ok: true, ...message })
        }
        return
      }
      self.postMessage({ id, ok: true, value })
      return
    }
    const value = executeProjectJsonOperation(event.data)
    if (usesPreparedProjectChunkResponse(event.data)) {
      for (const message of createPreparedProjectChunkMessages(value)) {
        self.postMessage({ id, ok: true, ...message })
      }
      return
    }
    self.postMessage({ id, ok: true, value })
  } catch (error) {
    self.postMessage({ id, ok: false, error: serializeProjectJsonOperationError(error) })
  }
}
