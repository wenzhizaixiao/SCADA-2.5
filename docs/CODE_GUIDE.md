# 苔岑2D绘图代码文档

## 1. 技术栈与启动

- Vue 3 Composition API
- Vite
- Lucide Vue 图标
- SVG 负责连线和自由路径，HTML/CSS 负责节点与属性面板

```bash
npm install
npm run dev
npm run build
```

开发地址默认由 Vite 输出，当前使用 `http://localhost:4173/`。

## 2. 目录结构

```text
src/
├── App.vue                         # 编辑器会话编排、画布命令和界面面板
├── main.js                         # Vue 入口及全局样式
├── style.css                       # 基础界面样式
├── enhancements.css                # 多边形描边、动画和增强样式
├── components/
│   ├── BrandMark.vue               # 顶部品牌图标
│   ├── MiniMapPreview.vue          # 鹰眼、缩略图、编辑 LOD 和自适应预览 Canvas
│   ├── NodeVisual.vue              # 编辑态与预览态共用的节点视觉
│   ├── PreviewDrawingBatch.vue     # 渐进预览中的稳定线稿批次
│   ├── PreviewEdgeBatch.vue        # 渐进预览中的稳定连线批次
│   ├── PreviewNodeBatch.vue        # 稳定 key 的预览节点批次
│   ├── ProgressivePreviewGeometry.vue # 按帧递增的预览连线与线稿层
│   ├── ProgressivePreviewNodes.vue # 按帧递增的预览 DOM 窗口
│   └── RuntimeValueText.vue        # 不触发父树刷新的运行值叶子订阅
├── composables/
│   ├── useRuntimeData.js           # 活跃键过滤、跨批 latest-wins 和逐帧发布
│   └── useSharedVisualClock.js     # 多个动画组件共享的单主循环时钟
├── config/
│   └── componentCatalog.js         # 工具、组件分类、名称和新建默认值
├── models/
│   └── editorModel.js              # 节点、表格、连线及旧图纸归一化
├── services/                        # 后台访问端口和当前适配器
├── workers/
│   ├── largeSelectionTransform.worker.js # 大选区几何计算 Worker
│   ├── edgeRaster.worker.js        # 超密静态连线的 OffscreenCanvas 栅格 Worker
│   └── projectJson.worker.js        # 图纸解析、校验、迁移、归一化与分块回传 Worker
└── utils/                           # 几何、索引、历史和分片渲染纯工具
    ├── canvasSurfaceCommit.js       # 可见 Canvas 的 union clip 单次 copy 提交
    ├── canvasTextReadability.js     # 低倍率文字可读字号及原布局约束
    ├── canvasViewport.js            # 缩放和视口坐标换算
    ├── chunkedRenderScheduler.js    # 有预算的 Canvas 分片、取消和原子提交
    ├── documentIndexes.js           # 图层分配、dataKey 反向表和连线邻接索引
    ├── edgeInteractionPolicy.js     # 高出度节点每帧相邻边预算
    ├── editorLod.js                 # 低倍率编辑触发、命中、前景上限与局部降级裁剪
    ├── editorLodGeometry.js         # LOD 操作期几何脏区和分段索引
    ├── edgeRasterDrawing.js         # 主线程与 Worker 共用的逐边绘制及 typed-array 协议
    ├── edgeRasterWorkerClient.js    # 边栅格 Worker 生命周期、latest-wins 与故障回退
    ├── entityHistory.js             # 节点、连线和线稿的实体差异历史
    ├── historyPatches.js            # 字段、列表和图层差异的捕获与应用
    ├── incrementalTextLayout.js     # 长文本字素、换行和测量的可恢复分片
    ├── interactionCommitBarrier.js  # 活动交互代次和后台提交恢复门禁
    ├── largeSelectionTransform.js   # 大选区同步几何基准实现
    ├── largeSelectionTransformTask.js # 大选区可恢复分片算法
    ├── nodeBundleTransactions.js    # 组件包捕获、实例准备及私有索引
    ├── previewBitmapBudget.js       # 自适应预览动态位图像素预算
    ├── previewFrameFreshness.js     # 预览文档/请求/提交世代与帧新鲜度门禁
    ├── previewMountBudget.js        # 预览节点复杂度估算与逐帧挂载预算
    ├── pointCatalogPreparation.js   # 大点位目录私有分片准备、取消与原子安装
    ├── sourceConnectionList.js      # 数据源连接的一次扫描统计、筛选、分组与显示语义
    ├── projectRuntimePreparation.js # 大图完整私有运行索引的 4ms 分片准备与原子交接
    ├── runtimeCanvasDirtyQueue.js   # 运行键到 Canvas 节点的 512 分批队列
    ├── runtimeCanvasRegions.js      # 运行值 Canvas 脏区累加、合并和位图映射
    ├── runtimeCanvasStrategy.js     # sparse/dense 运行值绘制策略门禁
    ├── runtimeUpdatePipeline.js     # 运行批次边界、公平轮转与跨批 latest-wins
    ├── runtimeValueFormat.js        # 长度、深度和条目数有界的运行值格式化
    ├── spatialIndex.js              # 大画布实体的有界均匀网格索引
    ├── tableVirtualization.js       # 大表格行列窗口、合并单元格和动态行高
    └── textLayout.js                # 横排/竖排字素布局的同步基准语义
```

`App.vue` 只负责编排会话状态和用户命令，不再维护组件目录或复制节点归一化实现。新增组件类型时优先修改 `componentCatalog.js`；新增持久化字段或兼容旧 JSON 时修改 `editorModel.js`；几何计算继续放在 `utils/`；网络请求只能从 `services/` 进入。该边界让目录配置、数据兼容和页面交互可以分别测试，后续接入后台不会反向污染画布模型。

中文注释用于说明兼容边界、共享状态、性能取舍、并发和生命周期等不能从语法直接看出的原因。命名已经足够清晰的赋值、循环和模板绑定不逐行添加注释，避免注释与实现脱节。

## 3. 图纸数据模型

节点的核心结构：

```js
{
  id: 1710000000000,
  type: 'gauge',
  x: 320,
  y: 180,
  w: 120,
  h: 120,
  rotate: 0,
  text: '压力',
  textLayout: 'horizontal',
  fill: '#ffffff',
  stroke: '#16b89a',
  color: '#28323c',
  radius: 6,
  visualScaleX: 1,
  visualScaleY: 1,
  groupId: null,
  locked: false,
  animation: 'flow',
  dataKey: 'device.pressure'
}
```

文本节点使用 `textLayout: 'horizontal' | 'vertical'` 保存排布方式。`baseNodeOptions()` 默认横向，`normalizeNode()` 通过 `normalizeTextLayout()` 只保留合法竖向值，其余值均回退横向，因此没有该字段的旧图纸、恢复缓存和“我的”模板会自然保持历史横排。该字段属于带默认值的增量节点属性，不提升 `PROJECT_VERSION`；当前格式版本继续为 `20`，避免触发与版本号绑定的旧直线迁移。

连线结构：

```js
{ id, from, to, color, width, dash, startMarker, endMarker, anchorMode }
```

`from` 是第一次选择的起点组件，`to` 是第二次选择的目标组件。`startMarker` 和 `endMarker` 支持 `none`、`arrow`、`circle`、`square`，`anchorMode` 支持 `edge` 和 `center`。`edgeEndpoints()` 在边缘模式下根据两个节点的中心方向计算旋转矩形边界交点，在中心模式下直接使用组件中心；编辑态和预览态共用同一组端点和 SVG 标记，端口颜色继承连线颜色。图纸属性中的连线设置通过 `applyLineSettingsToEdges()` 同时覆盖已有连线，并作为新连线默认值。

自由绘制路径结构：

```js
{ id, points: [{ x, y }], color, width, dash, opacity, smooth, closed, locked, lineCap, lineJoin }
```

完成后的多点线段同样是普通节点，路径点使用节点内部 `0–1` 归一化坐标：

```js
{
  type: 'polyline',
  x, y, w, h, rotate,
  polylinePoints: [{ x: 0.08, y: 0.72 }, { x: 0.34, y: 0.28 }, { x: 0.92, y: 0.24 }],
  polylineColor: '#485563',
  polylineOpacity: 1,
  polylineStyle: 'solid',
  borderDashLength: 8,
  borderDashGap: 6,
  borderVisible: false,
  stroke: '#26323d',
  borderWidth: 0,
  polylineWidth: 2,
  polylineArrowSize: 8,
  polylineStartMarker: 'none',
  polylineEndMarker: 'arrow',
  polylineLineCap: 'round',
  polylineLineJoin: 'round'
}
```

`polylinePoints` 是线段几何的唯一持久化真值，每两个相邻点组成一段，因此分段数始终由 `polylinePoints.length - 1` 推导，不保存重复字段。新线段根据起点和终点默认生成 `4` 个等长段、`5` 个节点；属性栏允许设置 `1–9999` 段，修改已弯折线段时由 `resamplePolylinePoints()` 沿当前折线路径按累计弧长重采样，不会恢复成直线。点数上限由 `MAX_POLYLINE_NODE_POINTS` 统一约束，旧图纸继续直接读取原有点数组，无需版本迁移。

`polylineStyle` 支持 `solid/dashed/dotted`，并复用直线的 `borderDashLength/borderDashGap` 与轮廓字段；旧节点只有 `polylineDash` 时由 `normalizeNode()` 自动迁移。`polylineStartMarker/polylineEndMarker` 分别控制整条路径首端和末端，当前支持 `none` 与 `arrow`；`polylineArrowSize` 以逻辑像素独立控制两端箭头大小，范围为 `1–100`，不得再由 `polylineWidth` 或轮廓宽度实时推导。新节点默认 `8px`；旧节点缺少该字段时先按原公式计算并固化一次，保持历史外观，随后修改线宽不再改变箭头。`polylineLineCap` 支持 `round/butt/square`，`polylineLineJoin` 支持 `round/bevel/miter`。这类节点不是连接两个组件的 `edge`，也不是“基本形状”中的 `lineShape` 直线，三个模型不能互相复用 ID 或端点语义。

节点通过可选的 `groupId` 表示持久化组合关系；相同非空 `groupId` 的节点属于同一组。组合不是额外的容器节点，因此成员仍保留各自坐标、尺寸、类型、图层、旋转角和连线端点。`visualScaleX/visualScaleY` 分别记录组合横向、纵向变换累积到成员内容层的倍率，默认均为 `1`，两者可以不同；解绑只清除成员的 `groupId`，不会删除节点、连线、成员角度或两轴视觉倍率。

“我的”自定义组件保存在图纸顶层 `customComponents`：

```js
{
  id,
  name,
  width,
  height,
  nodes: [{ ...node, x: relativeX, y: relativeY }],
  edges: [{ ...edge, from: templateNodeId, to: templateNodeId }],
  createdAt
}
```

模板节点的 `x/y` 使用模板左上角为原点，`edges` 只保存两个端点都位于模板内的内部连线。模板保存完整节点属性，但实例化时必须为节点、连线和多节点组合重新生成 ID；不能复用画布中的实体 ID，也不能保留对模板外节点的连线引用。

点击“添加为我的”时，`addSelectionToMyLibrary()` 只生成独立的模板草稿并打开命名弹窗，不调用 `commit()`。`confirmCustomComponent()` 在名称非空且容量校验通过后才提交历史并写入 `customComponents`；取消弹窗只丢弃草稿。名称继续使用 `uniqueCustomComponentName()` 去重，因此用户输入重名时不会覆盖已有模板。

命名弹窗不能直接使用无条件的 `@keydown.enter.prevent`，否则中文输入法用 Enter 确认候选时会被当成模板提交。所有会提交或结束编辑的 Enter 处理必须先识别组合输入：`event.isComposing`、`event.key === 'Process'`、`event.keyCode === 229`、`event.which === 229` 或 `event.target.composing` 任一成立时立即忽略；`compositionstart/compositionend` 同步维护目标输入框的组合状态。命名弹窗在 Vue 完成 DOM 挂载的 `nextTick` 后立即聚焦，不再延迟到动画帧；输入框只停止自身处理的普通 Enter 或 Escape，Shift、Ctrl+Space、Process 等输入法切换和组合按键必须保持原生传播及默认行为。工作空间名称输入及画布内联文字编辑复用同一组合输入守卫；其他按键继续冒泡，使输入法和 `Ctrl+S` 等全局快捷键保持可用。

文本组件右侧“文字编辑 > 内容”保持普通 `v-model`，由 Vue 自带的 composition 处理阻止拼音中间态提前写回，不再并行维护另一套中文草稿。画布双击后的内联输入框单独记录组合态，只有非组合态的普通 Enter 或 Escape 才结束编辑。内联输入框挂载后使用 `focus({ preventScroll: true })` 建立输入法上下文，再用 `setSelectionRange(0, value.length)` 选择原文字；不要改回原生 `.select()`，也不要额外延迟到 `requestAnimationFrame`。两个输入框都保留 `lang="zh-CN"` 和 `inputmode="text"`，且不得用无条件 `keydown.stop` 拦截 Shift、Ctrl+Space 或 Process。

“我的”卡片和命名弹窗直接把模板 `nodes/edges` 交给 `MiniMapPreview.vue` 绘制，不在图纸中保存 bitmap/data URL。自定义模板使用 `fit-mode="contain"` 在固定预览区域内保持原始宽高比并居中；主鹰眼也显式使用 `contain`，但额外启用 `faithful` 并通过共享几何同时校正视口框和点击坐标。卡片使用适合窄列的 `64 × 54` Canvas；`.my-component-preview canvas` 固定 `width: 64px`、使用 `height: auto`，并保留 `max-width/max-height: 100%`，让容器空间不足时高度跟随宽度按位图固有比例缩小。不能只限制 Canvas 宽度并保留固定 CSS 高度，否则卡片会横向压缩；也不能把宽度设为 `auto`，否则高 DPI 位图会按内部像素宽度放大并产生纵向裁切。`.minimap-preview` 本身保持普通文档流，只有 `.minimap-stage > .minimap-preview` 在鹰眼中使用绝对定位；弹窗与卡片不能继承鹰眼的铺满定位，否则 Canvas 会越过自身预览框。旧图纸只有 `name/nodes/edges` 即可直接显示缩略图，无需迁移。

文本节点的缩略内容必须读取原始 `node.text`，包括中文正文，不能复用结构列表或属性面板顶部的固定名称“文本”。`MiniMapPreview.vue` 的小尺寸可读文字策略必须是显式启用且默认关闭的缩略图能力，只由“添加为我的”命名弹窗和“我的”卡片调用；它只调整缩略画布中的文字可见性和排版取舍，不修改节点数据、组件名称或实例化结果。普通画布鹰眼不启用 `preferText`，而是使用 `faithful` 保持画布文字的原始字号、样式和裁切，并通过 `contain` 坐标映射保持真实比例。`node.text` 必须继续进入缩略图的响应式重绘依赖，使正文修改后命名预览、卡片和鹰眼可以刷新。

`.my-component-grid` 的桌面布局固定为两列、`7px` 间距，`.my-component-item` 高度固定为 `118px`；`800px` 以下改为单列。这里不能直接复用普通 `.shape-grid` 的三列 `70px` 单元，因为还要同时容纳真实组合缩略图、名称、组件数量和删除按钮。卡片根节点必须继续保留拖拽、双击、Enter/Space 添加接线，删除按钮必须隔离 pointer、双击、键盘和 click 事件，避免删除时误实例化模板；名称被省略时通过卡片 `title` 提供完整提示。

图纸文档数据和运行时设备数据是分离的。设备值不会进入 `nodes`，因此不会污染保存文件和撤销历史。

### 后台服务边界

`App.vue` 不直接调用 `fetch`。`src/services/backend.js` 创建并导出四个业务端口：

```js
drawingRepository.list(context)
drawingRepository.get(name, context)
drawingRepository.save(name, serialized, { etag, create, context })
drawingRepository.delete(name, etag, context)
drawingRepository.exists(name, context)
timeService.current({ context })
runtimeGateway.connect({ protocol, url, getKeys })
runtimeGateway.disconnect()
runtimeGateway.subscribe(handler)
operationGateway.record(type, contextProvider)
```

`httpClient` 统一处理 `VITE_API_BASE_URL`、15 秒默认超时、JSON/文本响应、`ApiRequestError`、未来鉴权头和 `credentials`。图纸仓储的列表、读取、保存、删除和 HEAD 存在性探针都显式关闭这个固定超时；其他普通请求仍使用默认值。仓储必须继续对图纸名称执行 `encodeURIComponent`，新建使用 `If-None-Match: *`，更新和删除使用精确 ETag。业务层只读取仓储返回的 `serialized/etag/size/modifiedAt`，不能再依赖原始 `Response`，这样未来切换 REST、RPC 或桌面桥接实现时不改画布流程。

Vite 本地图纸服务通过 `drawingRequestBody.js` 和文件读取门禁统一执行单图读写上限：默认 `DEFAULT_DRAWING_REQUEST_LIMIT_BYTES = 256 * 1024 * 1024`，只允许用正整数环境变量 `TC2D_MAX_DRAWING_BYTES` 覆盖。磁盘文件必须在 stat 后、`readFile` 前比较大小；列表忽略超限文件，直接打开返回 `413`，保存冲突校验与删除读取同样不得先加载超限内容。该检查必须早于 metadata 缓存命中。`PUT` 还要先校验 `application/json`、未压缩请求体和合法 `Content-Length`；已声明长度超限在分配内存前返回 `413`，chunked 请求在单缓冲累计超过上限时立即返回 `413`。不得恢复 `chunks + Buffer.concat` 的双份峰值，也不得把 localStorage 或 20MB 视频阈值复用为图纸上限。

图纸列表的 metadata/ETag 由 `drawingMetadataCache.js` 按 stat 签名缓存。同一签名只执行一次读取、UTF-8/JSON 和结构校验；直接 GET 可以 `set()` 当前条目，删除调用 `invalidate()`，列表结束调用 `retain()` 清理已消失文件。保存不得直接信任刚写入的 Buffer：`drawingSaveVerification.js` 在原子写后重新读取并核对期望 ETag，而且在验证前后都 `invalidate()`，避免并发列表在验证窗口重新填入旧 metadata；核对失败返回 `409`。`shouldCacheError` 只接受确定性的 `HttpError(422)`，使未变化的无效大文件命中负缓存；I/O、权限和读取竞态错误必须删除缓存并在下次重试，文件 stat 签名变化也必须绕过旧正/负缓存。

条件保存的 `412` 有两种业务语义，不能合并成“图纸已被修改或存在同名文件”。新建请求携带 `If-None-Match: *` 且目标已存在，表示同一图纸库位置的名称冲突，服务端必须保留原文件并提示用户改名或先删除同名文件；已有文件请求携带 `If-Match` 且 ETag 不匹配，才表示版本冲突，提示用户重新打开后再保存。两者继续使用标准 HTTP `412 Precondition Failed`，前端结合当前会话是否已有项目文件身份（`existingTarget`）提供对应兜底文案，不能因状态码相同而静默覆盖或自动改名。

`backendRequestContext()` 返回 `{ workspaceId, projectId, revision }`。当前本地图纸适配器明确忽略它，不改变现有 `/api/drawings` URL；未来生产仓储负责映射资源路径。该上下文不是可信身份，`tenantId/userId` 必须由服务端会话或经验证令牌取得。前端不得把客户端提交的用户字段当权限条件。

`runtimeGateway` 是连接与协议边界，所有进入 `useRuntimeData()` 的消息必须先归一化为 `{ key, value }[]`，同一消息中的重复键只保留最后值。当前 `createLocalRuntimeGateway()` 只生成模拟数据；真实 WebSocket、MQTT 或 HTTP 适配器实现相同的 `connect/disconnect/send/subscribe` 契约，并保持一张图纸共享连接。

`operationGateway` 当前为零开销空适配器，`commit()` 只提交一个惰性的 `document.change` 历史检查点。它为后续低频审计或协作操作协议预留入口，不表示已实现操作回放；生产适配器应批量、限频和脱敏，不能在 `pointermove` 中上传图纸快照。浏览器文件选择器属于用户授权的本地文件能力，继续由 `openOtherDrawing()/writeCustomDrawing()` 独立处理，不能与服务器仓储共用权限语义。

## 4. 核心流程

### 画布尺寸

`stageWidth/stageHeight` 是图纸画布的真实 CSS 像素尺寸，编辑与预览共用。图纸属性中的宽、高输入分别调用 `normalizeFixedCanvasSize('width')` 和 `normalizeFixedCanvasSize('height')`，再把轴参数传给 `normalizeCanvasSize(dimension)`；单轴输入只归一化当前字段，禁止顺带重写另一字段。尺寸预设和“使用当前屏幕尺寸”需要同时处理宽高时，继续调用不带轴参数的 `normalizeCanvasSize()`。`useCurrentScreenSize()` 把 `screen.width/screen.height` 和窗口水平方向的 `innerWidth/outerWidth` 交给 `fullscreenViewportSize.js`，识别浏览器常见缩放档位并预估原生全屏 CSS 视口，一次性写入图纸；屏幕数据不可用时回退为 `innerWidth/innerHeight`。除用户手动设置、选择预设和点击该按钮外，预览生命周期不得修改图纸宽高；加载和新建流程只能安装已有或默认文档尺寸。

### 组件添加

左侧普通组件调用 `dragStartItem` 写入类型，画布 `dropItem` 将屏幕坐标转换为逻辑坐标，最后由 `addNode` 创建统一节点结构。“我的”模板走独立拖拽数据类型，拖放或双击时以目标点为模板左上角实例化全部节点，再根据旧 ID 到新 ID 的映射重建内部连线；多节点模板分配新的 `groupId` 并把新实体放到当前图层顶部。模板实例化完成后通过集合归一化一次性约束整套节点，不能逐个夹取 `x/y`，否则靠近画布边界时会破坏模板内部的相对布局。

模板、剪贴板和快速复制共用 `nodeBundleTransactions.js`。包超过 64 个节点或 128 条内部连线时，捕获、稳定图层排序、深层可变数据克隆、ID/组合映射、归一化、响应式实例创建、历史计量和私有索引构建必须通过 `createChunkedRenderScheduler()` 按 `2ms` 分片；小包才允许调用同步准备函数。常用“我的组件”和剪贴板包由 `queueBundlePrewarm()` 在空闲帧准备一次性实例，命中后 `commitPreparedNodeBundle()` 只附加本批私有索引、raw push 实体并统一发布，不能复制已有 Map 或实体数组。冷大包先写入 `pendingBundleInsertion` 显示目标占位框，准备完成后才原子发布；不得为了隐藏占位把全部准备工作塞回 `dropItem()`。

所有异步组件包任务必须携带 `documentVersion` 和 `interactionGeneration`。`interactionCommitBarrier` 覆盖指针、缩放、滚动、连线和线段起点拖动；跨过任一活动交互的捕获或索引压实只能按 key 延后到干净恢复帧，过期实例发布必须丢弃或按当前代次重试。后台任务不能仅比较文档版本，因为指针按下到抬起之间文档版本可能不变。

`lineShape` 继续注册在“基本形状”，按普通组件添加；`polyline` 只注册在独立“线段”分类。线段必须通过组件库拖拽启动：`dragStartItem()` 写入 `shape=polyline`，`dropItem()` 命中该类型后切换到 `activeTool === 'polyline'`，并把拖拽落点交给 `addPolylinePoint()` 作为草稿起点，不能调用 `addNode()` 创建默认形状。起点显示为固定屏幕尺度的较大锚点，草稿期间允许通过 `startPolylineStartPointDrag()` 反复拖动精调。下一次画布左键单击确定终点，系统立即生成默认 `4` 个等长段并完成节点，然后切回选择工具；该落点即使位于现有组件上也必须优先完成线段。组件库的单击和双击处理都忽略 `polyline`，完成或取消后锚点随草稿清除，下一条线段必须重新拖拽。

要增加组件：

1. 在 `groups` 中注册组件入口。
2. 在 `shapeDefaults` 中定义默认文字和尺寸。
3. 在 `NodeVisual.vue` 中增加专用视觉；普通几何图形只需 CSS class。
4. 如需默认动画，在 `animationDefaults` 中增加映射。

### 移动、缩放和旋转

普通单击未选节点建立单选；已形成多选时直接按下任一已选节点会保留全部 `selectedNodeIds`，只更新主节点，因此可以拖动整个多选范围。`Ctrl/Cmd/Shift + 左键`通过 `selectedNodeIds` 增减多选成员。选择工具在空白区域按下时建立 `selectionMarquee`，按逻辑坐标持续更新框选范围；携带 `Ctrl/Cmd/Shift` 时把操作开始前的选择作为追加基线，否则先清空。点击或框选命中带有 `groupId` 的节点时，选择范围扩展到该组全部成员。单选节点由同级 `.single-node-transform-box` 按逻辑 `x/y/w/h` 渲染，并应用与节点相同的 `rotate(...)`，使轮廓持续贴合组件；八个手柄随控制框定位到旋转后的边和角，自身视觉按节点角度反向旋转，光标由 `resizeHandleCursor()` 映射到真实缩放方向。多选或组合状态仍由 `.group-transform-box` 根据 `selectedNodeBounds` 渲染一套统一变换入口，成员只保留轻量虚线轮廓，避免出现多套相互冲突的变换入口。

`operation` 是当前指针操作状态：

- `move`：记录起点和节点初始位置。
- `moveNodes`：记录组合或多选成员 ID、初始坐标和共同指针起点。
- `resizeNodes`：记录整体初始边界、成员初始位置与尺寸、缩放方向和成员最小尺寸约束。
- `rotateNodes`：记录整体中心、起始弧度以及各成员初始中心、尺寸和旋转角。
- `selectNodes`：记录框选起点、追加选择前的节点 ID 和主节点；移动时更新选择框及命中结果。
- `pan`：记录指针起点和画布初始滚动位置。
- `resize`：记录方向、初始位置、尺寸和旋转角。
- `rotate`：记录节点中心、起始弧度和初始角度。
- `polylinePoint`：记录线段节点索引、旋转前框架、局部点数组及 `x/y/w/h/polylinePoints` 字段快照。
- `draw`：记录当前自由路径 ID。

所有 `pointermove` 由 `requestAnimationFrame` 合并，每个浏览器帧最多更新一次。

多选成员超过 128 个时设置 `transientLargeSelection`。指针移动阶段只更新 `largeSelectionPreviewBounds`，不能逐帧写入全部成员；`pointerUp()` 后由 `largeSelectionTransform.worker.js` 计算移动、缩放或旋转的最终成员几何。Worker 创建、发送或运行失败时必须切换到 `createLargeSelectionTransformTask()`，并用 `runLargeSelectionTransformTaskSlice()` 按 `LARGE_SELECTION_COMMIT_BUDGET_MS = 2` 分片推进，禁止调用同步全量函数兜底。结果应用、节点空间索引和关联连线空间索引也按 `2ms` 分片；`largeSelectionCommitPending` 期间透明屏障和键盘入口阻止第二条命令，全部 raw 几何、索引和历史一致后才统一 `triggerRef` 并结束 `interactionCommitBarrier` 中的指针交互。

大量组件下的视口查询和框选统一通过 `src/utils/spatialIndex.js`。主画布以 `512px` 为单元建立均匀网格，索引边界使用 `rotatedFrameBounds()`，因此旋转后的真实可见范围也能正确命中。打开图纸、切换会话或载入其他完整文档时，`projectRuntimePreparer` 在私有任务内构建新的节点空间索引，并在完整运行 bundle ready 后随实体集合一次安装；空白或其他同步小集合整体替换才可走 `rebuildNodeSpatialIndex()`/`rebuildDocumentIndexes()`。普通撤销重做、移动、缩放、旋转和属性位置修改只通过 `updateNodeSpatialIndex()` 或 `applyNodeSpatialChanges()` 更新受影响节点，样式、文字和运行时数据变化不重建索引。超大背景对象单独保存，避免一个对象占用大量网格桶。查询范围很大时不得遍历理论上的全部空网格：先用 `overallBounds` 拒绝整图外请求，再遍历实际存在的 `buckets` 并筛选坐标范围，防止两个组件簇之间的大空白退化为全量扫描。

`nodeIndex` 是持久的 `shallowRef(Map)`，必须保存 `nodes` 响应式数组中的代理引用。普通新增遵守“先写入数组、再调用 `updateNodeSpatialIndex()`”的顺序；函数只读取与本批数量等长的数组尾段取得代理，并把新 ID 同步登记到节点 Map 和空间索引。实体删除、撤销和重做通过 `applyNodeSpatialChanges()` 同步增删两份索引；整体替换节点数组时，监听器调用 `rebuildNodeIndex()` 和 `rebuildNodeSpatialIndex()` 各重建一次。不得恢复由 `computed(() => new Map(nodes.map(...)))` 派生节点索引，否则每次普通增删都会重新读取全部节点。

文档还维护三类增量索引。`timeNodeIndex` 只保存 `type === 'time'` 的节点，`hasAutomaticTime/hasServerTime` 只能遍历该 Map；`addTimeNodes/removeTimeNodes` 必须与节点新增、删除及实体历史恢复同步。`edgeAdjacency` 同时按边 ID 和起止节点保存边引用，`appendEdges()` 与 `applyEntityHistory()` 只把本批增删交给 `applyChanges()`；可见连线从可见节点集合查询邻接桶，禁止恢复滚动时扫描全部 `edges`。`layerEntries` 是有序 `shallowRef`，新增高层实体直接追加，恢复旧层级时二分插入，删除只移除目标条目。正式整体换图不得先替换集合再同步调用 `rebuildDocumentIndexes()`；`projectRuntimePreparer` 必须按默认 `4ms` 时间片在私有对象上建立节点、线稿、时间、运行键、绑定、空间、邻接、层级游标和图层条目，随后由 `installPreparedEntityCollections()` 一次安装。同步 `replaceEntityCollections()` 仅保留给空白或其他小集合入口。

新层级由 `createLayerAllocator()` 双游标管理。`committedMax` 是已提交实体的最高层，`reservedMax` 是曾经预留到的最高层；`reserve(count)` 必须立即推进 `reservedMax` 并返回连续 `{ start, end }`，即使后续新增失败也不能回滚，否则两个异步入口可能重复取得同一层。`commit(items)` 只读取本批实体并推进已提交游标；打开或切换图纸时 `rebuild()` 扫描完整集合，置顶、置底等全序重排完成后才调用 `reconcile()`。普通拖入、完成铅笔/线段、模板实例化和复制粘贴统一使用 `reserveEntityLayers()`，不得重新引入扫描全图的 `nextLayer()`。

`queryNodesInBounds()` 是视口和框选的统一查询入口。普通倍率编辑、原始尺寸预览和全屏预览只挂载视口附近节点；不足 1,500 个节点时保留 `240px` 屏幕缓冲，达到阈值后使用 `96px`，两者都由 `viewportWorldBounds()` 按当前比例换算为逻辑范围。正在移动、缩放或旋转的节点即使暂时越过查询范围也必须保留，避免操作中 DOM 被卸载。框选先从空间索引取得候选，再用 `nodeSelectionBounds()` 做精确相交判断；命中组合后通过预先派生的 `nodesByGroup` 扩展成员，不能为每个命中节点重新扫描全部组件。节点达到 1,200 且倍率不高于 30% 时，编辑器改用整图 Canvas 底图并只为活动对象保留有界 DOM；普通自适应预览同样由分片 Canvas 显示整张图纸，不再挂载全部节点 DOM。

线段草稿使用独立 `polylineDraft`，不借用连续指针操作 `operation`。拖拽松开时只写入起点，鼠标移动更新起点到候选终点的预览 `hover`，不能提前持久化节点。下一次画布单击确定终点；两个点距离超过当前命中阈值后，`createEvenlySpacedPolylinePoints()` 生成默认 `4` 段的 `5` 个世界坐标点，并立即调用 `finishPolylineDrawing()`。`polylineFrameFromWorldPoints()` 计算包含线宽和箭头空间的紧边界，把世界坐标转为归一化点并一次性生成普通 `polyline` 节点。完成后必须清除草稿并把 `activeTool` 设回 `select`；`Esc`、右键或只有起点时的 `Backspace` 取消并执行相同复位。少于两个不同点时不得生成空节点，任一结束路径之后都不能通过空白画布单击直接开始下一条线段。

`selectNodes` 使用标准化矩形支持从左上到右下或反向拖动。`nodeSelectionBounds()` 把旋转节点换算为轴对齐视觉边界，`framesIntersect()` 采用相交命中，使组件只要有可见区域进入选择框即可选中；命中任一组合成员后再扩展完整 `groupId`。小于约 3 屏幕像素的移动按空白单击处理。`pointerUp()` 清除临时框，`Esc` 恢复操作开始前的选择。选择工具的普通空白拖动专用于框选，画布平移改由 `Alt + 左键`或鼠标中键进入 `pan`，避免两种手势冲突。

`moveNodes` 每帧只计算一次逻辑坐标位移，再把相同位移应用到全部成员，保证组合相对位置不变。`resizeNodes` 通过 `transformNodeCollectionWithinStage()` 从目标可见边界反求世界 `scaleX/scaleY`，再按成员角度同步变换中心、局部宽高和内容倍率；角手柄传入保持宽高比的目标边界，边中手柄和属性栏宽高输入只改变对应世界轴。成员原有 `rotate` 在横纵拉伸期间保持不变。`NodeVisual.vue` 用变换前的逻辑尺寸完成内部布局，再在独立外层应用两轴倍率，因此字体、表格像素行列、表单控件和固定尺寸设备结构会随组合一起缩放或拉伸，不会只改变外框。移动和旋转操作的几何差异必须携带两轴视觉倍率，编辑画布、预览与 `MiniMapPreview.vue` 的缓存依赖也必须包含这两个字段。`rotateNodes` 围绕组合中心旋转每个成员中心，同时累加成员自身角度，按住 `Shift` 时吸附到 `15°`。组合中含锁定成员时整体移动、缩放和旋转都会被阻止，必须先统一解锁。组合、取消组合以及针对当前选择范围的删除、剪切、复制、锁定和图层操作都只提交一次对应的字段或实体历史条目，不能为每个成员分别提交，也不能序列化整张图纸。

集合非均匀缩放必须区分世界轴和成员局部轴。`rotationScaleWeights()` 以 `cos²θ/sin²θ` 返回平行与交叉权重；`rotatedLocalScaleFactors()` 在对数域把世界倍率映射为局部倍率，即局部 X 使用 `scaleX^parallel × scaleY^cross`，局部 Y 使用 `scaleX^cross × scaleY^parallel`。因此 `0°/180°` 保持同轴，`90°/270°` 精确交换轴，任意斜角在不新增 skew/shear 持久化字段的前提下得到连续、可逆的无剪切近似。严禁重新把世界 `scaleX` 直接乘到所有成员 `w/visualScaleX`、把世界 `scaleY` 直接乘到 `h/visualScaleY`，否则旋转 `90°` 的成员会在横向拉伸时沿错误方向变形。

`collectionWorldScaleForFrame()` 不能只使用 `target.w/source.w` 与 `target.h/source.h` 的名义倍率。它应通过 `nodeCollectionVisualBoundsAtScale()` 计算候选成员旋转后的可见 AABB，在对数倍率比上求解目标宽高比，再乘统一倍率命中目标宽度；候选成员按世界轴变换中心、按上述局部倍率变换尺寸，并将最终可见 AABB 左上角对齐目标框。这样组合返回的 `bounds` 与拖拽或属性输入的目标框一致，横线与 `90°` 竖线等相邻成员不会因逻辑框和可见框混用而出现缝隙或重叠。`visualScaleX/visualScaleY` 必须分别按成员最终 `w/sourceWidth`、`h/sourceHeight` 累计；从原框拉伸到目标框再以当前可见框反向收缩到原框，应在浮点容差内恢复每个成员的 `x/y/w/h/rotate/visualScaleX/visualScaleY`，不能随操作轮次漂移。

单个节点和多节点统一选框都提供八个缩放手柄。单节点仍允许独立调整宽高：四角同时改变宽高，四个边中手柄只改变对应方向的尺寸。组合或临时多选的四个角手柄通过 `lockAspectRatio` 保持原始宽高比并固定对角；左右边中手柄只改变整体宽度并固定对边，上下边中手柄只改变整体高度并固定对边。属性栏修改整体宽或高时只改变对应轴，不再同步计算另一轴。集合变换按 `scaleX/scaleY` 分别更新成员中心、尺寸和视觉倍率，成员自身角度保持不变，不新增剪切字段。手柄尺寸按 `zoom` 反向补偿，因此在任意画布缩放比例下都保持一致的屏幕命中区域。单节点控制框仍以逻辑 `x/y/w/h` 为几何来源，不能用旋转后的轴对齐包围盒反推尺寸。`resizeRotatedFrameWithinBounds()` 将指针在画布中的位移投影到节点局部坐标：东/西只改变局部宽度，南/北手柄只改变局部高度，角手柄同时改变两者，并通过中心位移固定相对边或相对角；零角度回退到 `resizeFrameWithinBounds()`。边中手柄使用显式半尺寸偏移，不能依赖会被反向旋转覆盖的 `translateX/Y()`。旋转按钮采用相同的缩放补偿机制，始终保持 `32 × 32px` 可见尺寸和 `48 × 48px` 透明命中区；命中区只向远离选框的一侧和左右扩展，连接杆不接收指针事件，上下缩放手柄位于连接杆之上，避免旋转与缩放入口互相抢占。`rotateHandleBelow()` 比较旋转后两个候选位置与画布四边的可用屏幕空间，空间不足时把按钮和连接杆翻到另一侧。`startResize()` 与 `startSelectedNodesResize()` 都会捕获当前指针，`pointerUp()` 在完成、取消或窗口失焦时释放，避免快速拖动或鼠标离开手柄后中断。右侧属性栏的整体 X、Y、宽、高调用同一套集合平移或分轴变换函数，不单独维护另一份组合几何数据。节点最小尺寸只允许由 `editorGeometry.js` 导出的 `nodeMinimumSize()` 定义：普通组件和铅笔为 `1 × 1px`，直线为 `1 × 0.1px`；归一化、单选拖拽、多选缩放、属性输入、撤销恢复和图纸导入必须复用该规则。每个实际画布节点都包含独立 `.node-move-hit`，命中层固定为 `24 × 24px` 并使用 `scale(var(--inverse-zoom))` 抵消舞台倍率，所以最终屏幕拖动入口始终不小于 `24 × 24px`。画布只继承一个 `--inverse-zoom`，不得恢复为每个节点或多个手柄分别写入动态宽高变量。交互中的表单必须禁用该层，让真实控件继续接收输入；锁定节点保留选中入口但不能启动移动。组件任一屏幕边长小于 `24px` 时，单选框增加 `.compact-resize-handles`，八个手柄外移 `24px` 并取消彼此重叠的透明扩展热区，同时保留 `12 × 12px` 可见按钮，使极小组件的中心拖动入口及四边、四角缩放入口互不覆盖。

组件移动和位置归一化统一以 `rotatedFrameBounds()` 计算的真实可见边界为准，不能直接使用未旋转的逻辑 `x/y/w/h` 判断。普通组件、直线、旋转节点以及组合不论尺寸是否小于、等于或大于画布，均允许向上、下、左、右部分越界。`constrainTranslation()` 对每条轴使用 `reserve = min(24, visualSpan / 2, stageSpan / 2)` 计算保留量：视觉跨度达到 `48px` 时保留 `24px`，不足 `48px` 时保留一半视觉跨度，极小画布下再受画布半轴尺寸限制；直线竖直方向不得使用额外的零坐标夹取。未组合多选分别计算每个成员的允许位移区间并取共同区间，确保每个成员都有可操作区域；正式组合使用组内首个稳定成员作为真实可操作锚点，再向全部成员应用同一位移，避免稀疏组合的空 AABB 跨过画布但所有真实成员都在画布外。节点的 `x/y` 始终表示旋转前逻辑框左上角，因此只要仍满足对应保留量，负逻辑坐标就是合法的持久化状态。

`normalizeNodeCollectionGeometry()` 先在关闭逐节点位置约束的情况下统一清理尺寸和旋转，再按 `groupId` 把正式组合成员作为持久束，并使用稳定锚点计算一次校正位移；模板或粘贴产生的一整套节点可通过整体集合模式共同约束。画布尺寸变更、撤销重做恢复、模板实例化、开始节点操作以及 `prepareProject()` 的保存重开链路必须复用该集合函数，不能在不同入口逐个调用位置归一化。这样可以保证组合和模板成员的相对位置稳定，并使已合法越界的节点在重复归一化、保存和重新加载后保持幂等。

旋转伸缩继续由 `resizeRotatedFrameWithinBounds()` 逐角裁剪增量，并把指针变化投影到组件自身坐标轴；局部宽高上限使用编辑器最大尺寸而不是当前画布单轴尺寸。因此东西、南北和四角手柄可以连续伸缩，松开后再次拖动也不能被未旋转逻辑框提前截断。操作快照、保存和导入必须保留 `rotate`，归一化后的负逻辑坐标再次序列化、加载和归一化不能产生位置跳变。

选中框使用独立的屏幕像素偏移，八个缩放手柄位于旋转后的组件真实边界之外，手柄及透明命中区都不覆盖组件顶点。左右、上下边中手柄分别扩大沿边方向的透明命中区，命中层与可见方块共同反向旋转且保持 `pointer-events: auto`。多个组件通过顶点或边界对齐时，可以直接观察真实交点；手柄仍保持稳定的屏幕尺寸和缩放操作范围。

组合尺寸约束必须保持分轴一致：属性栏 X/Y 调用 `constrainNodeCollectionTranslation()` 执行统一平移，不能借用缩放目标边界；纯直线组合的高度最小值沿用单条直线的 `0.1px`。`selectedNodesScaleLimits()` 必须复用 `rotationScaleWeights()`，分别把局部宽高的最小/最大剩余倍率投影到世界 X/Y；四角手柄另取统一倍率中更严格的一轴，不能让边中世界轴限制继续按未旋转的同名局部轴计算。最大边界由 `selectedNodesMaximumBounds()` 根据每个成员当前 `w/h` 到 `MAX_EDITOR_STAGE_SIZE` 的剩余倍率反推，`transformNodeCollectionWithinStage()` 再执行同样的成员级保护，确保任一成员宽高不超过 `20000px`，保存重载时不会被归一化为不同布局。超大合法组合应以当前尺寸作为操作基线，允许继续缩小，不能在开始操作时强制跳回默认上限。

### 撤销和重做

历史栈只记录差异，不再生成或比较整图 JSON。当前五类条目分别是 `kind: 'geometry'` 几何差异、`kind: 'entities'` 实体增删、`kind: 'fields'` 字段差异、`kind: 'layers'` 图层顺序和 `kind: 'customComponents'` 模板列表差异。属性与表格编辑只捕获目标实体的旧字段；组合、锁定等批量字段命令只捕获受影响节点；连续移动、缩放和旋转由 `pointerGeometryHistory()` 只记录受影响节点的 `x/y/w/h/rotate/visualScaleX/visualScaleY`，旧临时线稿几何操作只记录对应点集。

普通组件、完成铅笔/线段、连接线、复制、粘贴和模板实例化等新增命令调用 `recordEntityInsertion()`；删除节点时记录目标节点及全部关联连线，删除旧线稿时记录目标线稿。实体差异的 `nodes/edges/drawings` 都由以下记录组成：

```js
{
  id,     // 稳定实体 ID
  index,  // 实体在对应数组中的原位置
  value   // null 表示目标状态不存在；非空对象表示按 index 恢复
}
```

`createEntityInsertionEntry()` 为新增实体写入 `value: null`，表示撤销新增时应删除它。`recordEntityRemoval()` 在真正删除前通过 `captureEntityEntry()` 捕获实体完整值和原索引，表示撤销删除时应恢复它。`undo()` 和 `redo()` 应用任何实体差异前都先捕获当前状态作为反向条目，再调用 `applyEntityEntry()` 原位修改数组。当前会话设置 `reuseEntityReferences: true`，被移出数组的 Vue 代理直接进入反向历史；恢复同一对象时不得重新深克隆或调用 normalizer。正常路径先按记录索引直接命中，位置失配时只为目标 ID 建立 Map，并在目标全部找到后停止扫描，不能每次建立完整文档索引。

`applyEntityHistory()` 显式设置 `mutateRawCollections: true`，把连续索引合并为区间后在 Vue raw 数组上批量 `splice`，同时从响应式数组保留实际代理供节点和空间索引使用。全部节点、时间、运行键、空间、邻接、图层和 Canvas 状态同步后，变更过的 `nodes/edges/drawings` 各只 `triggerRef` 一次；调用方若在其他位置启用 raw 模式，也必须承担相同的发布责任。`removeLayerEntries()` 使用稳定原地压实和一次尾部 `splice`，不能恢复为每个目标逐条移动数组。删除还要清理选择、内联文字、表单、表格、按钮消息、待提交视频地址和连线起点等悬空状态；低倍率编辑处于活动状态时，撤销或重做产生的删除必须把本批移除节点、连线和旧线稿传给 `patchRemovedEntities()`，按旧边界局部清掉 Canvas 残影。全部实体差异都要递增文档版本并触发鹰眼刷新。

五类条目共同进入同一历史栈，仍受数量和约 `12MB` 内存上限约束。内存估算由 `historyValueBytes()` 遍历本条差异完成，不能为估算容量临时序列化整张图纸；准备好的大小以 raw 条目为 WeakMap key 缓存，淘汰大型条目时不能再次完整遍历。大字符串按引用保留，不重复创建 JSON 文本。运行时数据、选中状态、缩放比例和面板状态不进入历史。每张图纸会话独立保存撤销栈、重做栈和文件目标；切换图纸时捕获当前会话并恢复目标会话，不能跨图纸撤销。`undo()`/`redo()` 只有在成功取出并应用条目后才调用 `scheduleWorkspaceSessionPersistence()`，使历史和恢复内容一并落盘；空历史不能制造无意义保存。工作空间之间同样隔离，内存 LRU 目标为最近 3 个工作空间，但只能淘汰最新完整快照已由 IndexedDB 成功保存的条目；脏会话或保存失败的最新状态不得为了维持固定数量而释放。

### 右键菜单和图层

节点的 DOM `contextmenu` 事件调用 `openContextMenu`。在当前多选成员上右键会保留完整选择范围；右键未选节点时才同步为对应的单选或组合，然后按范围提供“组合为组件”“取消组合”“添加为我的”和批量命令。单选右键菜单仍显示禁用的“组合为组件（需多选）”，明确入口和前置条件。顶部工具栏的组合按钮常驻显示，少于两个节点时禁用；右侧属性栏在多选时提供相同入口以及整体位置、尺寸和图层操作。当前选择至少包含两个节点时可组合；当前范围包含组合成员时可取消组合；单个节点、多选节点和现有组合都可打开“添加为我的”命名弹窗。快捷键 `Ctrl/Cmd+G` 和 `Ctrl/Cmd+Shift+G` 分别调用 `groupSelectedNodes()` 与 `ungroupSelectedNodes()`。菜单渲染后使用 `getBoundingClientRect()` 测量真实尺寸；空间不足时向左或向上翻转，并限制在 8px 视口边距内。极小窗口通过菜单内部滚动保证所有命令可访问。

所有完成编辑的对象都作为节点持久化唯一的 `layer`，铅笔线稿和多点线段分别对应 `type: 'pencil'` 与 `type: 'polyline'`。画布与预览的 `nodeLayerIndex.get(id)` 直接通过持久 `nodeIndex` 读取实体自身层级，不得为了普通渲染先生成并排序 `layerEntries`。普通新增通过双游标 `reserveEntityLayers()` 常数级预留层级，再由 `appendLayerEntries()` 只登记本批实体；完整重排只允许出现在 `bringFront/sendBack/moveLayer` 等确实改变全序的命令中。复制和粘贴的新对象默认置顶，锁定不改变层级。`drawings` 及 `drawingRenderEntries` 只承载指针尚未抬起的临时铅笔轨迹和旧图纸迁移输入，`polylineDraft` 只承载尚未完成的落点与悬停预览；二者都不能作为完成对象的长期旁路。

节点移动导致连线端点变化时，`edgeInteractionPolicy.js` 先通过邻接索引的 `countFor()` 做有界门禁。相邻边总量不超过 `EDITOR_LOD_INTERACTION_EDGE_LIMIT = 128` 时可在当前帧增量更新；超过时禁止继续枚举全部邻接边，只设置 `documentIndexRebuildRequired`。松手并结束 `interactionCommitBarrier` 后，`documentIndexCompactionScheduler` 以 `2ms` 片段在私有对象上重建节点空间、连线空间和邻接索引，只有文档版本与交互代次仍匹配时才一次替换三份活动索引；不得逐片写入当前索引，也不得因索引没有附加 segment 而忽略强制重建标记。

右侧“结构”列表使用固定 `40px` 行高倒序窗口化渲染。`structureVirtualRows` 根据 `.structure-scroll` 的 `scrollTop/clientHeight` 和上下各 8 行缓冲只生成当前窗口；最高层优先显示通过 `layerEntries[entries.length - index - 1]` 直接反向读取，不得执行 `[...layerEntries].reverse()` 或维护完整 `reversedLayerEntries` 副本。`.structure-virtual-content` 仍按总行数提供完整滚动高度，每个 `.structure-row` 再通过绝对定位移动到真实索引。滚动监听必须保持 `passive`；切换到结构页、重新展开右栏和窗口尺寸变化时调用 `updateStructureViewport()`。CSS 行高与 `STRUCTURE_ROW_HEIGHT` 必须同步，不能在模板中恢复对全部 `layerEntries` 的直接 `v-for`，也不能让画布节点的普通渲染依赖完整列表的重新排序。

通用 `nodeDisplayName()` 保持“非空 `text`、`typeDisplayName` 中文类型名称、未命名组件”的既有回退顺序，并继续用于“添加为我的”等默认命名场景，不能为本次界面展示需求改变其语义。结构列表改用 `structureNodeDisplayName()`：`type === 'text'` 时固定返回“文本”，其他类型再委托给 `nodeDisplayName()`。属性面板顶部不复用结构专用函数；单选分支仅在 `selected.type === 'text'` 时显示“文本”，其他组件继续显示 `selected.text || '图形'`。文本正文仍只由属性面板“文字编辑”的内容项和画布内联编辑器读写。

### 编辑与预览

普通倍率编辑、原始尺寸预览和全屏预览使用 `NodeVisual.vue`；低倍率编辑与普通自适应预览使用 `MiniMapPreview.vue` 的 faithful Canvas 渲染。Canvas 负责静态视觉与增量运行值；自适应模式中的视频、表单、表格、时间控件、`custom*` 动效、非 `none` CSS 动画和其他持续视觉属于 live 节点。低倍率编辑先让高清 detail Canvas 在既有区域、候选和像素预算内执行局部几何 patch，不得再用父层活动实体数量提前截断。若 detail 无法提交，`editorLodDetailFallbackRegions()` 只接受与 committed detail 相交且下层 fallback Canvas 已成功提交的区域；几何和删除分别判断可靠性，拖动只保留最后一次 detail 成功位置与当前 fallback 位置，重叠或接触区域合并。局部反向裁剪使用基础 `polygon(...)` 的默认 nonzero 环绕规则：外框和孔洞采用相反方向，不依赖兼容性较差的 `evenodd` 参数，并同时设置标准与 WebKit 属性。孔洞外继续显示高清背景、网格和组件；即使基础裁剪能力检测失败，也必须保留高清 detail 和活动 DOM 等待权威帧恢复，绝不能整窗隐藏为低清 fallback。fallback 失败、尚未提交或脏区位于 detail 窗口外时继续保留 detail 和活动 DOM；匹配当前会话、世代和修订号的完整 detail 帧提交后清除裁剪并原子恢复。选框、命中壳和操作手柄始终由最上层 DOM 提供，Canvas 可靠且实际可见地提交后活动 `NodeVisual` 暂时隐藏以避免双绘。禁止在可见 detail 层上用拖拽起点到当前位置的大包围盒底色遮罩擦除旧影，也禁止任何兼容分支重新隐藏整个 detail。fallback/detail 的 `committed` 状态必须相互独立，空 patch 计划不得视为 committed。父层调用 request/finish 后必须重新读取 live session，因为同步 `render-error` 可能已把该层标记为失败，旧局部变量不得回写覆盖。空间索引的 `update()` 在边界未变化时必须只替换保留引用并返回 `false`；节点按下时的幂等归一化不能发布新视口修订或让已提交 detail surface 在真正移动前进入 full render。`previewFitPlan` 先收集全部 live 节点 ID，再调用 `previewHybridLayerTail()` 从最高层反向读取最多 `PREVIEW_HYBRID_MAX_DOM_ENTRIES = 24` 个 `layerEntries`；一旦这个有界尾段覆盖全部 live 节点，尾段中的所有 node 和 drawing 都交给独立的持久 `preview-live-plane`，即使其中包含静态实体也不能留在 Canvas 中。`MiniMapPreview` 必须同时通过 `excludedNodeIds` 和 `excludedDrawingIds` 跳过尾段实体，但节点索引仍保留它们以计算连线端点；DOM live plane 不得重复挂载 edges，尾段 drawing 也不得继续由 Canvas 绘制。无法在 24 条内证明安全尾段时必须回退完整 DOM，不能牺牲图层顺序。纯静态自适应在 Canvas ready 后卸载 DOM；安全混合的 live plane 独立于完整 DOM stage，在 fit、原始尺寸和全屏交接时继续承载同一尾段实例；原始尺寸和全屏预览的其余实体继续通过视口虚拟化 DOM 保留交互，并在 DOM ready 后卸载 Canvas、释放 surface。`previewVisibleNodes/previewVisibleEdges/previewVisibleDrawings` 必须返回完整视口查询结果；`PREVIEW_DOM_NODE_LIMIT/PREVIEW_DOM_EDGE_LIMIT/PREVIEW_DOM_DRAWING_LIMIT` 只用于高密度时提前预备 Canvas 装载帧，不能用于截断第 513 个节点或其他超阈值实体。动画 class 在 DOM 编辑和预览中始终挂载，关键帧只改变节点内部视觉层，不修改 `.node-shell` 的位置和变换。编辑态表单默认禁止控件指针事件，保证节点仍可移动、缩放和旋转；双击非表格表单后，`editingFormId` 为该节点增加 `.form-interacting`，恢复其控件交互，选择其他对象或切换工具时退出。文字和非表格表单只接受浏览器原生 `dblclick`，两次独立单击不能由应用自行合成为编辑操作。`moveNodes` 在指针移动不足 `4px` 时保持点击目标且不移动节点，超过阈值后才把指针捕获到画布并继续原有拖动，避免普通点击丢失原生双击，也避免拖动结束误开编辑。表格因内部容器会拦截原生双击，继续使用表格专用的同节点 `650ms` 时间窗和 `12px` 坐标范围兜底，并调用 `openTableDataEditor()`。DOM 预览开放控件交互，并通过 `form-change` 事件将值写回节点。复选框、单选框和开关的透明原生输入覆盖完整控件区域，直接接收点击，不依赖 `label` 的间接事件转发。`.preview-stage-space` 始终保存图纸按 `previewScale` 计算后的占位尺寸；只有普通自适应模式计算 `contain` 比例，普通原始模式和全屏模式都强制比例为 `1` 并从 `(0,0)` 布局。

“使用当前屏幕尺寸”会把 `canvasSizeMode` 设为 `screen`，表示当前宽高来自一次按钮读取；手动修改宽高或选择固定预设会切回 `fixed`。该来源标记随图纸 JSON、工作空间会话和图纸切换一起保存恢复，但不表示后续自动跟随。`fullscreenchange`、`ResizeObserver`、窗口 `resize/focus/visibilitychange`、打开和关闭预览都只能更新 `previewFullscreen/previewViewport/fit` 等临时状态，禁止写入 `stageWidth/stageHeight` 或调用图纸持久化。原始和全屏预览的占位层、DOM 舞台、连线、线稿、组件和 Canvas 都严格使用保存的画布宽高和 `scale(1)`；禁止以视口尺寸临时补足背景，图纸超过视口时保留完整滚动范围。

普通倍率编辑还包含两个受控过渡。加载/恢复、退出预览或持久完整 LOD `true -> false` 时，目标首屏节点超过 `EDITOR_PROGRESSIVE_DOM_NODE_THRESHOLD = 128` 必须先保留 Canvas，再按每帧 `8` 个节点、`64` 挂载成本递增安装 DOM；新世代保留交集并取消旧帧，完成后退出临时 LOD，打开预览时取消后台渐进任务。若当前视口节点未超过完整 LOD 门槛，但连线超过 `EDITOR_DOM_EDGE_LIMIT = 1024`，启用 edge-only LOD：渐进交接完成后的稳态让两张 `MiniMapPreview` 使用 `renderNodes=false/renderDrawings=false`，只承载全部连线；节点、表单、媒体、动画、铅笔和线段继续走完整 DOM，SVG 只保留由真实活动 overlay ID 推导的最多 128 条交互边。full/runtime/geometry 三条 Canvas 路径必须共同遵守渲染开关，render plan key 必须区分 `full` 与 `edges`，防止旧模式帧提交。纯 edge-only 帧不需要节点运行值增量基线；`commitRenderTask()` 只有在 `renderNodes || renderDrawings || geometryInteractive` 时才可保留 static/composite surface，禁止为只绘边模式长期占用无用的双离屏面。

节点移动跨过 `4px` 阈值时只设置 `operation.nodeMoveInteractionActive`，不得改写 `node.opacity`。DOM 节点外壳通过 `nodeMoveInteractionOpacity()` 使用 `NODE_MOVE_INTERACTION_OPACITY = 0.62`；fallback/detail 的 `editorLodGeometryPayload()` 把同一乘数传给 `MiniMapPreview`，Canvas 再通过 `multiplyOpacity(node.opacity, multiplier)` 与用户透明度相乘。`pointerUp()` 必须在排空最后一帧前先调用 `deactivateNodeMoveInteraction()`；大选区完成、失败与取消、文档重置、工作空间切换和组件卸载也必须走等价清理，不能让透明状态进入历史、持久化或下一张图纸。新增渲染路径时必须同时覆盖 DOM、fallback 和 detail 三路测试。

`editorLodRemovalCoverRegions()` 的删除区域上限固定为 `EDITOR_LOD_MAX_REMOVAL_COVER_REGIONS = 32`。未到上限时只合并接触区域；达到上限后，缓存现有区域的成对新增覆盖面积和每行最优伙伴，并让每个新区域与缓存的全局最优对共同竞争，选择代价最小的压缩。不得恢复为单个全局 AABB，也不得为了性能丢弃区域。修改该算法时必须同时保留随机差分覆盖不变量和 6,000 分散区域 `<50ms` 性能护栏。

尾段还必须通过 `previewHybridTailDomSafe()` 的单批挂载预算：`PREVIEW_HYBRID_MAX_DOM_NODES = 16`，`PREVIEW_HYBRID_MAX_DOM_COST = 128`，drawing 每个计 `PREVIEW_HYBRID_DRAWING_COST = 4`；任一超限即选择完整 DOM。`previewNodeMountCost()` 的当前成本是：视频 `32`，GIF/APNG/WebP 动态图片计 `24`，`custom*` 或非 `none` 动画计 `12`，普通节点计 `8`，select 为 `10 + min(200, optionCount)`，table 为 `16 + columns × (rows + headerCost)`。Canvas 完整帧 `render-complete` 事件必须回传任务实际使用的 `renderPlanKey`、`excludedNodeIds` 和 `excludedDrawingIds`。`handlePreviewFitRenderComplete()` 先要求事件计划与当前 `previewFitPlan` 的 key、两组有序排除 ID 完全相同，再通过 `previewFrameFreshness.handleRenderComplete()`，之后才能 `commitPreviewFitRenderPlan()`；提交的是 overlay 节点与 drawing 快照，不得直接把仍会变化的 computed 列表当成已提交层。计划变化时旧帧只可请求重绘，不得切换可见层。`invalidateDocument()` 产生的未请求 token 只负责让旧帧失效，`MiniMapPreview` 的普通 props watcher 必须通过 `previewFrameCommitRequested()` 跳过它；80ms 文档防抖结束、目标尺寸变化、ensure 或无防抖的排除计划变化正式调用 `requestDocumentRender()` 后，合法 token 才能启动或抢占完整帧。旧帧 rejection 遇到尚存防抖 timer 时必须等待，不能提前重启；没有 timer 的计划变化必须立即恢复，不能等待旧大图画完。任何直接请求都要消费旧 timer，避免同一文档重复完整帧。关闭预览、切到原始尺寸或进入全屏必须调用统一释放路径清空 committed plan；原始/全屏 DOM ready 后还要卸载 Canvas surface。

Canvas 与 DOM 的安全混合只能存在于上述“Canvas 静态前缀 + DOM 完整尾段”模型中，禁止任意交错多个 DOM 岛。主要风险是图层错序、实体重复/缺失、媒体或表单实例重建、Canvas context 故障导致空白，以及复杂尾段集中挂载；对应防线依次是有界尾段证明、双排除集合、持久 live plane、计划/世代/像素比原子提交、context gate 与 DOM 回退、`24/16/128` 三重门禁。`MiniMapPreview` 发生 `contextlost`、无法取得 2D context、实际像素比不足或提交 token 已失效时必须发出/进入 `render-error`；`handlePreviewFitRenderError()` 先切换到原尺寸 `dom` 并启动完整 DOM 渐进挂载。节点由 `ProgressivePreviewNodes` 处理；edges 与 drawings 由 `ProgressivePreviewGeometry` 处理，首批上限分别为 `64/8`，后续批次根据 `nextTick` 后的实际提交耗时渐进增长，倍率最多为 `4`；已提交批次保持稳定不可变，新世代只保留仍存在的批次并换用最新同 ID 引用。两条子链的完成事件都必须匹配当前 `previewDomGeneration` 和当前源数量；`previewDomReady` 只有在 `previewDomNodesReady && previewDomGeometryReady` 时才为真。`finishPreviewDomHandoff()` 还必须校验 `showPreview`、`previewDomMounted` 与 `previewRenderTarget === 'dom'`，才能进入 `dom-fit`；`closePreview()` 必须先推进 `previewDomGeneration` 再拆卸交接状态，使迟到完成事件失效。context 恢复后只能按新世代重绘，不能继续展示旧或模糊 Canvas。分片 full task 在私有主 surface 和 static surface 上建立的外层 `save()/clip()` 必须在正常提交、supersede、invalidate、异常和卸载的所有释放路径配对 `restore()`；恢复失败要把 `contextRestoreFailed` 保持到最终 release，并禁止同尺寸 surface 返回复用池，不能让第二次检查把失败状态改回可复用。`previewFitPlan` 在预览计划失效时仍会线性检查当前节点以识别 live 类型，但这不属于普通拖入或新层级分配热路径，层级尾段读取本身始终最多 24 条；只有性能采样证明 live 分类成为瓶颈时，才应增加与文档索引同步的增量 live ID 集合，不能用放宽尾段证明或增加交错 DOM 层替代。全 DOM 能简化层级但会放大大图挂载成本；全 Canvas 无法完整承载视频、原生表单和持续 DOM 状态；任意多层交错又会显著增加排序、命中测试和交接竞态，因此当前有界尾段方案是现有功能约束下的保守选择。

原始尺寸/全屏的 `preview-edge-canvas` 不能只依赖一次 ready 标志。`previewEdgeCanvasPlanKey` 必须包含请求 DPR；`MiniMapPreview` 写入可见 backing 前调用 `frameCommitGuard`，由 `canCommitPreviewEdgeCanvasFrame()` 同时验证 edge-only 仍活动、事件 plan key、viewBox bounds 及 X/Y 实际像素比中的较小值。`previewEdgeCanvasVisible` 再验证 committed bounds 覆盖当前可见范围、`previewEdgeCanvasCommittedPlanKey === previewEdgeCanvasPlanKey`，以及 committed DPR 仍达到当前请求倍率。设备 DPR 提高、边修订或窗口计划变化会立即让旧提交失去可见资格；此时 `previewDomEdges` 返回完整当前视口 source，由 `ProgressivePreviewGeometry` 从 `64` 条开始渐进显示 SVG，直到新的清晰 Canvas 帧提交。迟到旧 plan/bounds 帧直接忽略且不得清除当前 ready；若 rejection 匹配当前 plan/bounds 但实际 DPR 不足，则调用 `handlePreviewEdgeCanvasRenderError()` 停用本次 edge-only 并完整恢复 SVG，不能仅等待下一计划，也不得裁剪 fallback 边集合。

surface 回池前还必须重新调用 `getContext('2d')`；首次任务创建拿不到 context 的 surface、释放时 context 再次不可用的 surface，以及任一 context 恢复失败的任务都应销毁而非回池。图片缓存只给 `onload` 注册 `requestImageRender()`，失败不得触发整图重绘；多个成功事件通过 `createCoalescedRenderTrigger()` 在同一动画帧合并。`MiniMapPreview.active` 是调度边界：隐藏 fit surface 必须取消 full/runtime、时间和图片任务，只设置 `suspendedRenderDirty`，再次激活时按最新 token 仅追赶一次。不得用 CSS 隐藏但继续后台绘制的方式占用画图与接数帧预算。

运行值 Canvas 的脏队列只能由 `App.vue` 消费一次。`runtimeCanvasDirtyQueue.js` 以运行键游标增量读取 `runtimeDataKeyIndex` 与 `runtimeBindingPointIndex`，每个 RAF 最多派发一批 `512` 个去重节点；同一个 `{ nodes, dense, pending }` 对象必须广播给全部活动 Canvas，禁止某个消费者先清空队列导致其他 surface 漏更。只有满批且仍有后续工作时才设置 `dense: true`；最终批必须设置 `pending: false`，即使 512 整数边界或重复 ID 产生空终批，也必须发送以关闭 dense stream。`MiniMapPreview.requestRuntimeRender(nodes)` 的旧数组入口可以保留，但新增调用应使用结构化描述符。`resolveChangedRuntimeNodes()` 必须用 `runtimeNodeBitmapRect(node, committedStaticFrame)` 排除当前局部 Canvas 帧之外的节点；过滤后没有可见变化时发送 settled no-op，不能创建工作面、提交零脏区或报告 `runtime-commit-failed`。

`runtimeCanvasStrategy.js` 是 sparse/dense 的唯一公共门禁：变化节点不少于 `1,024`、脏区多于 `64` 或位图覆盖率达到 `35%` 时使用 dense。runtime task 必须惰性取得私有工作面。sparse 使用 committed composite 的 front/back 轮换：成功提交后把旧 front 保存为 `runtimeBackSurface` 并记录本批 dirty rects；下一次尺寸匹配时取回 back，只从当前 front 同步上一批 dirty rects，再绘制本批新脏区。仅当 back 不存在或尺寸不匹配时，才对完整工作面做分条 seed。dense 始终从 committed static seed，并按 `orderedEntities` 的真实图层顺序完整重放。大位图 seed 按最多 `262,144` 像素一条执行 `clearRect + source-over drawImage`，条带之间以及 dense 实体之间都要服从 `2ms` 预算，禁止用 `copy` 绘制单条 seed 后误清除其他条带。任务取消或失败只释放私有工作面，不能修改 committed front；成功后通过引用交换安装新 composite。几何 backing 开始修改前必须释放或失效 runtime back，避免后续 sparse 使用污染基线。大量时间节点不能先构造或遍历完整变化数组，达到相同 dense 门槛时应直接请求 `{ nodes: [], dense: true, pending: false }`。

所有写入可见 Canvas 的 full/runtime/geometry 路径统一调用 `canvasSurfaceCommit.js`。尺寸不变的全量提交只允许一次 `globalCompositeOperation = 'copy'` 和一次 `drawImage`；局部提交把所有裁剪后的脏矩形加入一个 union clip，再执行同一次 copy draw。全量提交需要修改 visible backing 尺寸时，`commitCanvasSurfaceWithResize()` 必须在 resize 前保留可恢复旧帧；新 context 获取、context token 校验或 copy 失败时恢复旧宽高和旧像素，回滚资源无论成功或异常都在 `finally` 释放。禁止恢复“先 clear 可见面、再逐矩形 draw”的实现，因为任一迟到 token、context 异常或 draw 失败都会暴露白块/半帧。几何内部合成若异常，必须把已提交几何索引标记为不完整并走现有 fallback/完整帧恢复，不能继续把它声明为局部 patch 的可靠候选。

Canvas 内部每一层 `save()` 都必须由同一词法作用域的 `try/finally` 配对 `restore()`，包括节点、图片、线稿、线段、设备和边 marker；不能依赖正常返回路径恢复 transform、alpha、dash 或 clip。`createStaticRenderSurface()` 和 `createRenderTask()` 在取得工作面后的创建期任一步骤抛错时，必须先恢复已保存的 context，再把该 surface 标记为不可复用并释放；恢复本身失败也必须隔离该 surface。运行 seed 的 draw/null-context、取消清理中的 restore/reset、几何 static/composite/target context 获取或局部合成异常同样进入统一错误报告和 fallback/权威完整帧恢复，不得让异常越过恢复边界或把坏工作面放回池。`scripts/minimap-canvas-state-exceptions.test.mjs` 以 18 项故障注入锁定这些异常路径。

活动自适应预览以及普通大图首次呈现前的完整兜底帧必须使用 `render-mode="task"`，`render-budget-ms` 为 `4`；后者由 `previewFitInitialRenderUrgent = previewFallbackRequired && !previewPresentationReady` 控制，原子交接后恢复 `idle + 2ms`。task 调度优先使用 `MessageChannel`，但 `TASK_RENDER_MAX_CONSECUTIVE_SLICES = 2`，每连续两片必须通过可取消的 `requestAnimationFrame` 让浏览器获得绘制机会；无 rAF 时继续 task，无 `MessageChannel` 时回退 `setTimeout(0)`，任何分支都不能改成无预算同步循环。`createChunkedRenderScheduler()` 的 `budgetMs` 支持 getter，并在每个 slice 开始重新读取；`MiniMapPreview` full scheduler 必须传入 `() => normalizedRenderSliceBudgetMs(props.renderBudgetMs)`，runtime scheduler 保持固定 `2ms`。预览专用 `MiniMapPreview` 必须启用 `wait-for-images`，按实际绘制记录 `pendingImageUrls`，含占位像素的私有帧只能发送 rejected，不能覆盖可见面；多图 load/error 结算后通过合并触发器只请求一次权威重绘。两个 scheduler 都必须配置 `onError`，先释放失败任务，再统一交给 `reportCanvasRenderError(...)`，不得让调度回调产生未处理异常。`previewFitBitmapPixelBudget` 必须调用 `previewBitmapPixelBudget()`：活动 surface 以 `max(2, min(3, devicePixelRatio))` 为目标倍率，按最终 `stageWidth × stageHeight × fitScale²` 显示面积计算需求并封顶 `MAX_PREVIEW_BITMAP_PIXELS = 8_388_608`；普通尺寸大图的交接帧封顶 `MAX_PREVIEW_BOOTSTRAP_BITMAP_PIXELS = 4_194_304`。小预览不得始终申请最大位图，超大活动视口触及总上限时允许实际倍率有界低于 `2x`，但此时不得把不足倍率的 Canvas 交给用户。`previewFitBootstrapCanRenderSharp` 必须先比较预算计算出的可达像素比与请求值，完整 fit 帧和 edge-only 帧还必须用 X/Y 实际像素比的较小值再次通过 `previewBitmapIsSharp()`；任一不满足时分别保留 DOM 或完整 SVG 清晰回退。低倍率编辑使用独立的 `1_048_576` fallback 与 `12_582_912` detail 预算，不能再归入预览的 419 万像素档。位图像素预算只控制 Canvas 内存与清晰度，绝不能成为 DOM 节点、连线或线稿数量的裁剪条件。

静态边 Worker 在 `incrementalRuntime && max(edgeCount, edgeSpatialIndex.state.entries) >= EDGE_RASTER_WORKER_THRESHOLD(2048)` 时启用；不得再用 `!edgeSourceCursor` 排除空间查询路径。主线程必须继续在 full scheduler 的动态 `2–6ms` 预算内调用 `edgeRasterCommand()` 并建立几何索引。数组路径直接读取现有边；cursor 路径每次 `runSlice` 最多检查 `256` 个 index entries，但在同一 deadline 尚未让步时应继续查询，尽量组成最多 `EDGE_RASTER_WORKER_BATCH_SIZE(512)` 条的 transferable `Float64Array/Uint8Array/Uint16Array`。禁止为启用 Worker 同步收集整个空间索引结果，也禁止把 Vue edge 对象、节点 Map 或完整图纸 postMessage 给 Worker。`edgeRasterDrawing.js` 是主线程 fallback 与 Worker 的唯一共同绘制语义：边顺序、每边 `beginPath/stroke`、dash reset、颜色及起止 marker 必须一致；`drawEdgeRasterCommand()` 必须保存并在完成后恢复调用方原 `lineCap`，不能污染同一 context 的后续图元，也不能为批量 stroke 改变透明叠加或交叉像素。Worker 用 OffscreenCanvas 完成背景与静态边后只转移一个 ImageBitmap；主线程一次复制到 static surface，再继续节点/drawing。

cursor 的 `onMatch` 必须先执行 `task.edges.push(edge)`，再更新 `staticEdgeWorkerCursor`、生成命令和推进 `edgeSourceCursor`；`task.edges` 是已收集可重放前缀，cursor 是尚未消费后缀，两者构成无损双状态。`edgeRasterWorkerClient` 同时只允许一个 active job，并对 start、每批 batch 和 finish 分别设置 `responseTimeoutMs = 8000`；任一握手 8 秒无响应即标记 Worker unavailable、终止线程并走失败路径。supersede/dispose 发送 cancel，所有 jobId 不匹配的 bitmap 立即关闭。创建、发送、运行、超时、消息、协议、位图或合成失败必须调用 `fallbackStaticEdgeWorker()`：保留 `task.edges` 与剩余 cursor，清空命令和 Worker 游标、重置几何索引与主线程绘制游标，从第 0 条先重放前缀，再由 `drawStaticEdges()` 切到 `edgeQuery` 继续后缀，功能不能依赖 Worker，也不能漏边或重复。

编辑与预览节点都通过 `v-memo` 保护子树。`nodeRenderMemo()` 使用 `WeakMap` 为每个 Vue 节点代理保存一个 `computed`，集中计算表单/表格、进度、铅笔和多点线段四类包含嵌套数组的渲染键；模板只能读取一次 `nodeRenderMemo(n)`，不得重新直接调用多个 `JSON.stringify` 键函数。字段变化由 computed 自动失效，节点删除或整体换图后 WeakMap 不保留旧代理。`PreviewNodeBatch.vue` 的 memo 依赖首项必须包含 `node` 引用本身，而不只依赖 ID 与字段；渐进世代保留同 ID 但换成最新节点对象时，Vue 必须重新渲染该实例。这样父级因最终缩放提交或视口变化而更新时，不会重新序列化所有可见表格单元格和路径点，也不会因稳定 key 误留旧对象视觉。

表格总单元格数（含可见表头）超过 `120` 时，`NodeVisual.vue` 必须通过 `tableVirtualization.js` 只挂载当前滚动窗口，并保留上下 2 行、左右 1 列缓冲；完整行列轨道仍参与 Grid 尺寸计算，因此滚动宽高和末行末列不能缩水。窗口跨过合并区域时继续挂载合并原点并跳过被覆盖单元格。自动换行模式必须读取浏览器解析后的实际行高，并在用户停留底部时短暂保持底部锚定，避免动态行高收敛后跳离末行。该规则同时作用于编辑画布、原始尺寸预览和全屏预览，不能在任一 `NodeVisual` 使用场景退回全量单元格 `v-for`。

编辑态按钮需要在同一交互状态内同时支持连续动作和原位拖动。`NodeVisual.vue` 的 `stopInteractivePointer()` 仅对 `button` 不拦截 `pointerdown`，使事件继续进入 `App.vue` 已有的节点按下与 `4px` 延迟拖动链路；短按仍由按钮的 `click` 执行 `count/toggle/message`，移动超过阈值后由画布捕获指针并拖动节点，不能额外触发一次按钮动作，也不能清除 `editingFormId`。其他表单控件继续拦截交互指针，不能扩大该例外。`.canvas .form-interacting .form-button-visual` 使用 `cursor: move` 表达编辑画布中的双重行为；预览不匹配该选择器，继续使用按钮默认的 `cursor: pointer`。

锁定是编辑器内的完整防修改状态。锁定节点仍可单击选择和查看现有值，但移动、缩放、旋转、属性与内容输入、表格数据面板、表单就地交互、图层、组合、复制和删除等变更入口都必须拒绝操作；右侧属性区使用禁用 `fieldset` 保留只读展示，锁定按钮留在其外作为显式解锁入口。双击锁定节点只能提示先解锁，绝不能自动改变 `locked`；执行锁定时立即关闭该节点已有的文字、表单和表格编辑状态，异步文件与时间更新在回写前再次检查锁定状态。修改画布尺寸时，几何归一化必须跳过锁定节点、锁定旧线稿以及包含锁定成员的整个组合，避免通过全局画布设置间接移动锁定对象。锁定不改变预览态的运行交互，预览中的表单仍按图纸运行逻辑响应。

普通原始预览和全屏预览都以 `100%` 显示 `stageWidth × stageHeight` 画布，禁止根据视口放大或缩小，超出内容区的部分由 `.preview-canvas` 提供双向滚动；只有普通自适应预览使用 `Math.min(可用宽度 / 图纸宽度, 可用高度 / 图纸高度)` 等比显示完整画布，并把结果提交给有界像素数的分片 Canvas。全屏入口对包含标题栏和画布的 `previewOverlay` 调用 `requestFullscreen({ navigationUI: 'hide' })`，成功后必须校验 `document.fullscreenElement`；进入全屏时模板通过 `previewFullscreen` 不再挂载普通预览标题栏，`.is-fullscreen` 与原生 `:fullscreen` 规则共同保证画布占满全屏内容区。全屏内不挂载任何退出按钮，统一由浏览器标准 `Esc` 退出。`previewViewportScheduler.js` 把 `fullscreenchange`、`ResizeObserver` 和滚动合并到同一代 rAF；进入或退出原生全屏的首帧没有有效 `contentRect` 时只再等待一帧，第二帧才读取 DOM 尺寸兜底，普通滚动不能被这条全屏等待规则延迟。除 `fullscreenchange` 外，窗口 `resize`、`focus` 和文档 `visibilitychange` 都必须调用幂等的全屏状态校准，以 `document.fullscreenElement === previewOverlay` 修正漏失事件后的状态。`previewViewport` 在原始与全屏模式中跟随真实滚动窗口，确保普通节点、`pencil` 节点、跨屏连线和表单状态连续存在。`ProgressivePreviewNodes` 在每个新世代立即剔除不属于新目标的陈旧 DOM，只保留新旧目标交集并采用当前同 ID 节点引用，再递增挂载缺失节点；滚动不能把仍在视口内的 `NodeVisual`、媒体元素或运行值订阅整批卸载重建，也不能等新目标完整后才释放已经离开目标的旧实例。

这里的 `100%` 是保存的 CSS 像素一比一，不是“把全部内容塞进窗口”。即使普通预览之前开启了自适应，全屏的 `previewRenderScale` 和 `previewFitCanvasScale` 也必须固定为 `1`，模板不得继续挂载 `preview-fit` 居中/隐藏滚动规则。图纸任一轴大于全屏视口时必须保留该轴完整滚动范围，不能用裁剪、降采样或缩小舞台换取单屏显示。

`ProgressivePreviewNodes` 的每帧增量不能只按节点数量切批，还要通过 `previewMountBudget.js` 估算挂载成本：普通节点成本固定，选择器成本随选项数增加，表格成本随行列数和表头增加。组件工具默认每批最多 128 个节点且成本预算为 1,024；`App.vue` 主预览显式传入 `batch-size="8"`、`mount-cost-budget="64"`。缺失节点必须追加为新的不可变 `visibleBatches` 项，禁止修改已经作为子组件 prop 发布的批次，也禁止每批过滤或复制全部已挂载节点。每次追加后等待 `nextTick`，以实际 DOM 提交耗时调整下一批倍率；节点倍率上限固定为 `2`，类型成本与节点数预算仍同时生效。节点列表或预算变化时递增世代并取消旧帧，先同步发布仅含保留交集且引用已更新的批次，再追加缺失批次。完成事件必须在 `nextTick` 后核对 generation、源数量和真实 DOM 数量；图片节点还要等待 load/error，live plane 未 ready 时不得呈现。正常 fit Canvas 等待阶段 `previewDomNodes` 只能读取当前带缓冲视口；只有 `!previewFitCanUseCanvas || previewFitCanvasFailed` 时才允许 `previewDomFullDocumentRequested` 选择全图。Canvas 失败要先把 `previewDisplayMode` 设为原尺寸 `dom` 保证页面清晰非空，完整渐进挂载的 generation/count 都 ready 后才切到 `dom-fit` 并释放 fit surface。

`previewFrameFreshness.js` 是 Canvas 交接的独立状态机。fit surface 启动或目标变化后必须通过 `ensurePreviewFitCanvas()` 请求属于当前文档、目标尺寸和渲染计划的权威完整帧；禁止从另一 surface 复制低密度帧作为 bootstrap，也禁止在完整提交前把 available 冒充 fresh。任何表单或文档内容修改必须先调用 `invalidateDocument()` 推进文档世代并使旧帧失效；合并后的完整绘制调用 `requestDocumentRender()` 绑定当前请求世代。当前文档的完整帧原子提交且 `pendingFull=false` 后即可恢复 fresh；运行值事件只允许更新已经提交的同世代帧，不能在文档修改后的完整帧尚未提交时触发 Canvas 显示。一次运行帧提交时即使已有更新的运行值继续排队，也必须允许这个合法帧参与交接，不能因连续 `pendingRuntime` 使 Canvas 永久饥饿；更新值继续在后续 latest-wins 分片中收敛。没有可绘制运行视觉时仍要发出 settled no-op 完成事件。打开、关闭或重新初始化预览必须使旧世代失效。

图纸属性使用独立的 `paperSelected` 状态。只有点击左侧“图纸”页中的图纸卡片后，右侧“属性”面板才渲染文件名、画布尺寸、画布样式和连线样式；选择组件、线稿、画布空白、编辑工具或切换到其他左侧分类都会清除该状态。组件选择状态不能再通过“没有选中对象”间接激活图纸属性。

### 分类属性

`typeCategory` 根据左侧 `groups` 建立类型到分类的映射。右侧属性面板按 `selectedCategory` 显示不同配置：

- 基本形状：文字、字体、对齐、颜色、边框、圆角、透明度、图片和视频。通用文字以 `fontWeight` 保存“常规、中粗、粗体”三档，对应 `400 / 600 / 700`；加载旧图纸时，历史固定字重或 `fontWeightScale` 倍数会映射到最近档位并移除旧字段。渲染层为中粗和粗体设置不同强度的轻量同色描边，保证中文字体缺少完整原生字重时三档仍有可见差异；表格标题、表头和内容使用同一规则。组件边框保留 `radius` 字段和 `0–100` 圆角控件。直线使用 `w/h` 表达实际长度和粗细，不显示圆角；其专用面板把 `fill/backgroundOpacity` 显示为线条颜色和不透明度，把 `borderStyle/borderDashLength/borderDashGap` 显示为线条实线、虚线、点线及分段参数，并继续用 `borderVisible/stroke/borderWidth` 控制轮廓。视频节点保存 `videoUrl`、`videoFit`、`videoAutoplay`、`videoControls`、`videoPlaybackRate`、`videoPlayCount`、`videoMuted`；编辑态禁用播放器指针事件以保证节点变换。预览态仅在 `videoControls` 为真时绑定原生 `controls`，并在 `videoAutoplay` 为真时于视频挂载后调用播放。有限播放次数由 `NodeVisual.vue` 的结束事件计数，`0` 表示无限循环。
- 线段：右侧属性面板分为“线条样式”和“线段属性”。“线条样式”必须复用直线的控件顺序、字段术语和视觉样式，依次提供线条颜色、完全透明、不透明度、实线/虚线/点线、非实线时的线段长度与间隔、轮廓显隐、轮廓颜色和轮廓宽度；分别写入 `polylineColor/polylineOpacity/polylineStyle`、通用 `borderDashLength/borderDashGap` 及 `borderVisible/stroke/borderWidth`。“线段属性”只放线段特有的线条宽度、箭头大小、起点样式、终点样式、端点和连接，写入 `polylineWidth/polylineArrowSize/polylineStartMarker/polylineEndMarker/polylineLineCap/polylineLineJoin`。箭头大小由起点和终点共用，与线条宽度独立。不要为含义相同的通用线条设置重新创造不同命名、顺序或控件外观。
- 表单：面板顺序固定为基础属性、文字、外观与样式、类型专属数据，不显示无用途的通用数据名称或数据键。表格使用结构化表头、单元格、列宽、长文本显示模式和合并区域，并独立保存外框、网格、标题和行列样式；右侧属性栏与其他表单统一只提供填充、背景透明度、外边框、圆角和整体透明度，再额外显示当前行列规模及“编辑表格”入口。标题、表头、内容行、逐行列尺寸、滚动和内框等完整配置只允许出现在 `.table-data-dialog`，不得在属性栏重复维护。复选框、单选框、开关和切换按钮保存默认与当前状态；进度条支持百分比和当前值/总数；选择器使用结构化选项；时间保存格式、固定/计时模式、服务器时间开关、运行状态、起始时间戳和暂停值。9 种表单组件由 `NodeVisual.vue` 分别渲染，不使用通用文字兜底；`formMemoKey()` 汇总全部表单及嵌套字段，属性变化会立即刷新编辑画布。
- 进度条：表单进度条 `formProgress` 和图表进度条 `progress` 共用尺寸、端点与波动字段。`progressThickness` 和 `progressLength` 控制轨道粗细与长度，`progressStartShape/progressEndShape` 分别控制左右端矩形或圆形。`progressFluctuationEnabled` 开启后，`NodeVisual.vue` 使用单个动画帧循环在 `progressFluctuationMin/progressFluctuationMax`（均限制为 `0–1`）之间计算实时值，并同时驱动填充宽度和显示文字；关闭时取消动画帧，表单进度条恢复 `progressValue`，图表进度条恢复 `runtimeValue` 或 `progressValue`。波动中的表单进度条关闭宽度过渡并暂停手动拖动，保证填充和数值逐帧一致。`formMemoKey()` 与 `progressMemoKey()` 分别保证两类组件的编辑和预览缓存随全部字段刷新。
- 工业与图表：数据键、最大最小值和设备状态。

五种标准图表和“ECharts 代码”组件统一由 `EChartsVisual.vue` 渲染。标准图表在节点不小于 `320 × 220` 时直接按节点尺寸让 ECharts 重排；更小时由 `standardEChartsViewport()` 保留至少 `320 × 220` 的逻辑画布，再等比缩放到节点边界，防止雷达标签、坐标轴和图例被固定字号挤压。代码图表采用同一机制，但逻辑画布下限为 `400 × 300`；用户可以直接粘贴包含 `echarts.init()`、`option` 和 `setOption()` 的官方完整示例，代码只在 `sandbox="allow-scripts"` 的不同源 iframe 中执行。预览态由 iframe 直接处理 ECharts 鼠标交互；编辑态保持 iframe 穿透以保留组件选择、拖动和缩放，再由 `EChartsVisual.vue` 按逻辑视口比例转发悬浮与短按点击坐标。悬浮必须由 `echartsCodeSandbox.js` 同时向 ZRender handler 派发 `mousemove/mouseout` 并调用 `showTip/hideTip`，前者负责图元命中、高亮和用户悬浮回调，后者保证提示框显示和清理；点击必须通过 ZRender handler 依次派发 `mousedown`、`mouseup`、`click`，才能触发图例、工具按钮和用户代码中的 `chart.on('click', ...)`。指针移动超过拖动阈值后不得转发点击，避免移动组件时误触图表；沙箱读取 ZRender 视口的实际光标并仅在状态变化时通知宿主，空白区使用 `default`，命中可交互图元时使用 `pointer`，不得再通过 CSS 把整个代码图表强制为手势。修改尺寸或交互策略时同时检查 `EChartsVisual.vue`、`echartsCodeViewport.js`、`echartsCodeSandbox.js` 和 `.echarts-visual` CSS，宿主元素不能再被 `width/height: 100% !important` 覆盖，否则会形成二次缩放。生成沙箱文档的测试还必须解析全部内联脚本，不能只依赖字符串断言。
- 网络与云：地址、数据键和连接状态。
- 动效组件：动画类型、精确周期、方向、暂停和边框显示。
- 自定义动效：效果、周期、延迟、缓动、循环、方向、位移、缩放、旋转和目标颜色。

`backgroundOpacity` 只控制节点填充背景，`opacity` 控制整个节点。`NodeVisual.vue` 使用 `colorWithOpacity` 把颜色转换为带 alpha 的背景，确保背景为 0 时文字、边框和内部动效仍正常显示。`.node-video` 必须使用同一个 `--shape-fill` 作为背景，不能固定为黑色；视频采用 `contain` 时，媒体宽高比之外的留白区域才能正确响应填充颜色和背景不透明度。

视频自动播放与控制器显隐是两个独立状态。`videoAutoplay` 默认为 `false`，关闭时进入预览保持暂停，由用户手动启动；`videoControls` 默认为 `true`，关闭时不渲染原生控制器。两者同时关闭时，视频元素提供键盘焦点，并支持单击或按 Enter、空格切换播放/暂停。兼容旧图纸时，缺少 `videoAutoplay` 的节点从旧 `videoPlaying` 转换一次，缺少 `videoControls` 的节点按 `true` 处理；新逻辑、属性面板和 `v-memo` 不再依赖旧 `videoPlaying`。

本地视频由 `FileReader.readAsDataURL()` 嵌入节点，20MB 文件转换后的 Base64 文本约为 26.7MB。属性面板不得把该内容绑定到文本输入框，也不得恢复 `v-model="selected.videoUrl"`：选中节点时只显示本地视频状态和按字符串长度计算的体积，地址输入用 `selectedVideoEditorValue` 屏蔽任意 `data:` 内容。网络地址输入在 `@input` 中只写入最多 8192 字符的非响应式 `pendingVideoUrlEdit`，不修改节点或触发根组件刷新；失焦或普通 Enter 时由 `commitSelectedVideoUrl()` 一次提交，画布选择变化前由 `setNodeSelection()/clearNodeSelection()` 主动刷新草稿，避免 Vue 在原生 blur 之前卸载输入框而丢失内容。提交必须读取草稿保存的节点 ID 再通过 `nodeIndex` 找到原节点，不能读取当时的 `selected`，否则切换选择可能误写新节点。空白的本地视频地址框不得隐式清除源，删除必须经过明确的移除按钮。

`borderWidth` 支持 `0–20px` 和 `0.1px` 步长。普通组件的实线、虚线和点线统一由 `.custom-border` SVG 渲染；表单输入、按钮、复选框、单选框和表格外边框使用同一 CSS 变量。不要把实线改回普通 CSS `border`，否则不同缩放比例和设备像素比下的细线效果会不一致。三角形、菱形、判断、五角星、六边形和箭头的内容置顶规则必须排除 `.custom-border` 与 `.line-shape-visual`，确保描边 SVG 始终绝对定位且不参与 Flex 布局。

直线组件由 `.line-shape-visual` 使用动态 `viewBox="0 0 w h"` 渲染，因此节点宽度和高度就是可见线的实际长度和粗细，八方向缩放、组合缩放、预览和鹰眼共享同一尺寸语义。实线继续使用矩形本体；虚线和点线改用贯穿节点中心的分段 SVG 线，外层按完整高度绘制轮廓，内层按 `h - 2 × borderWidth` 绘制线条颜色，使间隔切断整个主体而不是只切断矩形边框。点线的渲染间隔额外补偿线条高度，避免圆形端帽相互覆盖后重新连成实线。`lineShapeBodyDashSegments()`、`lineShapeBodyInset()` 和 `lineShapeInnerThickness()` 同时供 `NodeVisual.vue` 与 `MiniMapPreview.vue` 使用；编辑、预览和鹰眼不能各自维护另一套分段公式。新建直线默认为 `150 × 8px`、绿色本体、深灰色 `2px` 可见轮廓；`fill/backgroundOpacity` 控制线条本体，`borderStyle/borderDashLength/borderDashGap` 控制实线、虚线、点线、线段长度和间隔，`borderVisible/stroke/borderWidth` 控制轮廓。编辑画布和全屏预览的 `v-memo` 必须继续包含这些字段。轮廓宽度会限制在实际宽高中，直线不提供圆角。图纸格式版本 `20` 会在加载旧图纸时把原来承担线粗的 `borderWidth` 迁移到 `h`、用原描边色初始化本体填充，并调整 `y` 保持视觉中心不移动；“我的”模板使用相同迁移。

直线视觉高度与交互命中区相互独立。`.line-shape-visual` 只负责显示且禁止指针事件，编辑画布中的 `.line-node::before` 提供透明命中层；命中层通过 `--line-hit-size` 按画布缩放反向补偿，保证细线仍有至少约 `16px` 的屏幕命中高度。修改直线实际高度时不能同步缩小该命中层。

### 文本组件排布

文本内容的原始字符串始终直接保存在 `node.text`，输入、复制和 JSON 往返不得把连续空格改成 `&nbsp;`、删减或合并。编辑画布与普通/全屏预览共用 `NodeVisual.vue` 的 `.node-text-content`：横排先以 `white-space: pre-wrap` 兼容旧浏览器，再由 `white-space: break-spaces` 精确保留连续空格，同时用 `overflow-wrap: anywhere` 约束窄组件；竖排额外使用 `writing-mode: vertical-rl`、`text-orientation: upright` 和组件全高。竖排仍复用 `textAlign` 数据，渲染时把 `left/center/right` 映射为逻辑 `start/center/end`，属性面板相应显示顶部、居中、底部。两处节点 `v-memo` 必须包含 `textLayout`，否则属性切换后编辑或预览可能继续使用旧排布。

鹰眼、“我的”缩略图、低倍率编辑和自适应预览是 Canvas，不继承上述 CSS。`MiniMapPreview.vue` 对文本节点同时支持横排多行和竖排列：横排通过 `horizontalTextLayout()` 保留显式换行、连续空格和 CJK 换行，并逐行 `fillText()`；竖排通过 `verticalTextColumns()` 按可用高度分列，空格不绘制字形但占用推进位置，显式换行开始新列。`splitTextGraphemes()` 优先使用 `Intl.Segmenter` 保持 grapheme 完整；不可用时回退代码点迭代，至少避免代理对按 UTF-16 码元拆开，但不承诺把所有组合序列归并为单一 grapheme。DOM/CSS 与 Canvas 必须共同读取原始 `node.text` 和 `textLayout`，不能用旋转节点、裁剪正文或 `&nbsp;` 模拟排布。

faithful 低倍率 detail 允许通过 `readableCanvasFontSize()` 把屏幕文字提高到最低可读字号，但不得直接用这个放大字号重新计算换行。`canvasTextDrawPlan()` 在 `fontSize > requestedFontSize` 时设置 `needsBaselineLayout`；系统先以 `requestedFontSize` 生成原字号行/列及内容宽高，再由 `layoutConstrainedCanvasFontSize()` 按布局剩余空间限制最终字号，绘制时继续复用同一行/列。这样 `visualScaleX/visualScaleY` 放大的组合文字保持原布局结构，不会因为低倍率可读字号触发额外换行或列拆分后相互重叠。修改这条路径必须同时覆盖横排、竖排、非放大原字号及宽高约束，不能用取消最低可读字号掩盖问题。

当实际正文 `String.length > LONG_TEXT_INCREMENTAL_THRESHOLD = 512` 时，`MiniMapPreview` 必须用 `incrementalTextLayout.js` 准备布局。横排和竖排与上述同步基准保持相同字素、空格、硬换行和测量语义；`runIncrementalTextLayoutSlice()` 默认每 `32` 次操作调用一次 `deadline.shouldYield()`，即使截止时间始终允许继续，每片也最多执行 `8,192` 次操作。full 的 `entityCursor`、dense 的 `entityCursor` 和 sparse 的 `candidateCursor` 只有在当前文字布局完成并绘制后才能推进；未完成分片不得在私有 surface 留下半段文字，更不能提交可见 Canvas。supersede、invalidate、卸载或其他取消路径必须清除 `textLayoutWork`；测量/布局异常要在恢复当前 context 后把 surface 标记为不可复用，并由 scheduler 的 `onError` 进入既有 Canvas/DOM 恢复。同步几何局部 patch 发现任一候选需要增量文字布局时必须返回失败，由 `applyGeometrySnapshot()` 请求权威完整帧，禁止在指针路径同步跑完长文本。

### 线段组件

线段的用户入口只存在于独立“线段”分类，“基本形状”中的直线入口及 `lineShape` 行为保持不变。草稿只能由组件库拖拽落点启动；启动后，下一次画布左键落点无论位于空白、普通组件、锁定组件还是旧线稿区域，都必须先转交 `addPolylinePoint()`，确保终点不被已有节点层级阻断。草稿层 `.polyline-draft-layer` 位于普通节点之上，只显示起点到当前悬停终点的直线预览。该层整体和路径继续禁用指针事件，只有起点圆点使用 `.polyline-start-point` 恢复命中；起点半径按 `7 / zoom` 绘制，保证不同缩放下仍清晰可拖拽。

起点拖动使用 `polylineStartPointDrag` 保存 `pointerId` 和命中目标，`startPolylineStartPointDrag()` 必须阻止事件继续冒泡并捕获指针，避免锚点按下被 `addPolylinePoint()` 当作终点。`movePolylineStartPoint()` 仅通过 `polylinePointFromEvent()` 更新 `polylineDraft.points[0]` 和悬停预览；禁止新增草稿点。该坐标转换与终点落点共用当前网格吸附，事件带 `altKey` 时临时跳过吸附。`pointerup`、`pointercancel` 和窗口失焦必须调用 `endPolylineStartPointDrag()` 释放指针捕获并移除窗口监听，但保留仍未完成的草稿及其起点锚点；完成、取消、`Backspace`、切换图纸和组件卸载还必须继续清除草稿，不能留下悬空拖动状态。

`NodeVisual.vue` 通过 `polylinePath()` 把归一化点转换为单个 `M/L` SVG 路径，并以 `vector-effect="non-scaling-stroke"` 保持线宽语义。实线、虚线和点线由 `polylineStyle` 决定，虚线长度与间隔复用 `borderDashLength/borderDashGap`；线条本体透明度由 `polylineOpacity` 控制，轮廓继续复用 `borderVisible/stroke/borderWidth`。首尾箭头 marker ID 必须同时包含节点 ID 和渲染实例 ID，避免编辑、预览、“我的”缩略图或同节点多实例同时存在时互相引用。`MiniMapPreview.vue` 使用同一组归一化点、线型、分段参数、轮廓、端点和首尾箭头语义绘制鹰眼。编辑与预览的 `v-memo` 必须包含全部线段字段，属性修改后应立即刷新所有视图。

完成节点进入统一 `nodes` 集合后，移动、八方向缩放、旋转、锁定、复制粘贴、图层、组合、添加到“我的”、撤销重做、保存恢复和预览全部复用普通节点链路。单选、选择工具且未锁定时，`.polyline-point-editor` 为 `polylinePoints` 的全部端点和中间点显示固定屏幕尺寸手柄；命中区和圆点按 `zoom` 反向补偿，八向缩放和旋转入口继续保留。控制层必须用固定数量的聚合 SVG path 绘制和命中节点，按下时再查找最近节点，不能为最多 10,000 个点逐点创建 DOM。拖点先把世界坐标按节点角度逆旋转到局部坐标，再由 `reframePolylineNode()` 重算旋转框架及归一化点；未拖节点的世界坐标必须保持不变，拖出旧框或画布边界也不能夹回。一次连续拖动只记录一条 `fields` 历史，字段固定为 `x/y/w/h/polylinePoints`，同时更新空间索引、编辑 LOD、鹰眼和预览。

`normalizeNode()` 应限制点坐标、点数、线宽、线型、透明度、箭头、端点和连接值，并把旧 `polylineDash` 迁移为新的三态 `polylineStyle`；导入容量检查必须把 `polylinePoints` 与铅笔及旧线稿点数共同计入项目上限。起点锚点只属于临时草稿层，不进入完成节点或图纸数据；切换图纸、恢复历史、切换到其他工具或重置会话时必须先结束锚点拖动并清除未完成 `polylineDraft`，不能把草稿写入图纸 JSON。

### 表单数据与事件

表格的持久化模型为：

```js
{
  tableHeaders: ['日期', '姓名', '省份', '市区', '地址'],
  tableCells: [
    ['2016-05-03', '王小虎', '上海', '普陀区', '上海市普陀区金沙江路 1518 弄']
  ],
  tableColumnWidths: [1.25, 1, 1, 1, 2.6],
  tableHeaderHeight: 40,
  tableRowHeight: 40,
  tableRowHeights: [40],
  tableContentDisplay: 'ellipsis', // ellipsis 或 wrap
  tableMerges: [
    { row: 0, column: 0, rowSpan: 2, columnSpan: 3 }
  ],
  tableScrollX: true,
  tableScrollY: true,
  tableTitleAlign: 'center',
  tableTitleSize: 14,
  tableTitleWeight: '600',
  tableHeaderAlign: 'left',
  tableHeaderSize: 14,
  tableHeaderWeight: '600',
  tableTextAlign: 'left',
  tableCellSize: 14,
  tableCellWeight: '400',
  tableBorderWidth: 1,
  tableBorderColor: '#ebeef5',
  tableGridWidth: 1,
  tableGridColor: '#ebeef5',
  tableGridStyle: 'solid'
}
```

`normalizeTableModel()` 负责把旧版 `options` 和 `tableData` 文本迁移到该模型，导入旧图纸时无需手动转换。标题、表头和内容行分别使用独立的对齐、字号和字重字段；`tableGridStyle` 支持 `solid/dashed/dotted`，同时作用于标题下边线和单元格内框。`tableHeaderHeight` 控制表头高度，`tableRowHeight` 是统一设置及新增行的默认高度，`tableRowHeights` 与 `tableCells` 一一对应并允许逐行覆盖。`tableContentDisplay` 为 `wrap` 时使用 `minmax(设定行高, auto)` 作为行轨道并允许文本换行，为 `ellipsis` 时保持单行省略。编辑画布中单击表格只负责选择节点；表格专用的 `consumeTableDoublePointerDown()` 在第二次按下时由 `startTextEdit()` 分派到 `openTableDataEditor()`，因此标题、表头、正文、空格和合并格均不依赖浏览器最终派发的 `dblclick`，该兜底不得扩展到文字或其他组件。预览中单击缩略正文单元格仍会打开完整内容弹窗。

`tableMerges` 只描述数据区，不包含表头；`row/column` 使用从 `0` 开始的索引。合并区域显示左上角单元格内容，但不删除 `tableCells` 中被覆盖的值，拆分后原值直接恢复。持久化归一化按运行时表格硬上限 `50 × 12` 限制坐标、去除单格无效记录并拒绝重叠区域，不能再按静态后备数据的当前行列永久删除接口范围内的合并。`activeTableViewMerges` 和 `createTableCellModels()` 分别在编辑器与渲染器中按当前静态或接口行列投影布局：跨度越界时只临时裁到边缘，起点越界或裁成单格时只在当前视图隐藏；接口数据恢复尺寸后原合并自动恢复，过程中不得回写或破坏持久化数组。渲染器必须先扫描最多 `50 × 12` 条持久化记录再过滤当前视图，不能先按当前 `rows × columns` 截断数组，否则排在越界记录之后的有效合并会消失。完整数据面板在“拖选合并”模式中拖动形成矩形选区，合并操作允许覆盖完全包含在选区内的旧合并，但拒绝部分相交；拆分会移除与当前选区相交的合并区域。重叠判断必须读取完整持久化布局，即使某个旧合并在当前接口尺寸中被裁成单格而暂时隐藏，也必须阻止新合并假成功并允许用户先显式拆分。有效且尚未合并的选区必须把尺寸与“合并”命令组合成高对比主操作，不能只显示弱化的尺寸数字或普通工具按钮；底部结束操作在该状态下应执行“合并并完成”，且只有合并成功后才能关闭弹窗，避免用户直接完成时丢掉已拖选区域。`activeTableMergeLookup` 把当前视图内的有效合并范围预索引为单元格键，且不依赖编辑器模式或静态/接口视图；“编辑数据/查看数据”和“拖选合并”都必须隐藏被覆盖格，并为合并起始格应用相同的 `gridRow/gridColumn` 跨度。内容模式只在合并起始格保留输入框或只读值，底层被覆盖值继续保存在模型或接口快照中。`NodeVisual.vue` 同样跳过被覆盖单元格，为合并起点设置显式跨度，并按合并后的右、下边界决定内框。`tableMerges` 必须加入 `formMemoKey()`，保证编辑态和预览态即时刷新。

`tableScrollX/tableScrollY` 分别控制表格容器的 `overflow-x/overflow-y`，缺失时按 `true` 兼容；`tableColumnWidthsPx` 的每一项都直接生成对应的固定像素网格轨道，最后一列不会再自动吸收组件剩余宽度。标题、表头和表体共享以列宽总和计算的 `.form-table-content` 内容面，三者的右边缘始终一致。列宽总和超过组件宽度时，该内容面产生真实的横向滚动区域；列宽总和小于组件宽度时，剩余空白保留在内容面之外，避免篡改用户设置的实际列宽。`tableBorderMetrics()` 统一判断内框宽度、颜色、线型与外框是否完全一致。`tableTitleStyle()` 为标题绘制完整内框；能够与同样式外框重合的上、左、右边复用外框，标题下边始终作为标题与表头/表体之间的分隔线。`tableCellStyle()` 默认只为单元格设置右、下两条网格边；只有不能复用外框时，第一列补一次左边，标题隐藏时首个可见行补一次上边，其他单元格的上、左必须保持 `0/none`。任何场景都不能使用四边 `borderStyle` 简写，否则浏览器会用默认 `medium` 宽度意外激活普通单元格上、左边框，使内部相邻线叠加变粗。该函数同时比较列宽总和、标题/表头/逐行轨道总高与组件内框可用尺寸：右侧或底部存在空白时，最末列和最末行必须绘制自身内框；内容贴住或超过外框时，也只有在外框与内框的宽度、颜色、线型完全一致时才允许复用外框收口。合并到最末列或最末行的单元格使用同一判定，不能无条件移除右边或底边。`insertTableRow()`、`deleteTableRow()`、`insertTableColumn()` 和 `deleteTableColumn()` 会同步表头、列宽、逐行高度、二维单元格数组及当前静态范围内的合并区域，修改结构前写入撤销历史，并分别限制为最多 50 行、12 列和最少 1 行、1 列；起点位于静态范围外的接口专属合并保持原坐标，不能因静态增删而被移动或删除。属性栏摘要、画布双击和完整数据弹窗始终编辑同一个 `tableHeaders/tableCells` 引用，不维护第二份临时数据。

完整表格弹窗的页签职责必须保持独立：`数据` 只编辑标题文本、表头名称、二维单元格数据、行列增删和合并/拆分；`样式` 统一编辑组件宽高、标题/表头显隐、滚动方式、标题/表头/内容的背景与字体、统一及逐行高度、逐列宽度和内外边框。显隐、颜色、排版或尺寸字段不得重新放入数据页；样式页继续直接绑定图纸节点，修改必须即时进入 `NodeVisual.vue`，不能维护弹窗私有副本或在关闭时批量覆盖节点。数据页显示节点必须通过 `materializeRuntimeNode()` 复用画布的运行时物化规则，并仅在弹窗打开期间订阅当前表格的绑定键；接口绑定生效时，标题、表头、行列数和单元格必须与画布一致。“静态配置”和“当前接口数据”入口必须始终同时显示，不能因未配置接口或运行值暂缺而隐藏；进入接口视图后，未配置表格内容绑定时提示先配置接口，已配置但尚无运行值时提示检查接口配置，并提供跳转到当前表格通信设置的按钮。接口返回恰好相同的标题或内容时仍须按真实运行值展示，不能错误退回静态视图。接口标题、表头和单元格输入保持只读，行列增删入口隐藏，不能把接口快照写回图纸 JSON、撤销历史或静态表格字段；但“查看数据/拖选合并”、合并、拆分、选区提示和已有合并效果必须与静态配置视图同时保留，布局修改写入共享 `tableMerges` 并同步作用于画布。持久化旧合并被当前接口尺寸裁成单格而暂时隐藏时，主合并按钮必须在提交前显示冲突并引导先拆分，按钮状态与提交校验共用 `hasTableMergeSelectionConflict()`，不能出现先显示可合并、点击后才拒绝的状态分裂。运行值刷新不得强制切回内容模式或清空正在拖选的合并选区。关闭弹窗或组件卸载时必须释放这些局部订阅；样式页即使存在接口数据仍可正常编辑静态样式。

`NodeVisual.vue` 在编辑交互或预览交互后发出 `{ type, value, checked }`。`openPreview()` 先使用 `defaultChecked` 和 `defaultValue` 初始化交互状态；`handleFormChange()` 只在单选框变为选中时清除同一 `formName` 的其他项，因此当前项再次点击可以取消，复选框、开关和切换按钮也可反复切换。选择器的 `selectOptions` 是 `{ label, value }[]`，修改选项值时同步当前值和默认值。时间格式化、解析与计时值计算集中在 `src/utils/formTime.js`；只有存在运行中的计时或服务器时间节点时才按秒刷新，服务器时间通过 `GET /api/time` 校准并定期重同步，失败时回退浏览器本机时间。旧图纸的 `timeSource/timeMin/timeMax/timeStep` 只在 `normalizeNode()` 中兼容读取并删除，不会写入新图纸。按钮动作支持计数、切换和消息：只有计数动作递增 `clickCount`，`showClickCount` 也只在该动作中控制纯数字次数徽标；切换动作使用 `buttonBeforeColor/buttonAfterColor` 根据 `checked` 状态改变背景，不渲染次数；消息动作通过 `form-change` 把 `actionMessage` 交给 `App.vue` 的确认弹窗，并在普通预览和全屏预览中挂载到正确容器。其他控件直接更新其当前值或选中状态。

时间组件使用两个独立字段控制装饰：`timeShowLeftIcon` 控制 `NodeVisual.vue` 内的 `Clock3`，`timeShowRightIcon` 通过 `.hide-right-icon` 控制浏览器原生 `::-webkit-calendar-picker-indicator`。两个字段默认均为 `true`，必须进入 `normalizeNode()` 和 `formMemoKey()`；旧图纸缺少字段时按显示处理。鹰眼只绘制左侧时钟，因此跟随 `timeShowLeftIcon`。时间正文继续复用通用 `fontSize` 与 `fontWeight`，属性面板提供 `8–96px` 字号以及 `400/600/700` 三档粗细；`.form-time-visual input` 必须保留 `font: inherit` 和通用文字辅助描边，确保编辑、预览与鹰眼读取同一组持久化字段。

### 铅笔线稿

铅笔按下时先产生临时 `drawing`，`pointermove` 只在移动距离达到阈值后追加绝对画布坐标。`pointerup` 调用 `finalizePencilDrawing()`，由 `drawingToPencilNode()` 计算紧边界、把路径点归一化为节点内部 `0–1` 坐标，并生成 `type: 'pencil'` 的普通节点；临时 `drawing` 随即删除。点数不足两点的点击不会留下空节点。

所有铅笔起笔都必须经过 `startPencilDrawing()`。`canvasPointerDown()` 在 `.node-shell/.drawing-hit` 命中过滤前调用它，`nodePointerDown()` 在选择、双击编辑、锁定和移动逻辑前调用它，`drawingPointerDown()` 也在旧线稿移动逻辑前调用它；锁定标记单独把铅笔事件转交给该入口。选择、缩放和旋转控制框只在 `activeTool === 'select'` 时渲染，避免其高层级手柄遮挡铅笔起点。这样铅笔可从普通组件、锁定组件、已有铅笔节点和遗留临时线稿范围内起笔，新临时轨迹使用 `reserveEntityLayers()` 置顶，完成后仍保留连续铅笔模式。

`pencil` 节点字段包括 `pencilPoints`、`pencilColor`、`pencilWidth`、`pencilDash`、`pencilSmooth`、`pencilClosed`、`pencilLineCap` 和 `pencilLineJoin`。`NodeVisual.vue` 在 `viewBox="0 0 1 1"` 中生成折线或平滑二次曲线路径，并用 `vector-effect="non-scaling-stroke"` 保持线宽语义。因为节点进入统一的 `nodes` 集合，所以选择、框选、`Ctrl/Cmd/Shift` 多选、八方向缩放、旋转、锁定、图层、复制粘贴、删除、组合、取消组合、“添加为我的”、撤销重做和预览不再维护铅笔专用分支。组合时 `groupId` 与其他成员一同持久化，整体缩放直接改变节点边界，归一化路径继续按新边界绘制。

`prepareProject()` 会把旧文件 `drawings` 中的每条有效线稿迁移为唯一 ID 的 `pencil` 节点并清空 `drawings`，因此历史图纸打开后也自动获得普通组件能力。新文件仍保留空 `drawings` 字段用于格式兼容和临时绘制状态，但落盘时通常为空。

## 5. 动画

节点的 `animation` 支持：

| 值 | 效果 |
| --- | --- |
| `none` | 无动画 |
| `pulse` | 呼吸高亮 |
| `float` | 上下浮动 |
| `flow` | 图表、进度、仪表数据流动 |
| `blink` | 设备状态闪烁 |

独立动效组件包括 `flowPipe`、`rotatingFan`、`signalLight`、`waterTank`、`heartbeat` 和 `particles`。视觉结构位于 `NodeVisual.vue`，关键帧位于 `enhancements.css`。这些组件只渲染动效视觉，不再追加通用文字节点，视觉会在整个组件区域内居中展示。

自定义动效组件包括 `customMotion`、`customTextMotion`、`customImageMotion` 和 `customIndicator`。`customEffect` 选择关键帧名称，其余参数通过 CSS 变量传入。系统开启“减少动态效果”时会自动关闭持续动画。

风机的 `.fan-visual` 是静态外壳，`.fan-rotor` 是唯一旋转层。不要把旋转 animation 设置到 `.node-body`、`.node-shell` 或 `.fan-visual`，否则会导致边框、文字或编辑手柄一起旋转。

## 6. 实时数据接入

`useRuntimeData()` 接收批量数据：

```js
enqueueRuntimeData([
  { key: 'device.pressure', value: 72 },
  { key: 'device.temperature', value: 36.5 }
])
```

同一帧内相同 `key` 只保留最后一个值，每个发生变化的 `dataKey` 独立递增版本，不维护全局批次标记。`v-memo` 只在自身键变化时失效，不会因为其他设备数据刷新而重绘。实际 WebSocket 或 MQTT 回调应把消息送入协议适配器和 `runtimeUpdatePipeline`，不要直接逐条修改节点对象；真实大 JSON 的解码、`JSON.parse` 和结构校验必须在 Worker 中完成，主线程只接收已通过协议字节上限的结构化批次。切换图纸时调用 `clear()` 清除旧运行时值。

`normalizeRuntimeUpdates(payload, limits)` 是同步纯函数 API，必须保持直接返回规范化数组，不能因异步接入而改成 Promise。网关小批调用 `publishSynchronously(updates)`，保持 `send()` 同步返回接受数的兼容语义；存在待处理旧批时，该快路径仍须先为新批分配 sequence，不能绕过跨批顺序。`createRuntimeUpdatePipeline()` 的异步消费默认每片最多 `2ms`，同时受 `sliceItems` 限制，并按任务轮转而不是长期处理队首。每批分配单调 sequence，批内重复 key 与跨批重叠 key 都采用 latest-wins；发送前必须再次检查 key 的最新 sequence，防止旧大批尾部值覆盖已到达的新值。只有同步 `onChanges(changes)` 成功返回后才更新 `lastValues`；sink 抛错时保留 chunk 到下一调度代重试。

管线必须同时约束 `maxBatchItems`、`maxPendingItems`、`maxKeyLength`、`maxStringValueLength` 和 `maxBinaryValueBytes`。已知长度源入队即预留容量；未知 iterable 入队预留首槽，随后逐项动态记账，不可信任自定义 `size`。`stop()` 以已成功发送的部分结果正常结算待处理 Promise，并递增 generation；取消失败后迟到的旧回调必须因 generation 不匹配退出，重连可继续使用同一管线实例。协议层仍需另设消息字节上限并优先传输 changes-only，不能依赖前端项目数限制承受无限 JSON。

运行值进入 DOM 文本或 Canvas 前统一调用 `formatRuntimeValue()`。默认边界是 256 个输出字符、4 层深度、12 个对象键、12 个数组项和 48 个总条目；实现必须继续防护循环引用、抛错 getter、异常代理和超大 BigInt，并保证限制约束实际读取量而不只是最终字符串截断。`RuntimeValueText.vue` 与 `MiniMapPreview.vue` 必须共用该工具，不能各自恢复 `JSON.stringify` 或无界对象遍历。

节点通过 `dataKey` 订阅值：

```vue
<NodeVisual :node="node" :runtime-value="getRuntimeValue(node.dataKey)" />
```

“数据源”页面只管理连接生命周期；“通信”面板把组件参数保存为 `{ target, sourceId, jsonPath, enabled }`。`pointCatalogGateway` 提供 `listSources/getSourceSnapshot/subscribeSnapshots` 契约，`sourceBindingRuntime` 对相同 `sourceId + jsonPath` 去重求值，再把稳定派生键交给 `runtimeGateway` 和 `useRuntimeData`。接入真实 WebSocket、MQTT、HTTP、SQL 或 Redis 时，应在 `src/services/backend.js` 替换数据源适配器，不能在组件、属性面板或画布事件中创建协议连接。大响应应在 Worker 解析后通过 `ingestSourceSnapshot(..., { takeOwnership: true })` 移交；共享快照只读，调用方不得修改。

数据源目录按图纸隔离。`drawingPointSourceScopeId(workspaceId, projectId)` 为每张图纸生成稳定存储作用域；普通保存和重命名保留 `projectId`，新建图纸生成新身份。旧工作空间级目录只在旧图纸首次打开时惰性复制一次，之后各图纸独立修改。切图时先关闭旧作用域的数据重放，再激活目标图纸；快照必须携带作用域和代次，迟到的旧图纸数据不得进入当前运行值。

当前纯前端实现没有后台采集器。“激活图纸数据源”只读取 IndexedDB 中的配置和已有本地快照；打开图纸、切换图纸、打开数据源页、进入预览、启用连接和保存配置都不得调用 `testSource/testSourceDraft`，也不得启动 HTTP 轮询、WebSocket、MQTT、Socket 或数据库连接。只有用户点击“测试”时执行一次测试；当前测试是本地配置校验和样例预览，不代表真实接口已访问。未来加入持续采集时必须提供显式的运行/停止操作，共享同一连接，并在停止或离开运行态后释放连接，禁止挂到 `onMounted` 或后台定时器自动启动。

`DataSourceManager.vue` 不再分别用多个 computed 扫描连接数组。唯一的 `sourceListModel` 调用 `createSourceConnectionListModel()`，在一次 `for...of` 中生成未受筛选影响的 `stats`、`protocolCounts`，以及按原顺序保留连接引用的 `filtered/groups`。搜索字段统一包含名称、endpoint、协议全称和 `TCP/WS/SQL/MYSQL` 等显示简称、状态文字及连接类别；状态筛选把离线与错误合并为“异常”，停用优先于来源上报状态，协议筛选可以与搜索和状态叠加。新增筛选条件时必须继续在该模型中一次完成，不能在模板或新的 computed 中重新全表过滤、统计或复制来源记录。

连接行按 `source.id` 保持稳定身份，并分为“连接配置”和“接口 Demo”；Demo 组初始折叠，存在搜索词时组视图强制展开。筛选不得调用 `selectSource()` 或 `fillDraft()`，否则会丢失尚未保存的右侧表单。当前 ID 不在筛选结果时只显示定位提示；`revealSelectedSource()` 清空搜索、状态和协议筛选后展开对应组。状态必须同时显示文字，不能只依赖颜色；七类协议使用固定且可区分的标记配色。`680px` 以下只切换为上方连接清单、下方配置区的单列布局，连接生命周期和草稿状态保持同一套逻辑。

保存、测试、删除和选择详情都是带来源身份的异步边界：操作开始后必须固定发起时的 `source.id` 并锁定冲突操作，不能在等待期间把结果提交到后来选中的连接。保存或测试等待期间，整个可编辑配置 `fieldset` 必须禁用，避免异步回包覆盖期间的新输入。切换连接、新建和关闭管理页前必须确认未保存草稿；筛选和定位不触发该确认。连接变更成功后若列表刷新失败，应分别报告“变更已成功”和“刷新失败”，不能把已成功的变更误报为失败。全局提示区域必须位于加载、空态和详情分支之外；列表或详情加载失败时既要保留具体错误，也要显示对应空态。选择详情只有在加载成功后才能提交，加载失败时继续保留原详情。两个弹窗必须管理初始焦点、Tab 循环、Escape 分层关闭和焦点恢复；极短视口允许工作区纵向滚动，确保配置区和操作按钮仍可访问。

内置接口 Demo 只属于本地数据源目录：MQTT、HTTP、MySQL、SQL Server、Redis、Socket 和 WebSocket 各有颜色、数值两个 Demo。顶层 `value` 和 `$.value` 是稳定主值契约；公共字段包含 `protocol`、类型字段 `kind`、`status`、`metric`、`label`、`enabled` 和 `updatedAt`。颜色样例另有 `palette/states`，数值样例另有 `unit/metrics/series`，两类都提供标准 `table={ columns, rows }`。每条样例正文必须保持确定性、小于 `4 KiB`，表格只提供少量行，不能把 Demo 变成长时间序列或大响应。旧七条示例连接的 ID、数据结构和 JSONPath 必须保持不变。旧默认工作空间只允许执行一次只增不改的 Demo 目录迁移；迁移版本随来源元数据持久化，后续不得因刷新或重启复活用户已经删除的 Demo。不得为 Demo 在组件中新增专用请求或类型分支。

代码定义样例的回退必须验证来源身份；删除内置 Demo 后以相同 ID 创建的用户连接不能继承旧样例。协议或连接配置变化时必须清空旧 `lastResponse.preview` 并持久化样例脱离标记，连接测试只能发布新配置对应的数据或有界点位样例，不能把旧协议正文重新标为 `good`。目录刷新如需保存迁移，必须在替换活动目录和发布快照之前完成保存；保存拒绝时目录、快照和事件保持原状。

所有组件的通信页都通过 `parameterDataFormatGuide()` 按参数类型展示默认返回结构。颜色、数值、布尔和文本推荐把主值放在 `value` 并选择 `$.value`；表格推荐放在 `table` 并选择 `$.table`，同时展示行对象数组和 `{ columns, rows }` 两种合法结构。格式指南的样例必须通过 `directBindingCompatibility()`，新增参数类型时同时更新兼容规则、格式指南和回归测试，不能在单个组件中硬编码另一套说明。

信号灯是数组属性与通信项对应的受控例外。`componentBindingSchema.js` 导出统一上限 `MAX_SIGNAL_COLORS=8`：`signalColorCount` 只决定当前节点显示多少个颜色项，实际绑定目标固定为 `signalColors.0` 至 `signalColors.7`，`signalOpacity` 是范围为 `0..1` 的独立数值目标。按节点生成通信参数时，颜色索引小于当前 `signalColorCount` 的项目正常显示；索引已经存在绑定时，即使随后减少颜色数量也必须继续显示，直到解除绑定。不得直接按当前数组长度删除或静默丢弃高位关系。旧图纸的 `signalColor` 继续作为 `signalColors.0` 的静态回退。

运行时由 `sourceBindingRuntime` 为每个 `sourceId + jsonPath` 生成稳定键，同一来源的多个状态路径可以分别驱动不同灯位，不会互相覆盖。`runtimeNodeMaterializer` 只在存在有效颜色覆盖时浅拷贝一次调色板，并在复制前限制为前 `8` 项；颜色继续经过统一安全转换，非法值、无结果和不可用质量回退对应静态灯位。`signalOpacity` 使用 schema 的数值上下界转换。物化结果只交给 `NodeVisual` 和 Canvas 渲染器，禁止写回原始 `node.signalColors`、`node.signalOpacity`、图纸 JSON 或撤销历史。信号灯轮换监听使用由动画配置和前 `8` 个有效颜色组成的稳定签名；不透明度或其他无关运行值更新不得重置信号灯颜色相位。

表格数据的标准绑定契约为：

```json
{
  "columns": [
    { "key": "device", "title": "设备" },
    { "key": "value", "title": "数值" }
  ],
  "rows": [
    { "device": "风机 A", "value": 1480 },
    { "device": "风机 B", "value": 1520 }
  ]
}
```

JSONPath 应优先指向完整数据集，例如 Demo 的 `$.table`，这样可以保留 `columns[].title`。`$.table.rows` 也受支持，但会从行内容推断列名；`columns` 可省略，对象行按键、数组行按最大宽度推断，标量行生成单列“值”。单元格应优先使用 string、number、boolean 或 null 等标量。运行时最多物化 50 行、12 列；复杂值沿用统一格式化预算：最多 4 层、12 个对象键、12 个数组项、48 个总条目和 256 个输出字符。测试必须固定 14 条 Demo 的 `$.value` 兼容性、丰富字段类型、标准 `table` 结构、`$.table` 标题/行物化、`$.table.rows` 推断以及刷新、测试连接和迁移后的样例稳定性。

`workspacePointSourceStore` 默认使用 IndexedDB `tc2d-point-sources/workspace-point-sources`。存储接口中的 `workspaceId` 名称为兼容保留，应用实际传入的是“工作空间 + 图纸”的作用域键，因此每张图纸发布一个独立 v2 manifest。点位默认按 `256` 条 structured-clone shard 保存。写入顺序必须是“新 revision 全部分块成功 → 发布 manifest → 清理旧 revision”；任一步骤失败都保留上一 durable manifest，并让当前页最新状态进入 memory-only，不能用半套分片替换旧快照。manifest 的 `pointChunkMaxItems` 是持久契约，缺失时只按历史 `256` 读取；chunk key 必须包含 scope/source、随机 store namespace、单调 revision 和 sequence，恢复时校验归属、顺序、重复引用、块数量、块上限与总点数。默认 `load/save/saveSource/removeSource/remove` 在 `navigator.locks` 可用时全部请求 `tc2d-point-sources:<encodedScopeId>` 独占锁，并在锁内强制刷新 durable manifest 与有效 chunk key 缓存；非 memory-only 路径不得复用锁外缓存，否则另一标签页已回收的 shard 会被旧 manifest 再次引用。锁 API 不可用或请求尚未进入回调即失败时只保留页内队列降级，不能宣称严格跨标签互斥；锁回调已经开始后抛错必须向调用方传播，禁止重复执行操作。旧 localStorage v1/v2 仅在 IndexedDB commit 成功后删除。每 4 次 IDB 操作使用 `scheduler.yield()`，不支持时 `setTimeout(0)`，不得等待 rAF 才继续持久化。

`pointCatalogGateway` 激活或刷新目录时必须先等待 `pointCatalogPreparation` 在私有集合中完成规范化、来源/点位 ID 查重、`sourceIndex/pointIndex` 和健康/离线统计。默认预算为 `4ms` 且每片最多 `4096` 次操作；新任务用 generation 取消旧任务，完成后 `installPreparedCatalog()` 一次替换全部引用。可见页面使用 rAF，隐藏页面使用 timer，避免挂起。任何重复 ID、异常、supersede 或 dispose 都不得把半成品安装到活动网关。

## 7. 图纸文件读写与恢复缓存

项目图纸目录、其他位置文件和浏览器恢复缓存共用同一数据结构。当前格式版本为 `20`：

```json
{
  "version": 20,
  "projectId": "project-550e8400-e29b-41d4-a716-446655440000",
  "revision": 3,
  "createdAt": "2026-07-22T08:00:00.000Z",
  "updatedAt": "2026-07-22T08:12:00.000Z",
  "fileName": "生产监控",
  "nodes": [],
  "edges": [],
  "drawings": [],
  "customComponents": [],
  "stageWidth": 6000,
  "stageHeight": 4000,
  "canvasBg": "#f7f8fa",
  "canvasBorderColor": "#cbd3d9",
  "canvasBorderWidth": 1,
  "showGrid": true,
  "gridColor": "#dde3e7",
  "gridStyle": "line",
  "snap": false,
  "gridSize": 20,
  "lineColor": "#485563",
  "lineWidth": 2,
  "lineDash": false,
  "lineStartMarker": "none",
  "lineEndMarker": "arrow",
  "lineAnchorMode": "edge"
}
```

`projectData()` 生成完整图纸，`applyProject()` 只接收已经准备完成的数据并统一恢复图纸、索引和视图。图纸库、其他位置和 localStorage 兼容恢复中的 JSON 字符串必须走共享 `projectJsonParser.parseAndPrepare()`；IndexedDB 恢复出的对象走 `projectJsonParser.prepare()`。正常路径由 `projectJson.worker.js` 先解析 JSON，再调用 `prepareProject()` 完成结构/容量校验、旧版本迁移和模型归一化，不允许把这些阶段拆回主线程。Worker 按 `prepared-project-chunks-v1` 协议依次回传 envelope 与 `nodes/edges/drawings/customComponents`，每块最多 `128` 项并以 `1MiB` 估算预算控制结构化克隆；主线程必须校验协议版本、集合顺序、sequence、start、声明总数、超大实体标记和 complete 后才组装结果。Worker 不可用、构造/发送失败、运行崩溃或消息错误时结算全部 pending 并在主线程执行同一个 operation；失败 Worker 标记为不可用，不能留下永久 pending 或反复创建。仅用于 localStorage 跨标签通知和保存前冲突判断的轻量路径调用 `parseHeader()`，Worker 只返回 `projectId/revision/updatedAt`；不得调用完整 `parse()` 或 `parseAndPrepare()` 把整图克隆回主线程，也不得用头部接口绕过正式打开/恢复的准备链路。

Worker 返回的是已经校验、迁移和归一化的项目数据，不是可直接发布到编辑器的活动运行索引。`applyProject()` 必须先等待 `projectRuntimePreparer.prepare(data)`：任务把实体集合包装为响应式集合，并按默认 `4ms` 时间片建立节点/线稿/时间 Map、运行键和源绑定反向索引、节点/线稿/连线空间索引、连线邻接、双游标图层分配器和有序 `layerEntries`。只有完整结果 ready 且组件生命周期仍有效时，`installPreparedEntityCollections()` 才一次替换实体集合与所有活动索引；新图纸、重置或卸载必须取消旧任务。该预算不能与 `documentIndexCompactionScheduler` 的 `2ms` 混淆，后者只处理高出度交互结束后的节点空间、连线空间和邻接三索引压实。

版本 `4` 为节点和铅笔线稿持久化统一 `layer`；版本 `5` 增加画布宽高、边框、网格颜色和网格样式；版本 `6` 增加项目标识、修订和时间元数据；版本 `7` 增加视频组件播放字段以及图纸级连线起止端口和锚点模式；版本 `8` 增加时间固定值、计时与服务器校准字段；版本 `9` 增加视频自动播放和控制器显隐字段；版本 `10` 增加表格标题、表头、内容字体和对齐以及内框样式；版本 `11` 增加表头高度和逐行高度，并修正表格最末行列的边界绘制；版本 `12` 增加表格长文本自适应与缩略查看；版本 `13` 增加非破坏性的单元格合并区域；版本 `16` 增加表格像素列宽及任意行列编辑；版本 `18` 增加节点 `groupId` 与图纸级 `customComponents`；版本 `19` 把落笔完成的铅笔线稿统一迁移为 `pencil` 节点；版本 `20` 把旧直线从“固定容器加描边粗细”迁移为真实 `w/h` 矩形本体，原 `borderWidth` 转换为高度、原描边色转换为填充色，并调整 Y 坐标保持视觉中心，顶层节点和 `customComponents` 模板节点执行同一迁移。打开旧图纸时还会补齐缺失字段，缺少 `groupId` 的节点按未组合处理，缺少 `customComponents` 的图纸使用空模板列表，旧 `drawings` 自动转换并清空，旧连线默认保持“起点无端口、终点箭头、组件边缘”语义。

`customComponents` 必须与 `nodes`、`edges`、`drawings` 一起进入 `projectData()`、`prepareProject()`、`applyProject()`、恢复缓存和多图纸会话快照。它属于当前图纸文档，不应另存为仅当前浏览器可见的独立 `localStorage` 数据。加载模板时要校验模板 ID、节点 ID 唯一性、尺寸、节点数量及内部连线端点；删除模板只修改模板列表，不删除画布上已实例化的节点。顶层节点恢复后必须按组合集合归一化，模板节点迁移和实例化后必须按整套模板归一化，不能因序列化入口不同而改变成员相对坐标。

左侧“图纸”分类维护轻量图纸会话列表，列表本身使用浅层响应式容器，避免大型图纸被重复深度代理。每个会话至少保存以下边界状态：

```js
{
  id,            // 编辑会话的稳定标识
  data,          // 完整图纸数据
  file,          // 项目图纸库文件身份与 ETag
  customHandle,  // 用户授权的其他位置文件句柄
  history,       // 该图纸独立的撤销栈
  future         // 该图纸独立的重做栈
}
```

左侧共用搜索框的占位文字必须随分类切换：“图纸”为“搜索图纸”，“组件”为“搜索组件”，“我的”为“搜索我的组件”。图纸筛选由 `filterPaperEntries()` 对会话展示标题 `title` 和实际文件名 `targetName` 做去除首尾空白、英文不区分大小写的包含匹配；空关键词保持原列表顺序。`filteredPaperSessionEntries` 只控制卡片渲染，不得修改 `activePaperSessionId`、会话数据或历史；切换分类时清空搜索词，避免跨分类残留过滤。

切换图纸前先捕获当前会话的图纸数据、文件目标和历史，随后恢复目标会话。`activePaperSessionId` 表示唯一的当前编辑及保存目标，不能与只负责显示右侧画布属性的 `paperSelected` 混用。新建操作追加空白会话，选择卡片激活对应会话，删除活动会话后选择相邻会话；列表为空时立即补建一张空白图纸。不同工作空间分别持有会话集合，切换后不能复用另一工作空间的文件目标或撤销历史。完整会话由 `workspaceSessionStore.js` 保存到 IndexedDB，内存 `workspaceSessionCache` 只在最新版本快照成功落盘后把工作空间标记为可淘汰；`beginSave()/isSaveCurrent()/completeSave(version)` 拒绝迟到保存写入或把较新状态误标为已持久化。保存失败、浏览器不支持 IndexedDB 或自定义文件句柄不可克隆时必须保留最新内存状态；句柄克隆失败可重试不含句柄的快照，不能直接丢弃整个会话。目标容量为 3，但脏条目不能被硬淘汰。

自动会话保存必须使用 `cancellableIdleTask.js`，不能在 debounce timer 到期后直接执行全量 IndexedDB `put`。每次新编辑先 `markDirty()` 提升工作空间保存版本，使此前仍在途的保存令牌失效，再取消旧 debounce 与 idle generation 并重新调度；旧保存成功只能结算自己的 I/O，不能把较新的脏状态标为已持久化或允许 LRU 淘汰。回调执行前校验仍属于原工作空间，同时拒绝活动 `operation`、`interactionCommitBarrier`、文件操作、工作空间切换和 `navigator.scheduling.isInputPending({ includeContinuous: true })`，普通 idle deadline 的 `timeRemaining()` 必须至少为 `8ms`。忙碌或预算不足时以 `500ms` 重排；`requestIdleCallback` 设置 `2500ms` timeout，超时 deadline 可跳过普通预算检查，防止无交互时长期饥饿。`requestIdleCallback` 不可用或抛错时使用同样可取消、带 generation 隔离的 timer 降级。显式文件保存和切换工作空间必须先取消自动任务，再直接 `await storeWorkspacePaperSessions()`；它们不能为追求后台化而经过 idle gate。组件卸载必须 `dispose()` idle task。

真正的会话编码由 `encodeWorkspaceSessionSnapshot()` 增量完成，禁止恢复 `JSON.stringify(snapshot)` 后把整对象交给 IndexedDB。默认 `DEFAULT_TIME_SLICE_MS = 4`、`DEFAULT_CHUNK_SIZE = 64 * 1024`，长字符串每次最多转义 `4 * 1024` 字符；输入待处理或时间片用尽时调用 `scheduler.yield()`，不可用时 `setTimeout(0)`。输出 record 只包含格式版本、Blob chunks、字符长度、`customHandles` 及其恢复路径，IndexedDB 对单 key 做一次原子 `put`；旧 object record 由 `decodeWorkspaceSessionRecord()` 原样兼容。自定义句柄留在 JSON 外并按路径恢复，路径遍历必须逐段要求 decoded snapshot 的 own property，不能经 `__proto__` 等继承属性离开快照；损坏 chunk、格式、句柄数量或路径都返回受控失败。DataCloneError 才在同一队列任务中尝试无句柄 fallback。

`persistWorkspacePaperSessions()` 必须把 `isFresh: () => workspacePaperSessions.isSaveCurrent(workspace, saveVersion)` 传入 save queue。编码开始、每个任务、让步恢复后及 `driver.put()` 前都要检查 freshness；stale 结果直接返回，不弹存储失败提示、不尝试 fallback、不调用 `completeSave()`。原子 `put` 成功后还必须返回 `completeSave(workspace, saveVersion)` 的真实布尔值：若写入期间又发生编辑，旧快照可作为历史恢复点存在磁盘，但内存仍保持 dirty、不能被 LRU 淘汰，调用方也不能报告“最新会话已落盘”。store `close()` 同样必须让在途编码在写入前失败。该门禁防止一个快照在增量读取期间夹杂两个文档版本，也防止排队旧快照晚到覆盖新状态。

`switchWorkspace()` 必须把整个交接包在 `workspaceSwitchPending` 屏障内，并用 `finally` 解除。进入屏障后，`.app-shell` 设为 `inert/aria-busy`，独立的 `workspace-switch-shield` 阻止命中，`keydown()`、`pointerMove()`、`applyPointerMove()` 和线段起点拖动入口还要保留状态级门禁，不能只依赖 DOM 遮罩。`settleWorkspaceSwitchInteractions()` 依次结束线段起点拖动、取消待提交缩放、完成滚动、清除连接锚点、提交现有 `operation`，然后同时等待 `interactionCommitBarrier.whenIdle()` 和 `workspaceAsyncOperationBarrier.whenIdle()`；后者登记异步组件包 capture/insert 及图片/视频 FileReader，已经开始的用户操作必须结算，不能因切换被静默丢弃。随后严格按 `saveLocal({ silent: true }) → await storeWorkspacePaperSessions() → 更新 workspaceId → await restoreWorkspacePaperSessions()/restoreStoredWorkspaceProject()` 执行，禁止把捕获、持久化或恢复改成 fire-and-forget。

首次挂载恢复同样在 `workspaceSwitchPending` 下完成，并在每个 `await` 后检查 `componentLifecycleActive`。卸载顺序必须先置 lifecycle false、abort 活动 FileReader、取消 bundle，再 dispose async barrier、`projectJsonParser` 和 `workspaceSessionStore`；所有迟到回调都需以生命周期或 token 拒绝写回。Worker 故障后的主线程解析同样携带 parser lifecycle generation，`ProjectJsonParserDisposedError` 与“缓存 JSON 损坏”不是同一语义，卸载竞态不得删除合法 localStorage 兼容副本。

项目根目录的 `图纸库/` 继续沿用项目已有的打开、保存能力，并在打开对话框提供文件删除。顶部“打开”按用户操作读取目录文件，禁止通过轮询反复加载大图纸；左侧“图纸”页只展示当前打开或新建的前端会话。两者语义不能混用：点击左侧图纸卡调用 `activatePaperSession()` 切换内存状态，而在打开对话框选择文件时，`openProjectDrawing()` 必须始终执行 `drawingRepository.get() → projectJsonParser.parseAndPrepare() → applyProject()`。若已经存在同名文件会话，则复用其 `id` 和列表位置，但用仓储最新数据、ETag、空撤销栈和空重做栈整体替换旧会话；禁止因命中 `openSession` 而提前返回，否则会出现 JSON 有节点而画布继续显示旧空会话的问题。“打开其他位置”复用浏览器文件选择能力。顶部“保存”和 `Ctrl+S` 调用同一保存函数，并且只读取 `activePaperSessionId` 对应会话：当前文件属于默认目录时覆盖原文件，新图纸按规范化后的图纸名称写入默认目录；“另存为”通过用户选择的位置写入副本。未保存会话的规范化目标名若命中 `drawingFiles`，卡片位置状态显示“未保存 · 同名冲突”；两个未保存会话按后端大小写语义得到相同目标名时显示“未保存 · 同名目标”。两种状态都显示完整的 `图纸库/<名称>.json` 目标，tooltip 分别指出磁盘冲突或另一会话冲突；这些标识只做保存前提示，不把新会话绑定为已有文件。顶部不再保留“文件”按钮，“图纸”页也不再维护一套独立的 JSON 导入、导出语义。

文件名需移除路径成分并处理 Windows 非法字符、保留名和 `.json` 扩展名；读取、写入和删除继续受容量、图纸结构、普通文件及目录边界约束。`DELETE /api/drawings/:name` 必须与保存进入同一文件队列，要求精确 `If-Match` 且拒绝通配符；版本不同时返回 `412`，不能删除已被改写的新版本。`HEAD /api/drawings/:name` 只对目录边界内的普通非符号链接文件做真实存在性探针，不读取、解析或应用单图大小限制；存在返回 `204`，不存在返回 `404`，方法集合的 `Allow` 为 `GET, HEAD, PUT, DELETE`。删除成功后，`detachProjectDrawingSessions()` 必须清理当前及缓存工作空间的同名项目文件身份，把已打开内容保留为未保存图纸。删除失败时，过滤后的图纸列表不能作为“不存在”证据；只有 DELETE 的 `404` 或 `drawingRepository.exists()` 对 HEAD `404` 返回 `false` 才能解绑，探针其他错误必须保持会话文件身份。左侧图纸分类的删除仍只移除浏览器中的编辑会话；项目图纸库删除不得扩展到用户“其他位置”的文件。浏览器提交的绝对路径不能直接交给文件 API；“用户自定义目录”只通过受用户授权的系统文件选择能力访问。

`tc2d-active-workspace` 只记录最近工作空间；完整多图纸会话按工作空间写入 IndexedDB。`tc2d-project:<encodedWorkspaceId>` 是当前活动图纸的小型 localStorage 兼容恢复副本，默认工作空间首次读取时可从旧 `tc2d-project` 迁移；它不是完整会话或正式文件来源。无现成序列化文本时，兼容副本必须调用 `encodeBoundedJsonText()`，复用默认 `4ms` 时间片、最长 `4KiB` 字符串切片和输入让步；超过 `MAX_LOCAL_PROJECT_CACHE_CHARS`（约 4 百万字符、4MB 量级）立即早停并删除旧 key，禁止先同步 `JSON.stringify` 整张图纸。任务在编码中和写入前校验 generation、workspace、storage key、project、document version 与组件 lifecycle，迟到结果不得写回。IndexedDB 恢复逐张过滤损坏会话；若全部无效则删除坏快照并回退兼容副本，不能让一张损坏图纸阻断整个工作空间启动。

项目 `图纸库/` 的本地 API 默认对单图读取与写入限制 `256 MiB`，可通过 `TC2D_MAX_DRAWING_BYTES` 覆盖。磁盘超限文件在读取前被拒绝，列表忽略、直接打开返回 `413`；请求体超限同样返回 `413`。浏览器授权的其他位置不经过该 API，但仍受浏览器和设备限制。文件字节大小和图纸对象容量是两类独立边界：

| 结构 | 当前上限 |
| --- | ---: |
| 画布节点与旧临时线稿合计 | 10,000 |
| 连线 | 20,000 |
| 旧临时线稿 | 5,000 |
| 顶层与模板中的铅笔、线段和旧线稿点数合计 | 250,000 |
| 单个顶层或模板 `polyline` | 10,000 点 |
| “我的”模板数量 | 200 |
| 全部模板节点合计 | 2,000 |
| 全部模板内部连线合计 | 4,000 |

容量校验由 `projectValidation.js` 在前端导入与 Vite 服务端共同复用；顶层节点、旧 drawing 和模板节点中的 `pencilPoints/polylinePoints` 都计入路径总量，顶层及模板单条 polyline 都执行 10,000 点门禁。模板几何、重复 ID、内部悬空连线和顶层悬空连线也在同一契约校验，不能在前端静默截断后保存另一份语义。单个本地视频仍限制为 `20MB`，只约束媒体上传入口；远端生产后台还需在自身接口和部署说明中声明限制，不能假设本地环境变量会配置远端服务。

`httpClient` 的普通请求默认使用 `15s` 超时。图纸列表、读取、保存、删除和 HEAD 存在性探针都可能等待磁盘队列或处理大文件，当前 `drawingRepository` 为这五个操作显式传入 `timeoutMs: 0`，避免合法操作被固定超时截断。只有 `exists()` 的明确 `404` 返回 `false`，其他状态继续抛错。生产适配器应根据后端容量提供可配置超时、用户取消或分片/对象存储方案，不能把当前本地适配器的无限等待直接当成通用网络策略。

保存时先从当前激活会话取得文件身份，并基于该图纸的 `revision` 生成待写入数据；请求发出前同步生成不可变 JSON 文本，文件写入与恢复缓存必须复用同一文本。保存进行中禁止切换、新建、删除图纸或切换工作空间，返回结果还需校验发起保存的会话 ID；确认成功后再更新同一会话的 `revision`、`updatedAt` 和文件身份，不能从其他高亮项或上一个会话推断保存目标。新建请求发生 `409/412` 后刷新 `drawingFiles`，让同名状态立即反映到卡片；已有文件发现修订冲突时客户端不得静默覆盖。取消文件选择、读取失败、文件无效或保存失败时，当前编辑图纸和当前文件身份保持不变。

图纸切换是运行时边界：选择、操作、预览、实时值和通信状态必须清空，但撤销、重做与文件目标属于各自图纸会话，应在切换前捕获并在恢复该会话时还原。彻底关闭或删除会话时再释放其历史。生产服务端不能把客户端工作空间名称当作权限依据，完整约束见 `docs/多人使用与数据隔离.md`。

## 8. 坐标规则

- `x/y/w/h` 始终是未缩放的画布逻辑像素。
- 屏幕坐标通过 `pointFromEvent()` 结合滚动位置和 `zoom` 转换。
- 编辑画布的真实原点固定为 `stage-space` 的 `(0,0)`，占位尺寸始终严格等于 `stageWidth × zoom` 和 `stageHeight × zoom`，不得在舞台前后增加伪画布、滚动缓冲或复制网格。初始化、重置和适配视图都从左上角 `(0,0)` 开始。缩放范围由 `MIN_CANVAS_ZOOM = 0.2` 和 `MAX_CANVAS_ZOOM = 10` 统一定义为 `20%–1000%`；滚轮与工具条按钮都通过 `steppedCanvasZoom()` 按每档 `1.1` 倍变化，函数在对数域判断边界，任意有限档位数都应单调饱和到对应端点，不得因指数溢出或下溢回到原倍率。`createCanvasZoomTarget()` 在一轮滚轮开始时同时保存鼠标在画布内容区的局部 `anchorX/anchorY` 与对应 `worldX/worldY`，随后通过 `anchoredCanvasScroll()` 使该逻辑点在倍率变化后仍落在鼠标原屏幕位置；只有目标滚动超出真实范围时才对 X/Y 各轴独立夹取到 `[0, maxScroll]`。连续滚轮只要鼠标没有移动超过 `8px` 就复用首次屏幕与世界锚点，并以 `projectedCanvasZoom` 的倍率和滚动位置作为下一目标的 source；鼠标明显移动、离开画布、重置、固定画布、拖拽、按钮缩放或鹰眼导航时清除锚点。`canvasWheel()` 合并同一动画帧内的全部档位。`applyTransientCanvasZoom()` 不得逐帧设置 `zoom.value`、刷新鹰眼或更新逐节点反向尺寸；目标视口逃出当前覆盖时，必须先通过 `transientCanvasRenderBounds` 合并当前与目标范围，以空间索引增量挂载节点及线稿，等待 DOM 更新后再修改 `.stage-space` 宽高、`.stage` transform 和滚动位置。临时范围在同一手势中只能扩大，不能卸载已经显示的对象；最后一次滚轮停顿 `96ms` 后，`scheduleCanvasZoomCommit()` 必须先提交 DOM 实际视口，再一次发布 `zoom.value` 并清除临时范围。工具条按钮没有鼠标事件时以当前视口中心为锚点，并在 `nextTick()` 后确认目标仍有效、实际应用 transform 与 `scrollTo()`，再原子提交倍率，不能让扩展挂载的延迟帧被提前清空。`onUpdated()` 只在其他响应式更新覆盖投影样式时恢复它。重置、固定、开始操作和卸载必须清理 RAF、timer、投影、临时范围与手势状态。旋转按钮布局、框选最小拖动距离和铅笔采样间距仍使用最终真实 `zoom` 换算。`deltaY = 0`、固定画布或节点操作进行中不改变视口。
- 低倍率 LOD 的网格只能由 `.editor-lod-background` 和当前 detail 窗口内的 `.editor-lod-detail-background` 绘制。整图层级必须为背景 `0`、fallback Canvas `1`、detail 窗口 `2`、透明交互 stage `3`；detail 窗口内部必须为不透明背景/网格 `0`、透明 Canvas `1`。普通 `.canvas.grid.grid-line/.grid-dot` 规则必须通过 `.stage:not(.editor-lod-stage)` 排除透明交互 stage，`.canvas .stage.editor-lod-stage` 还要显式保持 `background-color: transparent`、`background-image: none` 和 `box-shadow: none`。不得依赖 CSS 声明顺序覆盖普通网格。`editorLodGridPresentation()` 只按 `2` 的幂次抽稀视觉网格，使屏幕 pitch 始终不低于 `8px`，并保证线条网格的屏幕线宽及点阵直径不低于 `1px`；吸附和序列化仍使用原始 `gridSize`。detail 背景必须以已提交 `frameZoom/bounds` 计算相位，并与父窗口一起投影，不能分别使用当前尺寸而产生边界错位。对应回归必须同时断言 DOM 顺序、`0/1/2/3` 层级、detail 内部 `0/1` 层级、线条/点阵选择器排除规则、`20%` 最小 pitch/线宽和跨档位网格相位。
- 编辑 detail Canvas 必须通过独立 `pixelRatio` 使用固定 `3x` 目标 backing，并受 `MAX_EDITOR_LOD_DETAIL_BITMAP_PIXELS = 12_582_912` 约束；整图 fallback 仍固定为 `1_048_576` 像素上限，不能把 detail 的内存成本扩散到鹰眼或自适应预览。预算不足时先缩减不可见 overscan，再有界降低实际倍率。detail 必须传入 `minimum-screen-stroke-size="1"`，保证 faithful 节点描边、连线、铅笔和线段至少为 `1px` 屏幕宽度。`ready` 表示存在可继续显示的 committed frame，`fresh` 表示该帧匹配当前世代；普通失效只能清除 `fresh`，不得在已有 committed frame 时立即隐藏高清窗口。`atomicCssSize` 必须让父窗口、内部网格和 Canvas 继续使用同一 committed frame 的尺寸和投影，新完整帧完成后再原子替换；旧帧属于 stale 过渡，其有效密度会随放大投影降低，不能冒充当前目标倍率。拖动、缩放和旋转通过两张 Canvas 的 `geometryInteractive` 会话只 patch 旧/新边界，删除及撤销删除必须由 `patchRemovedEditorLodEntities()` 同时调用 fallback 与 detail 的 `patchRemovedEntities()` 清理残影。删除连线边界使用本次 payload 节点覆盖当前索引，只建立受影响实体的小型 Map，不得复制或扫描完整 `nodeIndex`。几何会话开始前要调用 runtime backing mutation，使在途 runtime task 失效并释放 back surface；会话取消后若仍有 runtime dirty/follow-up，存在合法增量基线时立即调度 replay，否则请求权威完整帧。权威 geometry full 提交后，交互期间累积的运行值也必须继续重放。正常局部 patch 成功时不得隐藏 detail 或同步重绘整张图；detail 局部 patch 退化、脏区与 committed frame 相交且 fallback 已提交时，使用基础 `polygon(...)` 默认 nonzero 环绕把已可靠更新的旧/新局部边界从 detail window 透明挖出，孔洞外继续保留高清帧。能力检测只检查基础 polygon，并兼容 WebKit 前缀；检测失败时也保留高清 detail 和活动 DOM，等待 detail patch 或权威 full 恢复，绝不允许整窗切到 fallback。任何路径都不能创建不透明脏区遮罩。连续删除的 fallback 资格随每次局部 patch 取逻辑与，权威 fallback full 成功后才可重新置真，任一 fallback 错误立即撤销；打开预览前必须取消未完成几何会话并清除完成屏障，避免 detail 卸载后永久等待。整体换图必须先取消两张编辑 Canvas 的几何会话和 pending render；替换集合、重建索引、安装新尺寸并重置视口后，显式执行 `syncEditorLodDetailBounds(true)`，再 prime 当前文档的 bootstrap，不能依赖 `editorLodActive` 或同尺寸响应值发生变化。超大视口应接受像素上限下的有界降级或改用瓦片，不得无限提高整块位图上限。
- 鹰眼由 `MiniMapPreview.vue` 把当前 `stageWidth × stageHeight` 逻辑尺寸映射到 `240 × 150` 容器。主鹰眼必须显式传入 `fitMode="contain"` 和 `faithful`：`contain` 取 `min(width / stageWidth, height / stageHeight)` 作为横纵统一比例，并把未占满方向的空白均分到两侧；`faithful` 保留节点原始字号、线宽和裁切语义，不再为小投影强制放大外观。容器使用中性灰背景；Canvas 每帧先清空全部位图，再只填充和裁切 `offsetX/offsetY/contentWidth/contentHeight` 对应的真实画布范围，不能把 `contain` 留白涂成图纸背景。“我的”模板同样使用 `contain`，但继续通过 `preferText` 提高卡片中文字的辨认度，不能把两种模式混用。
- `src/utils/miniMapGeometry.js` 是鹰眼坐标的唯一入口。`miniMapTransform()` 产生等比比例、内容尺寸和居中偏移；`miniMapViewportRect()` 使用同一变换投影当前滚动窗口，主鹰眼传入 `12px` 最小可视尺寸。自然投影小于该尺寸时，`containedSpan()` 必须围绕自然投影的真实中心向两侧扩展，仅在接触缩略内容边界时夹取，不能从左上角单向放大；`miniMapWorldPoint()` 使用同一变换反算点击位置，并把留白区域的结果夹取到真实画布边界。修改缩略图尺寸或适配方式时，禁止在 `App.vue` 中重新手写一套比例，否则会再次出现画面、当前窗口框和点击导航互相偏移。
- `.minimap-canvas-frame` 使用 `miniMapTransform()` 的 `offsetX/offsetY/contentWidth/contentHeight` 定位，以低对比深灰 `2px` 边框单独标识整张画布；`.minimap-viewport` 使用原来的 `#168eea`、`2px` 蓝框标识当前窗口，并由 `miniMapViewportRect()` 保证始终位于整张画布框内部。两层都必须保持 `pointer-events: none`，不能拦截鹰眼点击导航。
- 主画布与鹰眼连线均复用 `src/utils/edgeGeometry.js` 的 `edgeEndpointsForNodes()`。该函数统一处理旋转节点边界、中心/边缘锚点和起止标记预留距离；鹰眼随后按相同端点绘制箭头、圆点或方块。节点和临时线稿按真实 `layer` 混排，连线先绘制；若后续调整主画布图层或锚点规则，必须同步修改共享纯函数，不能只补鹰眼分支。
- 鹰眼不挂载第二套 `NodeVisual` DOM。`MiniMapPreview.vue` 在 Canvas 中绘制节点、表单静态值、图片、铅笔线稿、多点线段和连线；`polyline` 必须按实际归一化路径、线型、分段参数、轮廓和首尾箭头绘制。主页面在文档真实变化后由 `markMiniMapDirty()` 合并调用组件暴露的 `requestRender()`；组件只观察数组引用/长度、尺寸和显式修订等浅层契约，不使用深层 `watchEffect` 遍历全部节点。主鹰眼直接复用父级 `nodeIndex` 和有序 `layerEntries`，避免重复建立 ID 索引和排序图层。
- 每次鹰眼请求必须创建私有离屏 Canvas，禁止在分片阶段直接修改可见 Canvas。`createChunkedRenderScheduler()` 依次处理节点索引、连线、实体准备、归并排序和实体绘制，每片预算为 `2ms`；`scheduleRenderSlice()` 支持时使用 `requestIdleCallback(..., { timeout: 120 })`，否则回退 `setTimeout(0)`。存在 `IdleDeadline` 时，剩余时间不足完整预算不得创建任务；`didTimeout` 只授予 `min(1ms, budget)`，但必须至少推进一个循环单元，避免永久饥饿。新请求必须取消旧句柄、递增世代并释放旧位图；回调执行前后都要核对活动任务和世代，过期任务不得提交。只有当前任务完成后，`commitRenderTask()` 才通过一次 `drawImage` 原子更新可见 Canvas，提交异常也必须精确释放当前私有任务。卸载必须调用 `renderScheduler.dispose()` 并清空图片缓存。新增可见字段时必须保证修改入口触发 `markMiniMapDirty()`，并在 Canvas 绘制器中提供足以辨认的静态外观；视频仍以缩略视觉表示，不要求在鹰眼中解码连续视频帧。
- 默认关闭网格吸附，可按任意像素摆放。
- 开启吸附后使用 `gridSize`；拖动时按住 `Alt` 可临时自由摆放。
- 画布逻辑尺寸由 `stageWidth`、`stageHeight` 保存，允许 `320–20000px`，旧图纸默认使用 `6000 × 4000`。

### 鹰眼回归方法

1. 使用宽高比明显不同于鹰眼的图纸验证等比映射。例如 `9355 × 2643` 画布映射到 `240 × 150` 时，`scaleX` 和 `scaleY` 都应约为 `0.02565473`，内容高度约为 `67.805px`，上下留白各约为 `41.097px`，不得出现横纵独立拉伸。
2. 分别检查中性灰容器、深灰整张画布框和蓝色当前窗口框能够清楚区分，Canvas 内容不得填充到 `contain` 留白。把主画布滚动到左上、中央和右下，蓝框必须始终落在深灰整图框内；自然宽度或高度小于 `12px` 时，扩展后的框仍以自然投影中心为中心，触及整图边界时才夹取。再点击画布四角和容器留白区，确认主画布定位与 `miniMapWorldPoint()` 的边界夹取一致。固定画布后点击鹰眼不应改变视口。
3. 在同一图纸加入图片、文字、旋转节点、表格、铅笔、带首尾箭头的多点线段、不同图层组件，以及中心/边缘锚点和不同起止标记的连线；对照主画布检查比例、位置、遮挡顺序、路径、锚点和标记方向。修改任一鹰眼可见属性后，缩略图应在下一次合帧中更新。
4. 自动化至少覆盖 `miniMapTransform()` 的统一比例和居中偏移、视口投影与点击反算往返、共享连线端点、主鹰眼模板保持 `fit-mode="contain" faithful`，以及调度器的 `2ms` 分片接线、空闲截止时间不足时延期、超时最小推进、过期世代丢弃、私有 Canvas、完成后单次提交和提交异常资源释放。随后运行 `npm run test:stability` 和 `npm run build`，并在浏览器检查控制台及实际大图纸。

## 9. 维护约定

- 组件入口、名称、默认尺寸和表单默认样式只在 `src/config/componentCatalog.js` 维护，页面不得重新声明副本。
- 节点、表格、铅笔、线段和连线的持久化默认值及旧字段兼容只在 `src/models/editorModel.js` 维护；所有导入、恢复和模板实例化入口必须复用该模型。
- 新增模型兼容逻辑时同步补充 `scripts/editor-model.test.mjs`，测试实际输入输出，不以实现必须位于 `App.vue` 作为断言。
- 无用代码清理必须同时核对结构化语法树、Vue 模板引用、跨模块 import/export、Worker URL 和测试调用；不能仅按字符串出现次数删除。确认生产无引用后，应删除只为保留旧声明而存在的源码正则断言，改为验证真实状态、调用顺序或渲染结果。清理不得顺手拆分首次编辑、低倍率 LOD 或自适应预览的必需模块，也不得合并会增加 Worker/热路径依赖的局部小函数；较大的组件拆分必须作为独立变更重新执行浏览器大图基准。
- `package.json` 的直接依赖必须使用已验证的明确版本并与 `package-lock.json` 一致，禁止使用 `latest`。Vue 和界面运行库放在 `dependencies`，Vite 及其插件放在 `devDependencies`；调整依赖后至少执行 `npm ls --depth=0`、离线安全审计、稳定性测试、性能测试和生产构建。
- `vite.config.js` 必须同时保留前置 `cleanBuildOutputPlugin()` 与 `build.emptyOutDir: true`。插件只在 `configResolved()` 中解析一次实际 outDir；删除前先用 `relative(PROJECT_ROOT, outputDirectory)` 拒绝项目根目录本身和词法越界，再比较 `realpath(PROJECT_ROOT)` 与 `nearestExistingRealPath(outputDirectory)` 拒绝符号链接/现存祖先逃逸，只有通过两道边界才能递归清理。最终生产构建应独立顺序执行，并确认 `dist/index.html` 只引用本轮哈希且 `dist/assets/` 没有旧构建残留；并发代理或开发服务生成的临时产物不能作为交付构建。
- 文本排布回归必须覆盖连续空格 JSON 往返、非法 `textLayout` 回退横向、DOM 的 `break-spaces/vertical-rl`、两处 `v-memo` 依赖，以及 MiniMap Canvas 横排换行、按字素竖排和空格推进。低倍率可读字号必须复用原字号生成的行/列基线，并覆盖横排、竖排、组合缩放和宽高约束；正文超过 `512` 字符时还要覆盖 full/dense/sparse 三路、每 `32` 次操作检查 deadline、单片 `8,192` 次硬上限、布局完成前不推进游标、取消/异常清理与 geometry 权威完整帧降级。浏览器还需检查长横排与长竖排在编辑、预览、鹰眼、“我的”缩略图及保存重开的一致性。
- 线段的目录归属、拖拽起点、单击终点自动完成、默认四等分、起点锚点拖动与完整清理、网格吸附及 `Alt` 临时取消吸附、结束后复位选择、段数弧长重采样、旋转节点拖拽重包围框、单次字段历史、三态线型、首尾箭头和多视图渲染由 `scripts/polyline.test.mjs` 及编辑器交互测试共同覆盖；直线仍在基本形状、线段单独成类、组件库单击/双击不启动线段、拖动起点不新增节点必须作为回归契约保留。
- 大图性能回归必须覆盖 10,000 节点空间查询、大空白范围、节点 Map 尾部代理登记、时间/图层/空间/连线邻接索引的批次更新、双游标层级预留、删除/撤销同步、滚轮临时范围只扩不缩、新区域先挂载再合成、`96ms` 单次提交、单一 `--inverse-zoom`、嵌套渲染键缓存、卸载指针帧清理、结构面板倒序窗口化，以及鹰眼/低倍率编辑/自适应预览 Canvas 的分片、动态预算、世代取消、原子提交、尺寸变化失败回滚、局部运行值脏区和调度/提交异常释放；Canvas 故障注入还必须覆盖嵌套 `save()/restore()` 的 `try/finally`、创建期恢复、运行 seed 与几何 context/合成异常、坏 surface 隔离及权威完整帧恢复。运行值还要覆盖每 RAF `1 × 512`、重复 ID、整数批边界空终批、视口外 no-op、sparse front/back 轮换、sparse/dense 自动切换、私有工作面、条带 seed、dense replay、时间节点 dense 入口、几何取消后的 runtime replay，以及 union clip 单次 copy 在异常前不清除可见面。预览还必须覆盖第 513 个及其后节点、超阈值连线/线稿不丢失、DOM 世代保留新旧视口交集、纯 Canvas、最多 `24` 条的安全尾段、尾段夹带静态 node/drawing、超过 `16` 个 node 或 `128` 成本以及 24 条内无法覆盖 live 节点时的完整 DOM 回退、双排除集合、持久 live plane、无跨 surface 低密度启动帧、render plan 精确匹配、Canvas context 故障回退和非活动 surface/committed plan 释放。不能为方便改回每帧全量扫描、冻结目标视口所需节点、每次增删重建 Map、扫描全图求新层级、复制完整倒序图层、滚轮逐帧写 Vue `zoom`、Canvas 单回调绘制全图、字段命令序列化整图、预览实体硬截断、不验证图层与预算就混合 Canvas/DOM、在覆盖层重复 edges/drawings 或模板直接序列化嵌套数据。
- 边 Worker 回归必须证明 packed batch 与主线程 `drawEdgeRasterCommand()` 的完整调用序列一致，覆盖调用后恢复原 `lineCap`、Float64/Uint8/Uint16 transfer list、边数组或空间索引 `entries` 达到 2,048 的门槛、cursor 每次最多 256 个 index operations 且同一时间片尽量组成 512 条命令、顺序与 marker/dash 语义、单 active job、start/batch/finish 三阶段 8 秒失联、supersede/cancel、迟到 bitmap 关闭、Worker/消息/协议/合成失败回退及组件卸载释放。空间查询故障用例必须证明已收集 `task.edges` 从头重放后继续剩余 cursor，结果无遗漏、无重复。edge-only 完整提交还要断言不会保留无用的 static/composite 双离屏面。浏览器要在 20,000 条静态连线首次自适应预览和原始尺寸 edge-only 窗口中记录 Long Task，并把 Worker 帧与强制主线程基准做像素比较；不得用合并透明边 stroke 或跳过连线换取数字。
- 编辑挂载与连线密度回归必须覆盖：首屏超过 `128` 个节点时按 `8/64` 预算渐进 DOM，打开预览取消编辑帧，关闭预览及持久 LOD 退出重新渐进接管；普通倍率视口边超过 `1,024` 条时只把边切到 Canvas，节点和线稿 DOM 数量及交互保持完整，SVG 活动边最多 `128` 条，`renderNodes/renderDrawings=false` 在 full/runtime/geometry 路径都不绘制实体，模式 key 阻止旧帧提交。高出度节点还要证明 `countFor()` 在超过 `128` 后先于邻接枚举退出，指针帧几何和 overlay 都有相同上限，松手后才以私有索引分片重建并原子替换，强制重建不能被“无 segment”短路。
- 大型组件包回归必须覆盖 64 节点/128 连线阈值、`2ms` 捕获与实例准备、预热实例一次消费、私有索引附加、raw 尾部发布、后台索引压实和冷包占位。异步捕获、实例和压实必须同时校验文档版本与交互代次；指针、缩放、滚动、连线或线段拖动跨过任务时不得提交，key 相同的重试只能保留最新一个。capture/insert 还必须成对登记并结算 `workspaceAsyncOperationBarrier`，工作空间切换应等待已开始的 bundle 完成而不是取消用户操作。大选区回归必须验证 Worker 与同步基准几何等价，以及 Worker 创建/发送/运行失败三种情况都进入 `2ms` 可恢复任务，提交期间命令屏障有效。
- 实体历史回归必须验证 2,000 节点和 4,000 连线连续区间各只做一次批量移除/恢复、normalizer 调用为 0、嵌套引用和全部索引往返一致，并保留多次独立基准结果而非只报告最好的一次；成功 Undo/Redo 后必须调度会话持久化，空历史不调度。当前正式图纸前 2,000 节点样本的删除历史捕获为 `3.99ms`；一次早期 Undo/Redo P95 为 `9.506ms/4.354ms`，最终两次复跑为 Undo `15.809ms/14.627ms`、Redo `11.024ms/6.008ms`，全部低于 `16.7ms`。正式图纸没有连线，4,000 连线只能作为正确性压力数据，不能冒充正式图纸浏览器 P95。
- 运行值格式化回归必须限制输出长度、深度、对象键、数组项和总条目，并覆盖循环、抛错属性、撤销代理、Unicode 截断和 BigInt；自适应位图回归必须使用实际 DPR，分别验证活动 `8,388,608` 与非活动 bootstrap `4,194,304` 像素上限，不能以固定 DPR 或实体裁剪换性能。浏览器性能探针的帧、Long Task 和每标签交互样本必须保持有界，长时间采样不能线性增长内存。
- 预览交接回归必须同时覆盖两种竞态：文档修改后，运行值局部帧不能越过未提交的新文档完整帧；当前文档完整帧已经原子提交后，连续到达的 `pendingRuntime` 又不能让合法 Canvas 永久无法交接。完整帧还必须携带 `renderPlanKey + excludedNodeIds + excludedDrawingIds`，计划 key 与两组有序排除 ID 全部和当前计划一致且 freshness 通过后才提交 overlay 快照；计划途中变化、关闭、重开、原始/全屏切换和连续修改产生的旧回调都不能提交或改变可见层，committed plan 必须释放。对应纯状态机放在 `previewFrameFreshness.js`，不得把世代比较重新分散为 `App.vue` 中的无条件布尔赋值。还要覆盖 invalid/unrequested token 不启动 full、文档 debounce 只消费一次、排除计划立即 supersede、无 timer rejection 可恢复、有 timer rejection 等待，以及同尺寸私有 Canvas 取消后上下文 save 深度归零、恢复失败 surface 永不复用。预算可达像素比和完整帧实际像素比都必须达到请求值才允许 Canvas 交接；不足时 fit 保留 DOM、edge-only 保留 SVG。`contextlost`、context 不可用和失效提交 token 必须使 Canvas 立即回退 DOM、恢复后按新世代渲染；全屏回归同时模拟漏失 `fullscreenchange`，验证 resize/focus/visibilitychange 能按 `document.fullscreenElement` 校准。
- 完整 DOM 降级回归必须同时覆盖 `ProgressivePreviewNodes` 与 `ProgressivePreviewGeometry`：几何首批最多 `64` 条 edge/`8` 个 drawing，后续批次按提交耗时推进且倍率最多为 `4`；新世代取消旧帧、保留稳定不可变批次并换用最新同 ID 引用，空集合也必须完成。只有 node 与 geometry 完成事件都匹配当前 generation 和源数量，且预览仍打开、DOM 仍挂载、target 仍为 `dom`，`previewDomReady` 才能触发 `finishPreviewDomHandoff()`；关闭预览递增 generation 后必须拒绝迟到完成事件。原始尺寸 edge Canvas 回归必须分别改变 bounds、plan key 与 DPR，证明请求 DPR 进入 plan key，提交前 active/plan/bounds/DPR guard 和显示时 committed/视口门禁都有效；旧帧不清 ready，当前低 DPR 帧进入完整 SVG fallback，只有覆盖当前视口且实际 DPR 达标的新完整帧才重新接管。
- 拖入性能验收使用 `9,000` 节点、`8,999` 连线并开启鹰眼，至少连续测量 40 次且丢弃前 5 次预热。上一版两批浏览器基线（非当前终验）各执行 40 次、合计 70 个有效样本：第一批同步/DOM/下一帧 P95 为 `0.3ms`/`5.3ms`/`14.7ms`，最大值为 `0.5ms`/`5.6ms`/`27.5ms`；第二批 P95 为 `0.4ms`/`5.7ms`/`14.3ms`，最大值为 `0.4ms`/`6.2ms`/`14.4ms`。两批下一帧 P95 必须关注是否维持在 `16.7ms` 内，同时保留并分析孤立尾值；每次新增在提交时必须已经选中。“零延迟”是用户无可感知等待的验收目标，不是物理 `0ms`。修改新增历史、索引、层级、节点模板或鹰眼调度后必须重新测量，不能只用 Node 微基准代替浏览器 DOM 验收。
- 图纸 I/O 回归必须覆盖 `TC2D_MAX_DRAWING_BYTES` 默认值和小上限替身、声明长度与 chunked 超限 `413`、压缩体拒绝、单缓冲读取、metadata/ETag 正缓存、确定性 `422` 负缓存及 stat 变化重验；共享容量测试必须同时覆盖顶层与模板路径点、单条 polyline 10,000 点、重复 ID、模板几何和悬空连线。会话回归至少往返 4 个工作空间，并验证 `64KiB` Blob/`4ms` 编码与 `4KiB` 字符串切片、输入让步、小 envelope clone、旧 object 兼容、customHandle 路径恢复和克隆降级、单 key put 失败保留旧记录、编码中/put 前 freshness、store close 取消、IndexedDB 故障、并发旧保存迟到、保存途中再编辑使在途版本令牌失效、坏会话逐张过滤、脏 LRU 不淘汰、idle 回调取消与迟到拒绝、timer 降级、`8ms` 预算/输入/操作门禁、`2.5s` timeout，以及显式文件保存/切换绕过 idle gate 并等待持久化。切换回归还必须覆盖活动指针、线段起点拖动、待提交缩放、滚动和连接状态的收束，等待交互与 async-operation 双屏障、DOM `inert`/透明 shield/键盘与指针状态门禁、媒体读取和 bundle 结算、恢复完成前不可编辑及异常后的 `finally` 解锁。大 JSON 解析回归必须覆盖 Worker 正常、不可用、创建/发送失败、崩溃和消息错误后的主线程降级，以及卸载后 Worker/pending/fallback 拒绝写回且不误删合法 localStorage。
- 图纸仓储回归还必须断言列表、读取、保存、删除和 HEAD 五个请求全部使用 `timeoutMs: 0`；HEAD 对合法、结构无效和超大小普通文件返回存在，对缺失文件返回 `404`，但拒绝目录、符号链接和越界路径。删除失败后的列表过滤不能解绑会话，只有明确 `404` 或 HEAD 确认缺失才可解绑。名称状态同时覆盖后端大小写语义下的库内“同名冲突”和两个未保存会话“同名目标”，并显示规范化完整目标路径。
- 大 JSON 准备回归必须覆盖 `parseAndPrepare` 在 Worker 中完成解析、容量/引用校验、版本迁移和模型归一化；分块协议要验证 envelope、四个集合顺序、`128` 项/`1MiB` 边界、单个超大实体标记、sequence/start/count/complete 及错误拒绝。Worker 全部故障分支的主线程降级结果必须与同一 operation 一致，不能只比较裸 `JSON.parse`。`project-runtime-preparation.test.mjs` 还必须覆盖完整私有运行 bundle、多片推进、被新文档取代时取消、调度不可用降级，以及完成前不发布半套索引、完成后一次安装的契约。
- 6,016 节点浏览器性能验收必须在可见前台标签页完成，并分别通过编辑态和预览态，不能用一个结果代替另一个。编辑态要求持续数据刷新期间的拖入、连线、属性编辑、大选区变换和 Undo/Redo 都立即反馈，60Hz 帧间隔 P95 `<16.7ms`、Long Task `=0`、最终值收敛且对象立即可继续编辑；预览态要求原始尺寸、自适应、浏览器原生全屏分别达到相同帧与 Long Task 门槛，三种模式均非空、顺序正确，原始尺寸与全屏保留全部交互，自适应按“纯 Canvas / 安全有界尾段 hybrid / 完整 DOM 回退”选择并确保 edge、node、drawing 各只绘制一次。正式 `sacada测试.json` 是 `36,037,698 bytes`、6,016 节点、0 个非空 `dataKey`；挂数场景只能在内存临时副本逐节点绑定唯一键并按 `500ms` 全量刷新，禁止为了压测修改正式文件。上一版整页重载浏览器基线（非当前终验）为：编辑态 `97.3s` 的 P95 `14.1ms`；原始尺寸 `34.6s` 的 P95 `14.2ms`；自适应 `43.3s` 的 P95 `14.1ms`；原生全屏 `39.9s` 的 P95 `14.2ms`，四项 Long Task 均为 `0`。当时另确认文字输入到下一帧 `2.2ms`、拖入/属性/连线成功；原始尺寸和全屏运行值抽样均 `40/40` 变化，自适应 Canvas 非白屏且像素哈希随刷新变化，原生全屏满足 `document.fullscreenElement === previewOverlay`。这些数据只保留为上一版对照；本轮必须重新整页重载并验证请求像素比门禁、首次普通大图由 `task + 4ms` 生成兜底、图片占位帧不提交、Canvas 正常等待仅保留视口 DOM、失败后原尺寸 DOM 到 `dom-fit` 的完整渐进交接、陈旧 DOM 立即释放和节点批次最大 `2` 倍。原始尺寸与全屏还要确认完整 Canvas 仅作为大图滚动换代兜底，自适应还要验证 context 故障回退后非空。浏览器自身的原生全屏界面切换和 rAF 暂停不计入应用稳态 P95。正式文件单次 Node 读取 `70.64ms`、`JSON.parse` `177.78ms` 只属于旧主线程基线；当前打开路径必须由 `projectJson.worker.js` 解析，且不得把打开阶段耗时混入交互 P95。修改组件包、交互屏障、大选区、历史、运行格式化、预览位图或交接调度后必须整页重载并重测全部四项。
- 上述“安全有界尾段 hybrid”要求从最高层向下最多读取 `24` 个条目即可覆盖全部 live 节点，尾段 node 不超过 `16` 个且挂载成本总计不超过 `128`；Canvas 以匹配的 `renderPlanKey/excludedNodeIds/excludedDrawingIds`、freshness 和请求像素比原子提交，持久 live plane ready 后才切换显示。正常 Canvas 等待只保留视口 DOM，Canvas 不适用或失败才渐进完整 DOM；失败先显示原尺寸 DOM，完整 generation ready 后再进入 `dom-fit`。关闭、原始、全屏释放 committed plan，Canvas context 故障回退 DOM，全屏漏失事件由 resize/focus/visibilitychange 校准。
- 测试数量、源码行数和构建模块数随功能持续变化，文档不维护容易过期的固定数字。验收时记录 `npm run test:performance`、`npm run test:stability` 和 `npm run build` 的当次完整结果；`test:stability` 必须保留 `--test-concurrency=1`，用于隔离测试文件之间的 CPU 争用，不能借此放宽用例内部性能门槛。需要统计仓库规模时重新计算，不能沿用旧数字。
- 文档模型变化必须同步更新统一图纸文件读写、恢复缓存和本文件。
- 默认目录、其他位置文件和恢复缓存必须复用同一序列化、校验与应用链路；不能只更新其中一个入口。
- 保存命令必须通过当前激活会话确定数据和文件目标，不能使用仅高亮但尚未打开的目录文件。
- 左侧图纸分类删除只处理前端会话；图纸库文件删除只能从打开对话框显式触发，并必须保留确认、ETag 和目录边界保护，不得越权删除用户其他位置的文件。
- 全屏预览状态必须监听浏览器 `fullscreenchange`，不能仅依赖按钮点击时维护的布尔值。
- 可交互 DOM 节点视觉统一放入 `NodeVisual.vue`，不要在预览模板复制实现；低倍率编辑与自适应整图概览由 `MiniMapPreview.vue` 按同一持久字段 faithful 绘制，并必须保留对应的视觉一致性测试。
- 高频值统一进入 `useRuntimeData`，不要进入撤销栈。
- 新增或删除 `nodes/edges/drawings` 时使用 `recordEntityInsertion()` 或 `recordEntityRemoval()`；修改现有实体字段时使用 `recordFieldsHistory()` 或针对命令的字段记录；图层顺序和模板列表使用各自差异条目。任何普通编辑命令都不得恢复整图 JSON 快照。实体差异恢复必须同步节点、时间、运行值、空间、连线邻接和图层索引以及 Canvas 版本。
- 组件变换等连续指针交互继续复用 `operation` 和逐帧调度，不要直接绑定无边界的高频响应式写入；完成线段的节点拖拽使用 `polylinePoint` 操作和字段历史。线段创建期使用 `polylineDraft` 保存起点与候选终点，只有悬停预览进入逐帧刷新；草稿起点锚点属于局部临时交互，使用 `polylineStartPointDrag` 和指针捕获隔离终点事件，并在全部退出路径统一移除窗口监听。
- 多选状态只保存节点 ID，不进入图纸 JSON；持久化组合关系只使用节点 `groupId`。
- “我的”模板必须随图纸统一序列化；实例化时重新生成全部实体 ID，并只重建模板内部连线。
- 节点位置约束必须按旋转后的可见边界计算，所有组件四方向均允许部分越界；每轴保留量统一为 `min(24, visualSpan / 2, stageSpan / 2)`。组合、模板实例和保存恢复必须复用集合归一化，禁止逐节点夹取位置。

## 10. 流向组件

- `flowDirection` 属于“动效组件”，但路径模型和交互必须复用线段的 `polylinePoints`、等分节点、节点拖动、弧长重采样、缩放、旋转、锁定、组合、模板和历史链路。类型判断统一使用 `isPolylineNodeType()`，不得在各入口复制 `polyline || flowDirection` 分支。
- 持久字段包括 `polylineColor/polylineOpacity/polylineWidth/polylineOutlineWidth/polylineLineCap/polylineLineJoin/polylinePoints`、`borderDashLength/borderDashGap`、`flowArrowVisible`、`animation/animationDuration/animationDirection/animationPaused`。流向始终规范为虚线；正向箭头位于终点，反向箭头位于起点。通信绑定可覆盖 `polylineColor`、`animationPlaying` 和 `animationDuration`，运行值不得回写图纸 JSON。
- 编辑 DOM 由 `NodeVisual.vue` 使用 SVG `stroke-dashoffset` 动画，普通预览、自适应预览、全屏预览、鹰眼和大图 LOD 由 `MiniMapPreview.vue` 复用 `flowDirectionDashOffset()`。`previewRenderPolicy.js` 必须把 `flowDirection: flow` 判定为 `ANIMATED_CANVAS`，否则正式预览会退回逐组件 DOM 动画。Canvas 动画只使用现有共享视觉时钟和自适应帧率，不得为每个流向创建 `requestAnimationFrame` 或定时器。
- 同一视口内活跃流向达到 `EDITOR_LOD_ANIMATED_FLOW_DIRECTION_THRESHOLD`（当前为 96）时，编辑器必须切换到现有 Canvas LOD；暂停、关闭或完全透明的流向不计入阈值。预览的小图纸策略使用同一阈值，防止 512 节点门槛以内仍挂载数百个 SVG 动画。少量组件继续保留 SVG 路径和节点编辑层，选中节点在 LOD 中仍由有界 DOM overlay 保持交互。
- 回归至少覆盖目录归属、默认值与旧图恢复、虚线长度和间隔、正反方向箭头、周期、启用和暂停、节点编辑、通信绑定、项目容量、DOM/Canvas 相位一致性、预览策略以及活跃流向 LOD 阈值。浏览器需分别验证画布、普通预览、自适应预览和全屏预览，并使用两个时间点的 Canvas 像素差确认动画真实更新；大量实例还要检查 `visualAnimationFrameMs` 低于共享时钟的 `visualAnimationIntervalMs`。

## 11. 内置动效视觉契约

- 流动管道、旋转风机和告警的 DOM 与 Canvas 必须使用同一套几何比例、颜色字段和动画相位。编辑画布、普通预览、自适应预览、全屏预览、鹰眼及大图 LOD 不得分别维护不同造型；修改视觉时应同步更新 `NodeVisual.vue`、`MiniMapPreview.vue` 和像素回归。
- 流动管道使用浅色圆角轨道与绿色流动块，新建默认主色为 `#16b89a`。轨道属于组件内容而非可配置外边框，不得再添加固定描边；用户设置的通用外边框仍由节点边框字段独立绘制。
- 旋转风机使用浅色圆形底盘、四个绿色圆头长方形叶片和深色中心轴点。浅色底盘属于组件背景，必须在 DOM 和 Canvas 中读取 `backgroundOpacity`，设为完全透明时不得残留灰色圆底；叶片和中心轴点的可见性不受背景透明度影响。中心点是叶片转轴的必要视觉结构，低倍率 Canvas 下应保持至少 `1.5` 个屏幕像素半径；旋转仍复用共享视觉时钟，不得增加逐组件定时器。
- 对外名称统一为“告警”，内部类型继续保留 `heartbeat` 以兼容旧图纸、旧模板和已有绑定。视觉使用简洁三角告警符号，动画继续读取现有 `pulse`、周期、方向和暂停字段，不能把类型重命名造成历史数据失效。

## 12. 画布内联文字编辑

- 画布内联文字编辑器必须覆盖节点的实际可见区域，并复用节点 `visualScaleX/visualScaleY`。编辑器先按缩放倒数展开逻辑宽高，再应用与 `NodeVisual` 相同的缩放矩阵，不能使用固定像素高度、固定内边距或不透明背景；否则组合或组件缩小时会出现大于真实内容的白色矩形。
- 编辑器需同步节点的字号、字重、斜体、颜色、透明度、横竖排和对齐方式。编辑期间只隐藏底层 `.node-text-content`，节点自身填充、边框和其他视觉仍保持显示；退出编辑后恢复原文字层。
- 回归测试至少覆盖小尺寸节点的缩放投影、透明背景、零边框、零内边距、无固定高度以及底层文字隐藏。浏览器验证应比较编辑器与节点外框的实际 `getBoundingClientRect()`，确保二者重合。
