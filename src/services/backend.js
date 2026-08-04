import { createDrawingRepository } from './drawingRepository'
import { createHttpClient } from './httpClient'
import { createNoopOperationGateway } from './operationGateway'
import { createLocalPointCatalogGateway } from './pointCatalogGateway'
import { createLocalRuntimeGateway } from './runtimeGateway'
import { createTimeService } from './timeService'
import { createWorkspacePointSourceStore } from './workspacePointSourceStore'

const httpClient = createHttpClient({
  baseUrl: String(import.meta.env.VITE_API_BASE_URL || '').trim()
})

// 当前装配仍是纯前端开发模式；后续只需替换这里的适配器，不改画布业务代码。
export const drawingRepository = createDrawingRepository(httpClient)
export const timeService = createTimeService(httpClient)
export const runtimeGateway = createLocalRuntimeGateway()
export const operationGateway = createNoopOperationGateway()
export const pointCatalogGateway = createLocalPointCatalogGateway({
  store: createWorkspacePointSourceStore()
})
