# 大画布与实时数据性能说明

## 已实现的优化

### 空间索引与视口虚拟化

编辑器使用 `src/utils/spatialIndex.js` 的均匀网格空间索引保存节点引用和旋转后的视觉边界。主画布滚动、缩放和框选时，只查询与目标区域相交的网格桶，不再对全部节点执行 `filter`。普通图纸保留额外 `240px` 屏幕缓冲；节点达到 1,500 个后收紧为 `96px`，减少低倍率下不必要的 DOM。打开、切换或载入另一份完整图纸时重建索引；普通撤销重做、移动、缩放、旋转和位置输入只增量更新受影响节点。空间索引更新会先比较缓存边界；几何完全相同时只刷新实体引用并返回未变化，不拆装网格桶，也不发布新的视口修订。这样节点按下阶段的幂等归一化不会抢先使高清 LOD surface 失效，真实位移仍由随后一帧的局部几何 patch 提交。正在操作的节点即使离开查询范围也会强制保留，避免拖到视口边缘时突然卸载。

查询范围包含的理论网格数较小时直接按坐标读取；范围很大时只遍历 `buckets` 中实际占用的网格，并先通过缓存的整体内容边界拒绝完全无交集的查询。这样两个稠密组件簇之间即使存在很大的空白区域，也不会因为低倍率视口跨越大量空格而退化为 10,000 节点全量扫描。超大背景对象仍单独保存，避免单个对象占据成百上千个桶。

完成后的铅笔线稿和多点线段都是普通节点，自动进入相同的空间索引、`visibleNodes` 和 `v-memo` 链路。`visibleEdges` 通过可见节点 ID 与 `edgeAdjacency` 查询关联连线；临时铅笔路径仍由轻量的 `drawingRenderEntries` 单独处理。原始尺寸及全屏预览使用独立 `previewViewport` 做相同查询，并以稳定批次 key 保留滚动前后仍可见的 `NodeVisual`、媒体实例和运行值订阅；带缓冲视口连线超过 `1,024` 条时只把连线交给独立 edge-only Canvas 窗口，节点和线稿 DOM 仍完整。自适应预览不再挂载整张图纸的 Vue DOM，而是使用下述分片 Canvas。

因此，大量节点分散在大画布时，视口查询成本和 DOM 数量主要取决于当前网格候选及屏幕附近的节点，而不是每帧扫描图纸总节点数。单屏本身同时显示大量复杂组件时，DOM 数量仍会随可见密度增加。

### 低倍率编辑与自适应预览

节点达到 `1,200` 个且编辑倍率不高于 `30%`，或普通倍率当前视口超过 `512` 个节点时，主画布进入完整 LOD：整图静态内容由 `MiniMapPreview` Canvas 承载，Vue DOM 前景只保留选中、活动、连线起点和正在编辑的少量节点，最多 128 个；关联连线前景通过 `edgeAdjacency` 按活动节点读取并限制为 128 条，最新创建的连线优先显示。若节点密度尚未触发完整 LOD，但当前视口连线超过 `1,024` 条，则进入 edge-only LOD：fallback/detail Canvas 只绘制连线，节点、表单、视频、动画、铅笔和线段继续使用完整 DOM，SVG 只保留最多 128 条活动连线。两种 LOD 判断都先使用数量与空间索引的有界查询，不扫描完整实体集合；普通倍率未触发上述门槛时仍使用空间索引虚拟化 DOM。

低倍率编辑的视觉层级固定为专用整图网格背景 `z-index: 0`、透明 fallback Canvas `z-index: 1`、高清视口窗口 `z-index: 2`、透明交互 stage `z-index: 3`；高清窗口内部仍保持不透明画布背景/网格在 `0`、透明 detail Canvas 在 `1`。普通 `.stage` 的线条/点阵网格选择器必须使用 `:not(.editor-lod-stage)` 排除 LOD stage；LOD stage 同时显式清除 `background-color`、`background-image` 和 `box-shadow` 作为防御。低倍率网格按 `2` 的幂次抽稀，保证屏幕间距不低于 `8px`，线条网格的屏幕线宽和点阵直径都不低于 `1px`，但吸附仍使用原始逻辑网格尺寸。这样网格只在 Canvas 下方绘制一次，不会因 CSS 优先级变化在组件上方重复覆盖，也不会在 `20%` 时压缩成高密度灰层。调整网格、stage 或 LOD 样式后，必须在最低 `20%` 倍率分别验证线条、点阵、关闭和重新开启网格，并检查 detail 窗口边界没有双网格或相位错位。

fallback Canvas 只负责整图连续反馈，位图限制为 `1,048,576` 像素；当前视口另由原子提交的 detail Canvas 提高清晰度。detail 通过独立 `pixelRatio` 以 `3x` 为目标 backing，并受 `12,582,912` 总像素上限约束；预算不足时先由 `editorLodDetailOverscanPixels()` 缩减不可见缓冲，再只对超出上限的可见区域有界降低实际倍率。`minimumScreenStrokeSize = 1` 同时约束节点边框、连线、铅笔和线段等 detail 描边，使它们在低倍率下仍至少占 `1px` 屏幕宽度。`ready` 与 `fresh` 分开表示：文档或倍率变化只把已提交高清帧标记为旧，不立即隐藏它；父窗口、内部网格和 Canvas 持续使用同一 committed frame 的边界、尺寸和投影，直到新世代完整渲染后再原子替换。旧帧只是 stale 过渡，连续放大时其有效密度会按投影比例暂时下降，不能把它当作已达到当前 `3x` 目标。达到上限时三张 RGBA 工作面约占 `144MiB`，不得仅为提高倍率继续扩大整块 Canvas；若还要覆盖更大的高密度视口，应改用可视瓦片方案。

几何交互优先由 detail Canvas 自己执行受像素、候选数和区域数约束的局部 patch；父层不再以活动实体数量重复截断这条路径。若 detail patch 仍因预算或上下文状态退化，不在高清层绘制画布底色，也不隐藏整个 detail window。`editorLodDetailFallbackRegions()` 只收集与 committed detail frame 相交、且已由 fallback 同帧真实提交的几何或删除区域；起点与当前位置保持为两个局部区域，只有重叠或接触时才合并，不累计整条拖动轨迹。反向裁剪使用基础 `polygon(...)` 的默认 nonzero 环绕规则，外框与局部孔洞采用相反方向，并同时设置标准及 WebKit 属性；它只在这些区域挖孔，露出下层正确的 fallback，孔洞之外的背景、网格、文字和组件继续使用 `3x` detail。基础裁剪能力检测失败时仍保留 committed detail 和活动 DOM 等待权威帧，不能用整窗低清替代局部兼容。fallback 失败、未提交、权威 full 仍 pending 或脏区在窗口外时不挖孔，保留旧 detail 和活动 DOM 反馈。fallback 与 detail 的 `committed` 回执独立记录；只有本层至少一个非空位图 patch 真正写入后才可置真，空计划不能借用另一层的成功回执切层。父层每次调用子 Canvas 的 request/finish 后都重新读取当前 live session，因为同步 `render-error` 可在同一调用栈内粘滞标记失败，旧会话快照不得覆盖该状态。只有实际可见的可靠 Canvas 才能接管活动实体；被 detail 覆盖的 fallback 不得使活动 DOM 隐藏。Canvas 接管后 DOM 只保留选框、命中壳和手柄，避免透明文字和线条双绘加粗。删除 cover 单独记录 fallback 提交资格：连续删除任一 fallback patch 失败即撤销，只有无后续 pending 的完整 fallback 帧成功才恢复；detail 完整帧提交后清除局部裁剪并原子恢复。进入预览前会取消未完成的编辑几何会话、两张 Canvas 任务和完成屏障，关闭预览后重新请求当前文档帧。整体打开或切换图纸时同样先取消旧文档的两层几何会话和 pending render；替换实体集合、重建索引、安装新尺寸并重置视口后，显式重建 detail bounds，再 bootstrap 新文档，不能沿用旧会话或依赖响应值恰好变化来触发 watcher。

节点移动只有在指针位移超过 `4px` 后才进入拖动预览；活动节点使用 `0.62` 的纯渲染透明度，让用户在放置时继续看清下方图形。普通 DOM、LOD fallback Canvas 和 detail Canvas 都复用同一透明度乘法：用户原有 `node.opacity` 会与 `0.62` 相乘，而不是被覆盖。该值不写入节点、图纸 JSON 或历史；`pointerup`、`pointercancel`、失去捕获、窗口失焦、大选区异步提交、失败、取消和工作空间切换都会先关闭拖动透明状态，保证释放后立即恢复原外观。

移动、缩放和旋转期间，LOD 不等待下一次整图 Canvas 才反映几何变化。`editorLodGeometry.js` 同时收集操作前后的节点边界，把长连线和旧线稿切成有界线段，然后只对合并后脏区查询分段空间索引并按真实图层局部合成；fallback 与已提交 detail 两张 Canvas 都参加同一几何会话和局部 patch。实体删除及撤销/重做产生的删除通过 `patchRemovedEditorLodEntities()` 把旧节点、连线和线稿边界同时派发给两张 Canvas，直接清除对应残影。计算删除连线的脏区时，本次 payload 中的已删除节点作为小型端点覆盖表，未删除端点再回退当前 `nodeIndex`，不能复制或扫描完整索引。新操作会取消旧的完整帧和运行值任务；几何开始前先使 runtime backing mutation 生效并失效旧 back surface。若操作取消后仍有运行值 dirty/follow-up，合法增量基线会立即继续 runtime replay，否则请求权威完整帧恢复；几何完整帧提交后，交互期间积累的运行值也继续重放收敛。只有会话、几何修订号和权威 patch 回执匹配才解除临时前景遮蔽，避免旧帧回写和新旧位置双影。

低倍率可读文字先按节点请求的原字号生成横排换行或竖排列基线，再由 `layoutConstrainedCanvasFontSize()` 在剩余宽高内限制最终可读字号；绘制阶段继续复用原行/列，不用放大后的字体重新断行。该路径避免组合缩放文字因最低可读字号重新换行、分列或重叠，同时保留正常倍率、连续空格、显式换行和横竖排的既有语义。

可见、可绘制且物化后的正文 `String.length > 512` 时，full、dense 和 sparse 三条 Canvas 路径都使用 `incrementalTextLayout.js`。布局每 `32` 次操作检查一次 deadline，单个 slice 即使仍有时间也最多执行 `8,192` 次操作；当前文字全部布局并绘制完成后才推进实体或候选游标，因此私有工作面和可见 Canvas 都不会出现半段文字。supersede、invalidate、卸载和异常路径清除 `textLayoutWork`；布局异常先恢复 context、隔离坏 surface，再进入统一 DOM/Canvas fallback。同步 geometry 局部 patch 遇到长文本时直接返回失败并请求权威完整帧，不能在指针热路径同步跑完全部正文。

删除脏区不会把相距很远的实体立即合并为一个巨大包围盒。`editorLodRemovalCoverRegions()` 最多保留 `32` 个分离区域；接触区域仍直接合并，超过上限时用缓存的成对增量覆盖面积选择代价最小的压缩，并让新区域与既有区域共同参加比较。该压缩始终保持完整覆盖，不会留下删除残影。6,000 个远距离区域的旧实现约耗时 `112～137ms`，当前实现为 `11.89～15.44ms`，网格分布场景约 `6.95～7.74ms`；性能用例要求同规模处理低于 `50ms`，防止后续退化。

自适应预览使用完整画布 Canvas，并把首帧拆为有预算的分片任务；当前激活预览使用 `render-mode="task"`，单片最多 `4ms`。task 模式优先用 `MessageChannel` 快速推进，但每连续两片主动让出一次可取消的 `requestAnimationFrame`，避免一个大任务仅在任务队列中连续排队而挤压浏览器绘制；不支持 `requestAnimationFrame` 时继续使用 task，不支持 `MessageChannel` 时回退 `setTimeout(0)`。非活动 bootstrap、低清编辑 fallback 和鹰眼保持 `2ms`，其中 bootstrap/辅助缩略图继续使用空闲调度，编辑 detail 使用 `task` 模式且单片最多 `6ms`。纯静态图纸在 Canvas ready 后卸载预览 DOM。存在视频、表单、表格、时间控件、`custom*` 动效、非 `none` CSS 动画或其他持续视觉的 live 节点时，系统从最高图层开始反向读取最多 `24` 个 `layerEntries`，找到能够覆盖全部 live 节点的最短有界尾段。这个尾段整体交给独立且持久的 `preview-live-plane`，其中允许包含为保持层级顺序而一并提升的静态 node 和 drawing；Canvas 通过 `excludedNodeIds` 与 `excludedDrawingIds` 排除尾段实体，只绘制其下方静态前缀，同时继续保留节点索引以计算连线端点。连线始终由 Canvas 绘制一次，尾段 drawing 始终由 DOM/SVG 绘制一次，两层不得重复挂载同一实体。

完整帧满足 `incrementalRuntime && max(edgeCount, edgeSpatialIndex.state.entries) >= 2,048` 时，静态边的像素栅格化由专用 OffscreenCanvas Worker 承担；因此全图边数组和原始尺寸/全屏 edge-only 的空间查询 cursor 都使用同一 Worker 热路径，不需要先同步物化完整查询结果。主线程仍在原 `2–6ms` scheduler 预算内解析端点和维护几何索引：cursor 的一次 `runSlice` 最多检查 `256` 个索引条目，只要当前时间片尚未让步就继续查询，尽量把最多 `512` 条命令组成一批；坐标、线宽和 marker 尺寸写入 `Float64Array`，dash/marker 枚举写入 `Uint8Array`，颜色索引写入 `Uint16Array`，三个 buffer 以 transferable 发送，不克隆 Vue 边对象。Worker 与主线程共用 `drawEdgeRasterCommand()`，严格保持输入顺序、每边独立 `beginPath/stroke`、dash reset 以及起止 marker；函数完成一条边后恢复调用方原 `lineCap`，防止共享 context 的后续绘制被圆头状态污染。完成后通过 `transferToImageBitmap()` 返回静态边层，主线程一次合成后继续节点和 drawing。

cursor 每命中一条边，必须先把引用追加到 `task.edges`，再生成命令并保留尚未消费的 `edgeSourceCursor`；这两个状态共同构成无损回退点。`edgeRasterWorkerClient` 对 start、每个 batch 和 finish 分别设置 `8s` 响应门限，超时会终止并永久停用本次 client Worker。supersede、invalidate 或卸载会发送 cancel，迟到 bitmap 立即 `close()`；Worker 创建、发送、运行、超时、协议、位图或最终合成任一失败时，主线程重置边几何索引和绘制游标，先从第 0 条重放已收集的 `task.edges`，再继续仍保存的 cursor，不能漏边或重复提交。edge-only 帧的 `renderNodes/renderDrawings` 都为 false，提交后不会保留只供节点运行值使用的 committed static/composite 双离屏面；OffscreenCanvas 只是性能能力，不是正确性依赖。

预览 Canvas 的位图预算由 `previewBitmapPixelBudget()` 按 surface 是否活动分档。活动自适应预览以及原始尺寸/全屏的 edge-only 连线窗口以 `max(2, min(3, devicePixelRatio))` 为目标倍率，按最终显示尺寸计算所需 backing，并限制在 `8,388,608` 像素以内；因此小窗口不会始终申请最大位图，正常视口至少以 `2x` 为目标，只有超大显示面积触及总上限时才有界降低实际倍率。尚未成为显示目标的非活动 fit surface 只作为 DOM 交接前的 bootstrap，限制为 `4,194,304` 像素。低倍率编辑继续使用上文独立的 fallback/detail 两级预算。任何位图预算都不能误用为裁剪 DOM 实体的数量限制。

安全混合自适应不要求所有 live 节点在图层中彼此紧邻，而要求在最多 `24` 个条目的反向窗口内证明一个包含全部 live 节点的完整图层尾段；Canvas 静态前缀与 DOM 尾段因此仍保持严格的全局先后关系。尾段还必须通过单批 DOM 预算门禁：其中 node 最多 `16` 个，总挂载成本最多 `128`，drawing 每个计 `4`；视频计 `32`，GIF/APNG/WebP 动态图片计 `24`，`custom*` 或非 `none` 动画计 `12`，普通节点计 `8`，select 计 `10 + min(200, optionCount)`，table 计 `16 + columns × (rows + headerCost)`。在 `24` 条内无法覆盖全部 live 节点、node/cost 超限或计划无法证明时，系统自动回退完整 DOM，不允许以混合渲染换取错误层级或集中挂载长帧。安全混合时，持久 live plane 独立于完整 DOM stage，在 fit、原始尺寸和全屏交接期间保留尾段实例，避免视频、表单和动态状态因切换整批卸载。

原始尺寸、全屏预览和自适应降级路径继续使用视口虚拟化完整 DOM 承载节点、线稿和所有原生交互。DOM 世代的节点与几何均 ready 后卸载并释放用于装载交接的 fit Canvas；若当前带 `96px` 节点查询缓冲的视口超过 `1,024` 条连线，原始尺寸和全屏会另行保留 `preview-edge-canvas`，只绘制连线。该窗口把视口外扩 `192px`，接近窗口边缘 `64px` 时才更新，使用 `4ms` task 分片和活动预览位图预算。`previewEdgeCanvasPlanKey` 明确包含当前请求 DPR；完整帧写入可见 backing 前，`frameCommitGuard` 校验 edge-only 仍活动、事件 plan 与 bounds 仍等于当前请求，并校验 X/Y 实际像素比中的较小值达到请求倍率。显示阶段再要求 `previewEdgeCanvasReady`、committed bounds 覆盖当前视口、committed plan key 等于当前计划且 committed DPR 仍清晰。迟到的旧范围/旧计划帧只会被忽略，不得清除当前 ready；当前匹配请求若实际 DPR 不足则进入 fatal 完整 SVG fallback。新窗口或更高 DPR 的清晰帧提交前，完整 SVG 连线继续渐进显示，旧范围、旧计划或低密度 Canvas 都不能接管。节点、表单、媒体、动画、铅笔和线段始终留在 DOM，连线不会同时由 Canvas 与 SVG 重复绘制。`previewVisibleNodes/previewVisibleEdges/previewVisibleDrawings` 返回完整视口查询结果，不按节点 `512`、连线 `1,024` 或旧线稿 `512` 截断；`PREVIEW_DOM_*` 常量用于选择装载/edge-only 策略，不是实体数量上限。

`ProgressivePreviewNodes` 在每个新世代开始时立即用 `partitionRetainedPreviewNodes()` 剔除目标集合外的陈旧 DOM，保留新旧集合交集，并把同 ID 节点替换为当前源引用；因此 10,000 节点目标缩到小视口时不会等剩余挂载完成才释放旧实例。缺失节点通过 `push + triggerRef` 在同一个浅数组上原地增长，不在每批复制或过滤全部已挂载项；`nextTick` 后的实际 DOM 提交耗时低于 `3ms` 时把节点批量倍率加倍，高于 `8ms` 时减半，倍率始终限制在 `1–16`，同时继续服从节点数与类型成本预算。`PreviewNodeBatch` 的 `v-memo` 把 `node` 引用放入依赖；即使 ID 不变，只要节点对象被新世代替换也会刷新。`ProgressivePreviewGeometry` 对当前世代的 edges 和 drawings 保留稳定不可变的同 ID 批次并换成最新引用，缺失项首帧最多分别挂载 `64` 条连线和 `8` 个线稿，后续根据 `nextTick` 后的提交耗时逐帧增长，几何倍率最多为 `4`，避免在 Canvas 降级时一次计算全部端点、路径并提交整棵 SVG。`previewDomReady` 由节点 ready 与几何 ready 共同计算；两类完成事件都必须匹配当前世代和各自当前源数量。`finishPreviewDomHandoff()` 还要求预览仍打开、DOM stage 仍挂载且当前交接目标仍为 `dom`；`closePreview()` 在拆卸交接前推进 `previewDomGeneration`，迟到完成事件不能重新切换显示模式。正常等待可用且清晰的 fit Canvas 时只请求当前带缓冲视口 DOM，只有 Canvas 计划不适用或已失败才请求完整图纸 DOM；Canvas 失败后先维持原尺寸 DOM，节点、连线和线稿全部渐进挂载且共同 ready 后才切换为 `dom-fit`，不会在等待期间集中挂载或暴露半张图。

编辑态也有独立的临时渐进接管。加载/恢复图纸、关闭预览或从持久完整 LOD 回到普通倍率时，如果目标首屏超过 `128` 个节点，先让 Canvas 保持连续画面，再用 `previewMountBatchEnd()` 按每帧最多 `8` 个节点、`64` 挂载成本递增创建 `NodeVisual`；节点全部 ready 后才退出临时 LOD。新世代会保留仍在目标集合中的已挂载节点并取消旧帧，打开预览则立即取消编辑渐进任务，避免隐藏编辑器继续争用主线程。这一阶段只是挂载交接，完成后节点、线稿和交互仍回到普通 DOM，不把 Canvas 当作功能裁剪。

Canvas 是否可交接不再由任意一次渲染完成事件直接决定。Canvas 完整帧的 `render-complete` 必须携带该任务实际使用的 `renderPlanKey`、`excludedNodeIds` 和 `excludedDrawingIds`；`App.vue` 只有在计划 key 与两组有序排除 ID 都和当前计算计划完全匹配，并且 `previewFrameFreshness` 门禁通过后，才把该计划的 overlay 节点与 drawing 快照提交为 committed plan 并切换显示。计划在渲染途中改变时，旧事件只能触发新计划重绘，不能短暂提交旧排除集合造成节点或线稿重复、缺失。fit surface 不再接收其他 surface 的低密度启动帧；`previewFitBootstrapCanRenderSharp` 先验证当前像素预算能否达到请求像素比，完整帧到达后再以 X/Y 中较小的实际像素比调用 `previewBitmapIsSharp()` 复核。只有匹配当前文档 token、目标尺寸、请求像素比和渲染计划的完整提交才能建立 available/fresh；预算注定不足或实际密度不达标时直接使用清晰 DOM/SVG，不允许把低密度 Canvas 拉伸后交接。`previewFrameFreshness.js` 分别记录当前文档世代、已请求世代和已提交世代；表单等文档修改会立即推进世代并使旧帧失效，延迟合并后的完整渲染请求只归属当前世代。当前文档的完整帧原子提交且没有待处理完整帧后即可恢复 fresh；运行值局部提交只能更新已经提交的同世代文档帧，不能越过尚未提交的新文档完整帧。新运行值可能在一次局部帧提交时已经继续排队，这种连续 `pendingRuntime` 不会让合法 Canvas 永久无法交接，后续值仍由 latest-wins 分片继续收敛。若本批运行数据没有可绘制视觉，`MiniMapPreview` 仍发送 settled no-op 完成事件。Canvas context 丢失、context 不可用、像素比不足或提交 token 已失效时，组件发送/进入 `render-error`，页面先显示原尺寸完整 DOM；完整渐进挂载 ready 后才切换 `dom-fit`，不能把空白、半提交或模糊 Canvas 暴露给用户。context 恢复后只能按新世代重新渲染。关闭预览、切换原始尺寸或进入全屏都必须释放 committed plan；关闭或重新打开预览同样使旧世代失效。

Canvas surface 复用还要经过两次 2D context 检查：首次创建任务时拿不到 context 的 surface 立即销毁，任务结束准备回池时再次获取失败、外层 `restore()` 失败或已标记 context 故障的 surface 同样不得复用。节点、图片、线稿、线段、设备和边 marker 的每一层 `save()` 都以 `try/finally` 配对 `restore()`；`createStaticRenderSurface()`、`createRenderTask()`、运行 seed 和几何合成在取得 surface 后发生异常时，先恢复 Canvas 状态，再以不可复用方式释放坏 surface 并进入既有 fallback/权威完整帧恢复，不能污染下一实体或下一任务。图片只在成功加载后请求更新，同一帧内多个成功事件由 `createCoalescedRenderTrigger()` 合并成一次完整重绘；加载失败不触发整图重绘。fit Canvas 通过 `active` 明确区分当前显示目标：隐藏时取消 full/runtime 调度、时间与图片刷新并只记录 dirty，重新激活后只按最新文档和运行值追赶一次，避免不可见 surface 与画图、接数争抢主线程。

全屏尺寸变化由 `previewViewportScheduler.js` 合并 `fullscreenchange`、`ResizeObserver` 和滚动事件。进入或退出原生全屏后的第一帧若尚未收到有效 `contentRect`，只额外等待一帧；第二帧仍没有尺寸才读取 DOM 作为兜底。`fullscreenchange` 可能被浏览器或嵌入环境漏发，因此页面还在 `resize`、窗口 `focus` 和文档 `visibilitychange` 时用 `document.fullscreenElement` 校准 `previewFullscreen`；校准必须幂等，不能制造重复交接。普通滚动和窗口尺寸更新不增加首帧等待，旧世代回调也不能覆盖新的全屏视口。

启用 `incrementalRuntime` 后，Canvas 首次完整渲染会同时提交不含运行值的静态底图、当前合成面和空间索引契约。后续设备值只把同一 `dataKey` 对应节点加入 latest-wins 脏集合，根据旋转边界合并脏矩形，从静态底图恢复这些区域，并按图层只重画相交的运行值视觉。从变化节点生成脏区、查询候选和重画都在同一 `2ms` `runSlice` 预算内推进；任务创建不会同步扫描整批节点。

运行键关联大量组件时，`runtimeCanvasDirtyQueue.js` 通过活动键游标和节点去重集合增量取数；`App.vue` 每个动画帧最多取 `1 × 512` 个节点，并把同一 `{ nodes, dense, pending }` 描述广播给当前活动的鹰眼、编辑 fallback/detail 和自适应预览 Canvas。只有“本批已满且仍有后续节点”才开启 `dense` 流；中间批可在最多约 `48ms` 的窗口内合并，尾批以 `pending: false` 关闭流并强制最终稠密收敛。节点数恰好是 512 的整数倍或重复 ID 被去重后，尾批可以为空；这个空终批仍必须关闭 dense stream 并释放 freshness，不能造成永久 pending。旧的数组式 `requestRuntimeRender(nodes)` 调用继续兼容。

`runtimeCanvasStrategy.js` 根据变化节点数、脏区数量和位图覆盖率在 sparse/dense 间选择：当前门槛为节点不少于 `1,024`、区域多于 `64`，或覆盖率达到 `35%`。`resolveChangedRuntimeNodes()` 先通过 `runtimeNodeBitmapRect(node, committedStaticFrame)` 排除当前局部 Canvas 帧之外的节点；若没有可见变化，直接发送 settled no-op，不创建工作面、不提交零脏区，也不误报 `runtime-commit-failed`。sparse 使用 front/back 两张 committed composite 轮换：一次成功提交后，旧 front 成为 `runtimeBackSurface` 并记录本批 dirty rects；下一次尺寸匹配时取回 back，只从当前 front 同步上一批 dirty rects，再绘制新脏区。只有没有可复用 back 时才对完整工作面执行分条 seed。dense 始终从已提交静态底图开始，按真实图层顺序完整重放运行视觉。两种模式都先在私有工作面完成，分条 seed 每次最多处理 `262,144` 像素并执行 `clearRect + source-over drawImage`，每片服从固定 `2ms` 预算；dense 重放也按实体切片。进入 dense 时以 O(1) Map 引用交换脱离当前待处理集合，完成后再交换 composite surface 引用，不把结果逐像素复制回旧工作面。几何 backing 开始修改前必须释放或失效 runtime back，避免把旧几何基线带入后续 sparse 帧。

完整、运行值和几何局部帧统一通过 `canvasSurfaceCommit.js` 写入可见 Canvas：尺寸不变的全量帧执行一次 `globalCompositeOperation = 'copy'` 加一次 `drawImage`；sparse/geometry 先把全部脏矩形加入同一个 union clip，再只执行一次 copy draw。全量帧需要改变可见 Canvas backing 尺寸时，提交器必须在 resize 前保留可恢复的旧帧；新 context 获取、context token 校验或新帧 copy 任一步失败，都恢复旧尺寸与旧像素，且回滚资源在 `finally` 中释放。可见面不再先 `clearRect`、再逐块绘制，因此提交异常不会主动擦出白块或暴露逐块半帧；几何内部工作面异常会把几何索引标记为失效，并进入既有 fallback/完整帧恢复。context token、任务世代和排除计划仍需在提交前全部通过门禁。

`scripts/runtime-canvas-dirty-queue.test.mjs` 覆盖单帧批次、重复 ID、整数批边界和空终批；`scripts/minimap-rendering.test.mjs` 覆盖视口外过滤与 settled no-op、sparse front/back 轮换、dense 私有工作面、条带 seed、dense 重放、union clip 单次 copy、尺寸变化失败回滚及提交异常不预清空；`scripts/preview-handoff.test.mjs` 覆盖中间批合并和最终 freshness；`scripts/chunked-render-scheduler.test.mjs` 覆盖动态预算与异常回调；`scripts/performance-acceptance.test.mjs` 覆盖 6,016 节点扇出与运行数据排空预算。文字与异常专项还包括 `scripts/text-layout.test.mjs`、`scripts/incremental-text-layout.test.mjs` 的同步/增量语义等价和 `32/8,192` 护栏，`scripts/incremental-text-render-wiring.test.mjs` 的 full/dense/sparse、游标、取消、异常与 geometry 降级接线，以及 `scripts/minimap-canvas-state-exceptions.test.mjs` 的 18 项 Canvas 状态、运行 seed、创建期和几何 context 故障注入。

完整首帧尚未结束时到达的数据先缓存，首帧提交后再局部补画，不把持续数据流升级为连续全图重绘。仪表和进度条的轨道属于静态层，填充与文字属于运行层；少量时间组件复用完整渲染时收集的时间实体做局部文字刷新。时间实体达到 dense 门槛时，`requestTimeRender()` 直接发送 `{ nodes: [], dense: true, pending: false }`，避免每秒同步遍历数千时间节点，再由上述 dense 私有工作面按实体分片重放。

### 鹰眼单画布渲染

鹰眼使用一个 `240 × 150px` 可见 Canvas 绘制全部连线、节点缩略视觉和临时铅笔路径，不再按节点挂载第二套 HTML 或完整 `NodeVisual` 组件树。主页面在文档真实变化后通过 `markMiniMapDirty()` 合并通知，并把同一份 `nodeIndex` 和有序 `layerEntries` 交给鹰眼复用；组件内部只观察数组引用、长度、尺寸和显式请求等浅层契约，不深遍历整张图纸的表格单元格和路径点，也不重复建立主鹰眼节点索引或排序图层。

`createChunkedRenderScheduler()` 为每次刷新创建私有离屏 Canvas，并依次切分节点索引、连线、实体准备、归并排序和实体绘制阶段。`budgetMs` 可以是常量或 getter，调度器在每个 slice 开始时重新读取；`MiniMapPreview` 的 full scheduler 使用 `() => normalizedRenderSliceBudgetMs(props.renderBudgetMs)`，因此 active/idle/detail 的预算变化不需要重建调度器，runtime scheduler 仍固定为 `2ms`。支持时由 `requestIdleCallback(..., { timeout: 120 })` 在浏览器空闲期执行，不支持时回退到 `setTimeout(0)`；因此主画布的新组件 DOM 和紧接着的编辑输入优先于辅助缩略图。带 `IdleDeadline` 的回调只有在剩余时间达到完整预算时才创建并启动任务，时间不足会继续延期；触发 `timeout` 时只授予 `min(1ms, budget)`，但允许至少推进一个循环单元，防止持续繁忙时永久饥饿。full/runtime 两个 scheduler 都通过 `onError` 在释放失败任务后统一调用 `reportCanvasRenderError(...)`，调度回调不得抛出未处理异常。主鹰眼已提供 `nodeIndex` 和 `layerEntries`，会直接跳过重新建表和排序；“我的”缩略图缺少共享索引时，也在相同的分片预算内完成这些阶段。

调度器使用递增世代隔离请求。新请求先取消排队句柄并释放旧任务的离屏位图；旧回调即使随后到达，也会因任务引用或世代不匹配而退出，不能覆盖新画面。只有当前世代全部完成后，才以一次 `drawImage` 原子替换可见 Canvas；提交抛错时同样精确释放当前私有任务，卸载时 `dispose()` 取消任务并阻止后续请求。鹰眼承担整图概览职责，总工作量仍会随节点、连线和复杂路径数量增长，但不会再形成与总量等长的一次同步主线程长任务。

### 增量文档索引与双游标层级

`nodeIndex` 使用持久的 `shallowRef(Map<id, node>)`，保存 Vue 响应式数组中的实际代理。普通新增遵守“先 `push`、后登记”顺序，只从等长尾段取得本批代理并写入 Map；删除和实体撤销重做由 `applyNodeSpatialChanges()` 同步增删。只有打开、切换或整体恢复图纸时，才需要为完整文档重新构建。当前主选节点直接按 ID 获取，多选节点只按已选 ID 查表并按 `layer` 恢复顺序，不再因每次数组增删重建 10,000 项 Map。连线端点、拖拽节点和旋转节点也复用该索引。`edgeAdjacency` 按节点保存相邻连线，滚动时只读取可见节点关联的边，不扫描整张图的全部连线。

`timeNodeIndex` 只保存时间节点，普通节点新增不会使自动计时和服务器时间判断扫描整个 `nodes`；新增、删除及实体历史恢复都只登记本批时间节点。`edgeAdjacency` 同时维护边 ID 和节点到边的 Map，新增连线、删除及撤销重做只更新受影响端点。打开、切换或整体恢复图纸时，`projectRuntimePreparer` 在私有任务中按默认 `4ms` 时间片重新建立节点/线稿/时间 Map、运行键与绑定反向索引、节点/线稿/连线空间索引、连线邻接、双游标层级和有序图层条目；全部完成后，`installPreparedEntityCollections()` 才一次替换实体集合和整套活动索引。过期、被新图纸取代或组件卸载的任务会取消，不能逐片写入当前文档。`rebuildDocumentIndexes()` 只保留给空白或其他同步整体替换入口，不再代表正式大图打开链路。

高出度节点采用同一条有界交互策略：若本批活动节点的相邻边计数超过 `128`，指针帧不再调用 `edgeAdjacency.get()` 枚举全部边，也不逐条重建连线空间边界；LOD 几何 payload 和 SVG 活动覆盖层同样最多处理 128 条边。系统只把 `documentIndexRebuildRequired` 置为真，先完成本次指针反馈；交互结束后，`documentIndexCompactionScheduler` 在主线程以 `2ms` 时间片分别构建私有节点空间索引、连线空间索引和邻接索引，持续校验文档版本与交互代次，完成后一次替换三份活动索引。过期任务只重排，不会把半成品或旧几何安装到当前文档。

图层编号由 `createLayerAllocator()` 的双游标分配。`committedMax` 表示已提交实体的最高层，`reservedMax` 表示已经预留过的最高层；`reserve(count)` 以常数成本返回连续区间并立即推进预留游标，失败入口也不回收区间，避免稍后的新增重复使用同一层。`commit(items)` 只检查本批实体，完整图层重排时再用 `reconcile()` 更新已提交游标。`layerEntries` 是持久的有序 `shallowRef`：正常新增的高层批次直接追加，历史恢复到旧层级时使用二分位置插入，只有整体换图才全量重建和排序。

### 大型组件包分片、预热与交互提交屏障

复制、粘贴和“我的组件”实例化统一进入 `nodeBundleTransactions.js`。不超过 64 个节点且不超过 128 条内部连线的包保留同步快路径；超过任一阈值后，节点排序、ID/组合映射、模型归一化、响应式实例创建、内部连线重建、历史大小计算以及节点/连线私有索引构建都按 `2ms` 动画帧分片执行。捕获大选区时同样按实体边界分片，并通过已有 `edgeAdjacency` 只遍历选中节点的相邻边，不扫描整张连线数组。

准备任务先生成完全脱离当前文档的一次性实例及私有空间索引、邻接索引、运行键索引和历史条目。发布时只为本批预留图层，附加私有索引，向原始实体数组尾部写入本批数据，再统一 `triggerRef`；不会复制已有 Map，也不会执行 `nodes/edges/layerEntries.concat(...)`。附加索引产生的分段由后台 `2ms` 任务压实，压实完成前查询仍覆盖全部分段。常用“我的组件”和剪贴板包会在编辑空闲帧预热；命中预热实例时拖入可直接发布，冷的大型包立即显示目标占位框，真实实体准备完成后原子替换，因此不会把约 202ms 的冷准备 CPU 工作同步塞入拖放事件。当前 2,000 节点包发布到已有 6,016 节点文档的同步发布段约为 `10.68～13.73ms`；冷准备按 `2ms` 分片约需 `1.7s` 墙钟时间，预热用于消除常用路径的这段等待。

`interactionCommitBarrier.js` 用活动键集合和单调 `generation` 统一覆盖指针操作、连续缩放、滚动、连线及线段起点拖动。组件包捕获/发布和文档索引压实携带开始时的交互代次；任何用户交互跨过任务生命周期都会使旧提交失效。需要重试的捕获和压实按 key 合并，在全部交互结束后的一个干净动画帧才恢复；恢复帧前又开始新交互时继续延期。这样后台任务不能在 `pointerdown` 到 `pointerup` 之间替换索引或发布大包，也不会因多个重试请求重复执行同一种后台提交。

### 结构面板窗口化

右侧“结构”面板不再为每个图层长期挂载一行 DOM，也不创建完整倒序副本。`structureVirtualRows` 按固定 `40px` 行高、当前滚动位置、可见高度和上下各 8 行缓冲只生成虚拟窗口；显示最高层在前时直接读取 `layerEntries[entries.length - index - 1]`。占位容器保留完整滚动高度，实际只挂载视口附近的按钮。以约 `640px` 高的面板为例，6,016 个图层只需挂载约 32 行，选中、锁定和层级文字仍直接读取原实体。

窗口化优化的是结构面板的 DOM 创建、样式计算、布局和倒序复制成本。画布和预览节点的 `z-index` 直接通过持久 `nodeIndex` 读取实体自身 `layer`；普通新增使用双游标预留层级并增量追加 `layerEntries`，不扫描现有实体，也不重排完整图层列表。置顶、置底和上下移层等确实改变全序的命令仍可复制当前条目并统一同步层号。固定行高是滚动坐标与虚拟行索引的契约，修改 `.structure-row` 高度时必须同步修改 `STRUCTURE_ROW_HEIGHT`。

### 指针事件逐帧合并

浏览器可能在一帧内产生多次 `pointermove`。编辑器只保留最新坐标，并通过 `requestAnimationFrame` 每帧计算一次移动、缩放或旋转。

节点按下后先建立延迟捕获操作，只有屏幕位移达到 `4px` 才进入真实拖动。延迟阶段返回同一个稳定空活动节点集合，不触发无意义的视口查询；超过阈值后才把真实拖动节点加入活动集合，防止虚拟化在拖动过程中卸载对象。

移动、缩放和旋转第一次发生真实变化时，撤销历史只记录受影响节点的 `x/y/w/h/rotate/visualScaleX/visualScaleY`，线稿几何操作只记录对应点集，不再为一次拖动同步 `JSON.stringify` 整张大图。

组件卸载或热更新时会先取消并清空待执行的指针动画帧和坐标，再结束当前操作，避免 `pointerUp()` 在画布引用释放后补执行一次旧拖动。

### 大选区 Worker 与 2ms 降级提交

选中节点超过 128 个时，移动、缩放和旋转不再在每个 `pointermove` 中同步改写全部实体。拖动期间主线程只更新组合交互框的临时边界；松开指针后把原始成员和变换参数交给 `largeSelectionTransform.worker.js`，Worker 使用与普通路径相同的边界、局部轴倍率、旋转和画布约束算法计算最终几何。Worker 创建失败、运行报错或 `postMessage` 失败时，`largeSelectionTransformTask.js` 在主线程按最多 `2ms` 的可恢复切片执行同一算法，不允许退回单帧全量计算。

计算完成后，实体 raw 几何写入、节点空间索引和相邻连线空间索引仍按 `2ms` 分片提交。提交期间透明 `geometry-commit-shield` 阻止新的指针和键盘命令，旧世代回调不能写回；全部节点、索引和历史一致后才一次发布 Vue 引用并解除屏障。这样用户先得到立即可见的操作框反馈，同时最终模型、撤销历史和 LOD Canvas 不会暴露半提交状态。

### 连续滚轮两阶段缩放

`canvasWheel()` 仍按动画帧累计同一帧内的全部滚轮档位，但不在每帧发布 Vue `zoom`。`createCanvasZoomTarget()` 从当前投影状态计算下一倍率和滚动位置，并保存首次鼠标局部坐标及对应世界坐标；连续目标通过 `anchoredCanvasScroll()` 保证鼠标下内容保持原屏幕位置，只有真实边界不足时才独立夹取越界轴。目标世界视口仍在已挂载范围内时，`applyTransientCanvasZoom()` 只直接修改固定的 `.stage-space` 宽高、`.stage` 合成变换和画布滚动位置；向外缩放露出新区域时，`transientCanvasRenderBounds` 会把手势开始范围与目标范围合并，以空间索引查询一次并只增加节点、关联连线和线稿。Vue 完成新增 DOM 后才应用目标变换，因此不会先显示空白区域。临时范围在同一手势中只扩不缩，不会反复卸载和重新创建原有节点，也不会退化为全图扫描或刷新鹰眼。

最后一次有效滚轮后使用 `96ms` 空闲窗口合并提交。提交时必须先用实际 DOM 滚动值写入 `viewport`，再一次设置响应式 `zoom` 并清除临时范围，避免出现“新倍率 + 旧视口”的中间帧；最终可见集合会在同一响应式批次收敛，不出现清空节点的过渡帧。滚轮期间若实时数据引发其他 Vue 更新，`onUpdated()` 会恢复当前投影样式；按钮缩放复用同一目标计算，并等待一次 `nextTick()`、显式应用仍有效的 transform 与滚动目标后再提交，避免新区域挂载回调被同步提交提前失效。取消、重置、固定画布、开始指针操作和卸载都会清理计时器、动画帧、临时范围及投影状态。

缩放反向尺寸统一由画布继承的 `--inverse-zoom` 表达。滚轮瞬时阶段有意不更新该变量，否则全部节点都会重新计算手柄样式；最终 Vue 提交时统一更新。节点移动命中层使用固定 `24px` 尺寸配合 `scale(var(--inverse-zoom))`，不再为每个节点写入独立宽高变量。

### 实体新增与删除差异历史

普通组件、完成后的铅笔和多点线段、连接线、复制/粘贴、模板实例及旧线稿复制等新增操作使用 `recordEntityInsertion()`，只记录本批 `nodes/edges/drawings` 原本不存在。删除节点时同时捕获被删节点及其关联连线，删除旧线稿时只捕获目标线稿；未参与操作的实体不会进入该条历史。

实体历史统一使用 `{ id, index, value }`：`value: null` 表示应用后的目标状态中该实体应不存在；非空 `value` 表示恢复到原 `index`。同一编辑会话中的撤销和重做直接复用已经脱离数组的 Vue 实体引用，恢复时不再深克隆或重复执行 normalizer；嵌套表格、路径和媒体仍保持原引用身份。撤销或重做前，`captureEntityEntry()` 只读取当前受影响实体并生成反向差异；正常路径按已记录位置直接命中，位置偏移时只为目标 ID 建立兜底 Map，并在目标全部找到后停止扫描。

`applyEntityEntry()` 把连续索引合并为区间，2,000 个连续节点或 4,000 条连续连线各只执行一次 remove/restore `splice`。大历史显式在 Vue 原始数组上完成批量变更，保留代理引用供空间和节点索引复用，全部索引同步后每个变更集合只发布一次 `triggerRef`。图层删除也使用稳定原地压实和单次尾部 `splice`，不再逐条移动剩余数组。正式 6,016 节点图纸前 2,000 节点的 10 轮 Node 同步基准中，删除历史捕获为 `3.99ms`；一次早期样本的 Undo/Redo P95 为 `9.506ms/4.354ms`，最终两次复跑的 Undo P95 分别为 `15.809ms`、`14.627ms`，Redo P95 分别为 `11.024ms`、`6.008ms`，全部低于 `16.7ms`。这些数字衡量历史与索引同步，不代替浏览器渲染验收。

应用实体差异后，删除节点从空间索引移除，恢复节点把 Vue 响应式数组中的实际代理引用增量写回空间索引；选择、文字/表单/表格编辑、连线起点等指向已删除实体的临时状态同步清理，鹰眼版本也会失效。低倍率编辑中，直接删除以及撤销/重做产生的实体删除都会把本批移除节点、连线和旧线稿交给 `patchRemovedEntities()`，只恢复并重画其原边界脏区，避免已删除视觉留在 Canvas 底图上。属性和表格编辑使用字段记录，连续输入按焦点会话合并；组合和锁定只记录对应字段；图层命令记录有序实体键；“我的”模板记录列表插入或删除。所有撤销类型都只复制本次受影响的数据，不保留同步序列化整张图纸的兜底分支。

### 自由路径降采样

铅笔绘制只在新点与上一点距离达到阈值时追加点，避免慢速移动产生大量几乎重合的 SVG 坐标。落笔结束后路径点归一化保存到普通节点中，缩放和组合只更新节点边界，不逐点重写路径，降低复杂线稿参与整体变换时的开销。

### 实时数据逐帧批处理

`runtimeGateway` 先把数组、`{ values: [] }` 或键值对象统一转换为 `{ key, value }[]`，小批通过 `runtimeUpdatePipeline.publishSynchronously()` 保持 `send()` 的同步返回语义，大批则由同一管线公平分片后再交给 `useRuntimeData`。`useRuntimeData` 只接受当前图纸已注册的活跃键；未注册键不进入叶子队列、不创建发布任务，`enqueue()` 返回真实接受数。大批 ingress 使用 `pendingIngressByKey` 与令牌队列，同键在消费前到达的新批值直接覆盖旧值，因此 latest-wins 在入口管线和叶子发布两层都成立。解绑再重新绑定会进入新的激活世代，旧的延迟值不能穿越世代。

运行时值保存在普通 `Map` 中，以 `2ms` 时间预算和数量上限逐帧合并；已有叶子订阅、绑定或兼容订阅的键在大批 ingress 中优先发布，6,016 项批次尾部的可见键也能进入首帧。每个 `dataKey` 使用独立订阅，不维护会使全部节点失效的全局批次版本，因此 DOM 只刷新发生变化键的可见节点，Canvas 则通过增量 `dataKey -> node id` 索引取得脏节点。数据不进入图纸模型、localStorage 或撤销历史，切换图纸时断开网关并立即清空。

新参数绑定保存 `target + sourceId + jsonPath`。`sourceBindingRuntime` 维护 `sourceId -> 唯一 JSONPath` 引用索引：节点新增、删除、换图或修改 `dataBindings` 时只增量增减引用，同一源同一路径无论被多少组件使用，每个快照版本都只求值一次。结果使用稳定派生键进入原有 `dataBindingIndex` 和运行数据管线，更新时不扫描整张图纸。旧图纸的 `pointId` 绑定继续走原有多对多索引。

`runtimeNodeMaterializer` 按当前点位值生成浅层只读视觉节点。文字、颜色、透明度、表单状态、进度、动画、图表和表格只覆盖渲染输入，不修改响应式图纸对象，因此高频值不会触发保存、撤销历史或整树文档失效。表格运行数据有列数和行数视觉上限；历史序列、超大数组及复杂对象应在服务端或 Worker 聚合、裁剪和降采样，不能按采集频率全量推入组件。

动态表格适配在列推断、行映射和单元格克隆之前先把输入限制为 `50` 行、`12` 列；纯数组和 `{ columns, rows }` 数据集走同一预算。图表最多读取前 `12` 行，每行最多检查 `12` 个候选值，即使数据源快照包含 10 万行或超宽数组，也不会按原始数据总量物化组件。需要翻页、滚动历史或更大数据集时，应由 SQL/HTTP 数据服务提供分页、筛选或聚合结果，不能直接提高单个组件的渲染预算。

DOM 叶子和 Canvas 共用 `runtimeValueFormat.js`，不再对未知对象直接 `JSON.stringify`。默认输出最多 256 个字符、嵌套最多 4 层、对象最多 12 个键、数组最多 12 项、整个值最多读取 48 个条目；循环引用、抛错 getter、撤销代理、超大 BigInt 和代理枚举异常都有有界占位结果。限制同时约束输出长度和实际读取工作量，后续接入复杂对象时不会因一个异常运行值遍历整棵对象树或生成超长临时字符串。生产网关仍应优先发送显示所需的标量或小型结构，格式化边界不是把任意大对象高频送到浏览器的许可。

当前网关使用本地连接和结构化样例快照完成纯前端闭环。一张图纸只订阅一次源快照流；MQTT、HTTP、MySQL、SQL Server、Redis、Socket 和 WebSocket 后续由工作空间级适配器各自采集一次，并以 `{ sourceId, revision, quality, data }` 发布。组件不会直接创建协议连接或重复请求同一数据源。

大快照保存在普通内存而不是 Vue 深响应式对象、图纸 JSON 或本地连接配置中。默认网关读取返回隔离副本；编辑器内部使用显式只读共享读取，真实采集适配器还可移交刚解析出的 JSON 所有权，避免同一大响应重复深拷贝。停用、检测中、滞后、离线、异常或删除连接时发布不可用质量，所有派生键变为 `undefined` 并回退静态属性；恢复 `good` 后按最新快照重新求值。

工作空间级连接与旧点位兼容目录默认由 `workspacePointSourceStore` 写入独立 IndexedDB，而不是 localStorage 大字符串。每个工作空间的 v2 manifest 只保存脱敏连接元数据、`pointCount`、自描述的 `pointChunkMaxItems` 和有序 chunk key；点位默认每 `256` 条一个 structured-clone shard。新 revision 的全部 shard 写完后才发布 manifest，失败清理本轮暂存块并继续保留上一 durable manifest；成功后再回收旧 revision。chunk key 使用 workspace/source 归属、随机 store namespace、单调 revision 和 sequence，读取时校验工作空间、来源唯一性、key 归属/顺序/重复、块数量、块上限及总点数。默认操作在浏览器支持 Web Locks 时以 `tc2d-point-sources:<workspace>` 独占锁跨标签串行，并在锁内强制重读 durable manifest、同步有效 chunk key 缓存，防止另一个页面更新并回收旧 revision 后当前页继续引用旧块；没有 Web Locks 时仍保留页内操作队列和原子 manifest 发布，但不能把它描述为严格的跨标签互斥。旧 localStorage v1 整快照和 v2 分片只在 IndexedDB 提交成功后删除；每 4 次 IndexedDB 操作通过 `scheduler.yield()` 或 `setTimeout(0)` 让出主线程。

首次激活或刷新大兼容目录不会同步规范化十万点。`pointCatalogPreparation` 在私有 `sources/sourceIndex/pointIndex` 和健康、离线计数 Map 上按默认 `4ms`、最多 `4096` 次操作/片推进；新 generation 取消旧任务，重复来源/点位 ID 或任意失败都不发布，全部完成后才一次安装。可见页面使用动画帧调度，隐藏页面改用 timer，避免 rAF 暂停导致工作空间激活永久 pending。该准备阶段控制单片阻塞，不承诺十万点的总 CPU 或墙钟时间为零。

### 节点渲染记忆

编辑和预览节点使用 `v-memo`。节点自身属性、选择状态和运行时数据版本未变化时，Vue 跳过其子树更新。表格/表单、进度、铅笔和多点线段原本需要在每次父级渲染时对嵌套数组执行 `JSON.stringify`；现在 `nodeRenderMemo()` 使用 `WeakMap<node, computed>` 为每个节点缓存四类渲染键，模板只读取一次缓存对象。对应响应式字段变化时 computed 自动失效；节点被整体替换或删除后，WeakMap 不阻止旧代理回收。连续缩放不再重复遍历大量单元格或路径点。

### 复杂表格 DOM 虚拟化

表格含表头在内超过 `120` 个单元格时，`NodeVisual.vue` 使用 `tableVirtualization.js` 按当前 `scrollTop/scrollLeft`、视口尺寸及实际行列轨道计算可见窗口，只生成相交单元格并保留上下 2 行、左右 1 列缓冲。Grid 仍声明完整行列轨道，因此滚动尺寸、标题、表头、末行和末列保持原语义；窗口穿过合并区域时会补入合并原点，并继续跳过被该区域覆盖的普通单元格。

固定行高直接使用模型轨道。自动换行模式会读取浏览器计算后的实际 `gridTemplateRows`，滚动窗口通过被动监听和单个 `requestAnimationFrame` 合并更新；用户停留在底部时短暂保持底部锚定，等待动态行高收敛后仍能看到最后一行。该能力位于编辑和预览共用的 `NodeVisual.vue`，所以编辑画布、原始尺寸预览及全屏预览采用同一规则。

预览递增挂载另由 `previewMountBudget.js` 按节点复杂度限流。工具默认一帧最多处理 128 个节点、成本预算 1,024；主预览为覆盖宽屏 672 个可见节点的真实压力场景，显式使用 `batch-size="8"` 和 `mount-cost-budget="64"`。普通节点成本固定，选择器随选项数增加，表格随行列数和表头增加。这样 50 × 12 表格不会与普通矩形按相同成本一次大量挂载，即使视口内同时出现多个复杂表格，也不会把全部单元格创建集中到同一帧。

当前开发机使用 50 × 12 表格完成真实浏览器滚动验收：固定行高模式首屏实际挂载 72 个单元格，滚到右下角为 78 个；自动换行模式首屏为 24 个，滚到底部为 18 个。四个位置都远低于完整表格的 600 个表体单元格，末行末列、远端滚动和内容显示正常。

### 视频地址与嵌入数据

本地视频保存为 Data URL，但右侧属性面板只渲染“本地视频”和体积，不把最高约 26.7MB 的 Base64 文本写入 `<input>`。网络地址输入事件只更新一个非响应式短草稿，失焦、Enter 或画布选择变化前才一次性更新原节点，避免每次按键都刷新根组件、修改 `<video src>` 或重复加载媒体。画布仍按视口挂载视频节点；单屏同时放置大量视频时，媒体元数据和解码资源仍会高于普通图形，应使用目标设备单独验收。

### 历史内存上限

普通图纸保留最多 80 条历史；超过 1,000 个节点的图纸自动降低为 20 条，同时按约 12MB 内存估算上限淘汰旧记录。连续变换使用几何差异，实体新增和删除使用存在性差异，属性/表格使用字段差异，图层使用顺序差异，模板使用列表差异。内存估算直接遍历受影响记录且保留不可变长字符串引用，不通过 `JSON.stringify` 物化副本；已准备的实体历史大小以 raw 条目为 WeakMap key 缓存，淘汰时不再重新遍历大型条目。若未来增加新的可撤销操作，必须继续使用边界明确的差异类型，不能恢复整图同步快照或取消内存上限。

### 多工作空间隔离

每个浏览器实例维护独立的编辑状态，恢复缓存再按 `workspaceId` 分键。切换图纸或工作空间会清空当前选择、指针操作、剪贴板、运行时数据和通信定时器；撤销历史属于各自图纸会话，切换后保留并在返回时恢复，成功应用 Undo/Redo 后也会重新调度会话持久化。完整多图纸会话异步写入 IndexedDB；内存 LRU 的目标容量为最近 3 个工作空间，但只有“最新版本快照已经成功落盘”的最旧条目才可淘汰。开始新保存会先把对应工作空间标记为脏，并发保存由单调版本门禁保证旧完成结果不能误标最新状态；保存仍在途时发生的新编辑会立即提升脏版本，使旧保存即使随后成功也不能把工作空间误标为已持久化或触发 LRU 淘汰。IndexedDB 保存失败时，最新会话继续留在内存，即使临时超过目标容量也不能用数据丢失换取固定上限。相同图纸使用 `revision` 检查多标签页旧版本覆盖。

自动会话持久化不会在 debounce 结束后立刻遍历和克隆整份会话。它先进入 `createCancellableIdleTask()`：新编辑先用 `markDirty()` 使在途保存令牌失效，再取消并重排旧 timer/idle 回调；旧 generation 即使迟到也不能捕获或写入会话。真正执行前同时检查当前指针操作、交互提交屏障、文件操作、工作空间切换和 `navigator.scheduling.isInputPending({ includeContinuous: true })`，并要求非 timeout idle deadline 至少剩余 `8ms`；不满足时以 `500ms` 重试。`requestIdleCallback` 使用 `2.5s` timeout，timeout deadline 可越过普通 idle 预算检查，避免浏览器长期不给空闲时间而饿死落盘，但活动操作和输入门禁仍优先保护交互。显式文件保存和工作空间切换会取消待处理自动任务，直接 `await storeWorkspacePaperSessions()` 完成当前会话持久化，不经过 idle gate。

`workspaceSessionStore.js` 使用显式任务栈增量生成 JSON，默认时间片为 `4ms`，输出 `64KiB` Blob chunks；单个长字符串再按最多 `4KiB` 切片转义。每个任务单元都会检查 `navigator.scheduling.isInputPending({ includeContinuous: true })`，有输入或时间片耗尽时通过 `scheduler.yield()`，不支持时降级 `setTimeout(0)`。IndexedDB 仍以单 key 原子 `put` 提交，但结构化克隆的只是包含 Blob 引用、长度和句柄路径的小 envelope，不再是整份图纸对象图。`customHandle` 单独保存在 envelope 并按路径恢复；浏览器不能克隆句柄时，同一工作空间队列重试无句柄快照。读取继续兼容旧 object 记录。

`beginSave()` 返回的单调版本通过 `isSaveCurrent()` 传入编码器。编码开始、每个增量任务、每次让步恢复后和真正 `put` 前都会校验 freshness；新编辑或更新保存使版本过期时返回 stale，不执行 `put`、不尝试无句柄 fallback、不弹失败提示，也不调用 `completeSave()`。原子 `put` 完成后仍返回 `completeSave()` 的真实 freshness 布尔值，覆盖极窄的“写入期间又编辑”窗口：已写旧快照不等于最新状态已持久化，内存条目继续保持 dirty 且不可淘汰。解码句柄路径只允许逐段进入 decoded snapshot 的 own property，损坏 chunk 或试图经继承属性越界的路径会受控失败。关闭 store 同样中止在途编码。该链路消除了大会话整图结构化克隆长任务，但不承诺存储、调度或屏幕刷新耗时为物理 `0ms`。

工作空间切换由 `workspaceSwitchPending` 形成原子交接屏障。开始时先把应用壳设为 `inert/aria-busy` 并显示透明 shield，指针移动、线段起点拖动和编辑快捷键同时受门禁；`settleWorkspaceSwitchInteractions()` 结束线段拖动、缩放、滚动和连接锚点，提交现有指针操作，依次等待 `interactionCommitBarrier.whenIdle()` 与 `workspaceAsyncOperationBarrier.whenIdle()`。后者覆盖已开始的异步组件包捕获/插入和图片/视频 FileReader，切换不得把这些用户操作静默丢弃。只有两类状态都一致后才依次执行当前兼容副本保存、`await storeWorkspacePaperSessions()`、更新 `workspaceId`、恢复 IndexedDB 会话或兼容副本。

首次挂载和每个恢复 `await` 后都检查 `componentLifecycleActive`。卸载先使生命周期失效、取消媒体读取和组件包工作，再 dispose 异步屏障、JSON 解析器与会话仓储；Worker 失败后的主线程解析也受同一代次约束。`ProjectJsonParserDisposedError` 只表示组件已经销毁，不能据此删除本来合法的 localStorage 兼容副本。这样卸载后的解析、媒体或切换回调不能写回已释放状态；正常切换的任一步骤返回或抛错则只能在 `finally` 中解除门禁。

多人访问时，前端实例之间不会共享 Vue 状态或渲染负载。共同瓶颈位于静态资源服务器、认证和图纸 API、数据库及实时数据网关；这些服务必须单独压测。生产环境应部署构建产物到 Nginx、IIS 或 CDN，不使用 Vite 开发或预览服务器承载并发用户。

## 图纸文件、恢复副本与结构容量

项目 `图纸库/` 和浏览器授权的“其他位置”保存的是正式 JSON 图纸。本地图纸库 API 的单图读写上限默认是 `256 MiB`（`268435456` 字节）；启动前可用正整数环境变量 `TC2D_MAX_DRAWING_BYTES` 覆盖，取值还必须在当前 Node Buffer 可处理范围内。磁盘路径在 stat 后、`readFile` 前检查：超限文件从列表忽略，直接打开返回 `413 Payload Too Large`，保存时读取已有目标做冲突校验以及删除前读取也受同一门禁。限制检查早于 metadata/ETag 缓存命中，因此配置调小后旧缓存不能绕过新上限。`PUT` 先检查 `Content-Length`，没有长度的 chunked 请求则在单缓冲扩容读取时累计字节，任一路径超限都立即返回 `413`；压缩请求体被拒绝，不能用传输压缩绕过容量。`drawingRepository` 的列表、读取、保存、删除和 `HEAD` 存在性探针都显式关闭通用 `15s` 固定超时。浏览器“其他位置”不经过本地图纸库门禁，但仍受设备、浏览器和结构容量限制；生产后台必须声明并执行自己的等价上限。

完整工作空间会话由 IndexedDB 按 `workspaceId` 保存，快照包含多张图纸、活动图纸、文件身份和各自历史。恢复时逐张执行结构准备，损坏条目被过滤；全部损坏时删除该持久化快照并回退兼容恢复路径。`localStorage` 只保留当前活动图纸的小型兼容恢复副本，不是完整多图纸会话仓库；兼容副本使用默认 `4ms` 时间片有界编码，长字符串每次最多处理 `4KiB`，累计超过约 4 百万字符时立即早停并删除旧 key，不会先同步物化整份大图文本。它不影响 IndexedDB 会话或正式磁盘文件，也不能作为保存是否成功的判断。跨标签更新和保存前冲突检查只在 JSON Worker 中解析并返回 `projectId/revision/updatedAt`，避免把兼容副本的完整对象图克隆回主线程。

图纸库文件、其他位置文件和 localStorage 兼容恢复正常使用 `projectJsonParser.parseAndPrepare()`：`projectJson.worker.js` 不只执行 `JSON.parse`，还在独立线程调用 `prepareProject()` 完成结构与容量校验、旧版本迁移、节点/连线/线稿/模板归一化。准备结果按 `nodes/edges/drawings/customComponents` 分块回传，每块最多 `128` 项且目标估算不超过 `1MiB`；单个无法拆分的超大实体单独标记，主线程按协议校验顺序、起点、计数和完成消息后才组装结果，避免一次结构化克隆完整大图。Worker 不可用、创建失败、`postMessage` 失败、运行崩溃或消息反序列化失败时，所有待处理请求会切回同一操作的主线程实现；失败 Worker 不继续复用，避免请求永久悬挂。该降级保证功能完整，但大文件会占用主线程，因此 Worker 路径仍是正式大图的性能基线。Worker 结果还不能直接替换当前文档：`projectRuntimePreparer` 以默认 `4ms` 时间片建立完整私有运行 bundle，覆盖实体响应式集合、节点/线稿/时间索引、运行键与源绑定、三类空间索引、邻接索引、图层分配器和有序图层条目，完成后由 `installPreparedEntityCollections()` 一次安装。这里的 `4ms` 属于打开阶段；高出度节点松手后的三索引压实继续使用独立的 `2ms` 预算，二者不能混写。

图纸列表用文件的 dev/inode/模式/大小/高精度修改与创建时间组成 stat 签名，未变化时复用已校验的 metadata/ETag，直接打开可登记当前缓存。保存完成后会重新读取文件并核对期望 ETag，同时在验证前后都失效缓存，防止并发列表在写入窗口把旧 metadata 重新放回；删除同样主动失效。只有确定性的 `422` 结构或 JSON 错误会按同一 stat 签名负缓存，文件变化后自动重新校验；临时 I/O、权限或读取竞态错误不缓存。这样重复刷新不会反复读取和解析同一无效大文件，也不会把瞬时故障或保存竞态固化。

字节大小与结构数量是两类独立限制。当前前端校验最多允许：

| 结构 | 上限 |
| --- | ---: |
| 画布节点与旧临时线稿合计 | 10,000 |
| 节点连线 | 20,000 |
| 旧临时线稿数量 | 5,000 |
| 顶层与模板中的铅笔、线段及旧线稿点数合计 | 250,000 |
| 单个顶层或模板 `polyline` | 10,000 点 |
| “我的”模板数量 | 200 |
| 全部“我的”模板节点合计 | 2,000 |
| 全部“我的”模板内部连线合计 | 4,000 |

前端导入和 Vite 本地图纸服务共同调用 `validateProjectForFrontend()`，因此主图、旧线稿与“我的”模板使用同一容量、重复 ID、几何和悬空连线契约；模板内的 `pencilPoints/polylinePoints` 计入 250,000 总路径点，单条模板或顶层 `polyline` 都不得超过 10,000 点，不能由前端静默截断后让前后端得到不同图纸。单个本地视频仍限制为 20MB，这是嵌入媒体入口的保护规则，不是整张 JSON 图纸上限；文件即使远小于 256 MiB，只要结构越界仍会被拒绝。

## 接入数据时的规则

推荐后端消息先在 `runtimeGateway` 适配器中归一化。小消息可以直接解码；真实大 JSON 必须把 UTF-8 解码、`JSON.parse` 和结构校验移入 Worker，主线程只接收已经解析且通过大小门禁的批次：

```js
socket.onmessage = event => runtimeDecodeWorker.postMessage(event.data)
runtimeDecodeWorker.onmessage = event => gateway.send(event.data.values)
```

`runtimeUpdatePipeline` 位于协议归一化与 `useRuntimeData` 之间。`normalizeRuntimeUpdates()` 保持同步纯函数 API，供小批快路径和测试直接使用；队列消费按默认 `2ms` 时间预算及项目数双重切片，并在批次间公平轮转，新到的小批不能被旧大批长期压在队首。每个批次获得单调 sequence，同一 key 在批内和跨批都执行 latest-wins，已被新批取代的旧值在发送前还会再次过滤。只有 `onChanges` 成功返回后才提交 `lastValues`；sink 抛错时保留原 chunk，在下一调度代重试，不能因失败去重而丢值。

统一数据层是逻辑概念，不把所有协议数据复制成一个巨大对象。每个协议适配器只发布自己的最新 JSON 兼容快照；组件保存 `target + sourceId + jsonPath`，不保存协议地址。文本、颜色、数值、布尔和表格在组件参数边界按目标类型做有界转换；路径无结果、格式不兼容或来源不可用时使用属性页静态值，不能把动态值写回图纸。旧 `pointId` 绑定仅作为历史兼容入口保留。

入口同时限制单批项目数、总 pending 项目数、键长度、字符串值长度和二进制值字节数。数组等已知长度输入在入队时一次预留容量；未知 iterable 先预留一个槽位，再随 `next()` 逐项增加，不能信任自定义 `size` 绕过背压。`stop()` 递增 generation、取消当前句柄并正常结算已成功发送的部分结果；即使取消失效，旧 generation 回调也不能消费重连后的任务。生产端仍应优先发送 changes-only 数据并设置协议消息字节上限，不能把前端 pending 限制当成网络层无限接收的许可。

避免以下做法：

- 每条消息都替换整个 `nodes` 数组。
- 把实时值写入撤销历史。
- 每个节点单独建立 WebSocket。
- 每个绑定重复订阅或轮询同一个数据源。
- 每个组件单独解析同一 JSONPath，或数据变化时扫描全部节点。
- 把长时间序列全部保留在节点对象中。
- 在 `pointermove` 或设备消息中保存完整图纸快照。
- 把高频实时数据和低频操作审计写入同一队列或数据库表。

历史曲线应使用固定长度环形缓冲区，并按显示像素宽度降采样。不可见图表应暂停采样后的视图更新，但可以继续保存必要的原始数据。

图纸保存、操作事件和实时值必须使用独立限流策略。图纸保存维持 ETag/revision 乐观锁；操作事件按批次和时间窗口提交；实时值可以丢弃过期中间态，只保留当前帧每个键的最后值。普通 HTTP 请求由 `httpClient` 使用 `15s` 默认超时；图纸列表、读取、保存、删除和 HEAD 探针通过仓储适配器使用独立传输策略，当前本地适配器对五者都关闭固定超时。生产后台应改为与部署容量匹配的可配置超时或可取消传输，并限制请求体、分页图纸列表、对大图快照采用压缩或对象存储，不能仅靠无限等待掩盖服务端瓶颈。

当前本地适配器的默认单图读写上限是 256 MiB，磁盘预读或请求体超限按对应接口返回 `413`，列表则忽略超限文件；生产后台仍应根据设备和存储能力制定自己的请求体与对象读取策略并在接口文档中公布，不能复用 `localStorage` 的约 4MB 兼容副本阈值，也不能假设修改 `TC2D_MAX_DRAWING_BYTES` 会配置远端服务。

## 容量判断

是否卡顿取决于可见节点复杂度、连线数量、动画数量、数据频率和设备性能，不能只根据图纸总节点数判断。当前架构针对以下情况做了约束：

- 大量节点分布在较大画布：由空间索引缩小候选集合，大范围只查实际占用桶，再由自适应缓冲的视口虚拟化控制 DOM 数量。
- 连续滚轮缩放：覆盖范围内只修改固定舞台合成层；新露出区域先用空间索引增量挂载，停顿后一次发布视口和 Vue 缩放状态。
- 高频节点、时间、层级与连线读取：持久索引按批次增删，双游标常数级预留新层级，画布直接读取实体层级，不因普通新增或缩放重建索引并排序全图。
- 高频批量数据：由逐帧合并控制刷新频率，最大约为屏幕刷新率。
- 大量自由路径：由点位降采样控制 SVG 数据量。
- 多个内置及自定义动效组件：优先使用 CSS transform/opacity 动画；进度波动和信号灯仍有组件级 JavaScript 调度，需要按目标设备单独压测。
- 连续移动、缩放和旋转：撤销历史使用几何差异，避免操作开始时序列化整张图纸。
- 超过 128 个节点的大选区变换：指针阶段只更新临时边界，最终几何优先由 Worker 计算；Worker 不可用时按 `2ms` 主线程切片降级，实体和索引提交同样分片且受命令屏障保护。
- 新增、复制、粘贴或删除对象：撤销历史只保存受影响实体及关联连线，不序列化整图。
- 大型复制、粘贴和“我的组件”：超过 64 个节点或 128 条内部连线后按 `2ms` 分片准备，常用包空闲预热，发布只附加本批实体和私有索引；交互提交屏障禁止后台任务跨过活动指针、缩放、滚动或连线操作提交。
- 属性、表格、组合、锁定、图层和模板：分别使用字段、顺序或列表差异，不保留完整 JSON 历史兜底。
- 复杂运行值：显示格式化同时限制字符、深度、键数、数组项和总条目，循环或异常对象不会触发无界遍历。
- 低倍率编辑：达到阈值后使用分片 Canvas 承载整图，DOM 和 SVG 前景保持有界；普通倍率继续使用视口虚拟化 DOM。
- 预览：自适应激活时使用最多 `4ms` 的分片 Canvas 首帧，并按显示尺寸、倍率和实际 DPR 动态分配不超过 `8,388,608` 像素的位图；非活动 fit bootstrap 上限为 `4,194,304` 像素。运行值与时间只恢复和提交脏矩形，隐藏 fit surface 完全暂停调度；原始尺寸及全屏继续保留完整 DOM 交互，带缓冲视口超过 `1,024` 条连线时仅由同为 `4ms` 分片的高 DPI Canvas 窗口接管连线。
- 复杂表格：超过 `120` 个单元格后按滚动窗口挂载，动态行高保持底部锚定；预览批次再按节点复杂度限流，避免表格 DOM 集中创建。
- 打开鹰眼：复用已有节点和图层索引，在离屏 Canvas 中按 `2ms` 空闲分片绘制；新世代取消旧任务，完成前不改动可见位图。
- 打开“结构”面板：固定行高窗口化列表从有序图层尾部反向读取，只挂载当前滚动窗口附近的图层行，不复制完整倒序数组。

### 本轮可重复基准

以下数据来自当前开发机的 Node 非 UI 基准，用于定位算法成本，不代表浏览器帧率：

| 数据 | 读取/解析 | 索引 | 查询与更新 |
| --- | --- | --- | --- |
| 10,000 节点、9,999 连线、2.74MB 压力图 | 30 次读取平均 `8.97ms`、P95 `11.33ms`；解析平均 `17.11ms`、P95 `24.60ms` | 构建 `9.61ms`，约增加 `4.2MB` 堆内存 | 600 次视口查询平均 `0.058ms`、P95 `0.096ms`、最大 `0.569ms`；1,000 节点增量更新 `1.93ms` |
| 正式 `sacada测试.json`：`36,037,698 bytes`、6,016 节点、0 个非空 `dataKey` | 预热后 10 次读取平均 `46.23ms`、P95 `48.87ms`；解析平均 `152.71ms`、P95 `161.84ms` | 空间索引 `11.93ms`，数据键索引 `2.79ms`，合计约增加 `2.82MB` 堆内存 | 600 次视口查询平均 `0.105ms`、P95 `0.171ms`、最大 `0.746ms`，平均返回 362.2 个节点 |

本轮对该正式文件另行单次测得 Node 文件读取 `70.64ms`、`JSON.parse` `177.78ms`。这两个数字只描述打开阶段的磁盘读取和 JSON 解析，不属于画图、接数或预览期间的帧间隔 P95，也不能与交互 P95 混算。

实体历史基准使用同一正式文件的前 2,000 个节点，在保持 Vue 引用、空间索引、运行键索引和图层索引同步的情况下连续执行 10 轮 Undo/Redo：删除历史捕获 `3.99ms`；一次早期样本的 Undo/Redo 同步总段 P95 为 `9.506ms/4.354ms`，最终两次复跑分别为 Undo `15.809ms/14.627ms`、Redo `11.024ms/6.008ms`，所有结果都低于 `16.7ms`，不能只取最小的一次作为结论。大型实体回归另验证 2,000 节点和 4,000 连线连续区间各只进行一次批量移除/恢复，normalizer 调用为 0，嵌套引用、实体顺序、空间索引、数据键索引和邻接索引全部往返一致。正式文件本身没有连线，因此 4,000 连线是正确性压力数据，不冒充正式图纸浏览器 P95。

组件包基准把预先准备好的 2,000 节点实例发布到已有 6,016 节点文档，同步发布约 `10.68～13.73ms`。冷准备 CPU 总量约 `202ms`，当前实现将其拆为 `2ms` 动画帧片段，墙钟完成约 `1.7s`；这组数据说明为什么常用模板需要预热，也说明冷大型模板的占位框代表“已立即接受操作”，不代表真实实体已在物理零毫秒内完成构建。

以正式 `36,037,698 bytes`、6,016 节点图纸构造完整工作空间快照时，旧整对象 `structuredClone` 单次测量约 `193～215ms`。当前增量编码结果为 398 个 `64KiB` Blob chunks；一次正式复跑的编码时间片 P95/P99/最大值为 `4.26ms/4.45ms/4.50ms`，小 envelope 的 `structuredClone` 为 `3.22ms`，解码后 6,016 节点完整往返一致。另一独立调度复跑记录 409 个时间片，P95/最大值为 `4.32ms/4.68ms`，envelope clone 为 `2.98ms`；两组结果都保留，用于观察波动而不是只报告最好样本。该基准证明主线程不再出现旧式整会话克隆长任务，不等于 IndexedDB 磁盘完成时间或用户设备上的绝对零耗时。

实时数据验收使用 6,016 个活跃键，在上一批未消费时连续入队全量值 `1` 和全量值 `2`。每帧最多处理 256 项时，整个队列在 24 帧收敛，6,016 个键均只通知一次最终值 `2`，不发布已被取代的值 `1`。当前开发机测得 `enqueue()` P95 为 `0.536ms`，单帧 drain P95 为 `0.272ms`；这两个指标衡量主线程入队和逐帧消费成本，不包含网络往返或服务端处理。

为覆盖更接近真实接入的前端边界，自动化门禁还使用 6,016 个唯一键、406 个可见绑定、与应用相同的数据键反向索引和生产默认 `2ms` 数据时间片，连续执行 20 轮“WebSocket 文本 `JSON.parse` → 批内去重 → 入队”，并在数据尚未消费时交错执行节点新增、双游标层级分配、空间索引插入、节点移动和视口查询。去除前 3 次预热并独立重复 5 轮后，协议解析、规范化和入队 P95 为 `5.75～8.15ms`，增量编辑 P95 为 `0.29～0.38ms`，运行数据消费切片 P95 为 `2.01～2.04ms`，全部低于 60Hz 的 `16.7ms` 单帧预算。该用例位于 `scripts/performance-acceptance.test.mjs`，用于阻止算法和调度退化；它不包含 DOM 布局、图片解码和 Canvas 像素提交，不能替代浏览器验收。

2026-08-03 最终统一复跑结果如下：100,000 点位 metadata 读取 P95 为 `0.0309ms`、查询切片 P95 为 `4.3352ms`；100,000 点位激活共使用 39 个切片，切片 P95 为 `4.0770ms`；6,016 个组件的绑定索引重建共 26 个切片，切片 P95 为 `1.3689ms`，运行数据排空切片 P95 为 `2.0424ms`，Canvas fanout 切片 P95 为 `0.7879ms`，单一运行键扇出到 6,016 节点的切片 P95 为 `0.1728ms`。全部低于 `16.7ms` 单帧预算；这些 Node 样本用于同机回归，会随机器负载波动。完整稳定性 `729/729`、性能验收 `14/14` 和生产构建通过；`npm audit --offline` 为 0 个漏洞，`npm ls --depth=0` 无 missing、invalid 或 extraneous。最终构建转换 1,829 个模块，用时 `790ms`；主 JavaScript chunk 为 `801.12kB`、gzip `248.06kB`，CSS 为 `113.44kB`、gzip `20.55kB`，`edgeRaster.worker.js`、`largeSelectionTransform.worker.js`、`projectJson.worker.js` 分别为 `2.91kB`、`6.39kB`、`41.75kB`，仅保留既有的主 chunk 超过 500kB 提示。主 chunk 体积仍是初始加载优化空间，但不属于拖入、画图、接数或预览运行热路径。

正式 `sacada测试.json` 为 `36,037,698 bytes`，包含 6,016 个节点和 0 个非空 `dataKey`，SHA256 为 `9080A9FC893858AA36C580FD1C53C57AEA3EB5394E0501038C7059DC3BDC4114`；每个节点本身已经序列化该空字段。性能验收只在内存副本中为全部节点逐个填入唯一键，正式文件未被修改。该副本紧凑 JSON 仅增加约 `71KB`（`0.27%`）；运行时保存 6,016 个标量值并挂载 406 个可见绑定，堆内存约增加 `0.30MB`。因此后续“挂数据”的容量不是主要风险，风险来自全量消息频率、单值复杂度和单屏同时变化的组件数。浏览器压力场景每 `500ms` 推送一批 6,016 键全量值；生产接入应优先发送变化键并在网关边界合并同一刷新窗口，不能把 6,016 键全量快照按 60Hz 连续送入主线程。复杂对象应在服务端转成显示所需的标量或小型结构，历史序列进入独立有界缓冲区。本轮低倍率编辑和 `100%` 预览文字布局截图为 `D:\苔岑公司\2dDP\lod-text-formal-editor-75.png` 与 `D:\苔岑公司\2dDP\lod-text-formal-preview-100.png`。

上一版真实浏览器基线（非当前终验）先加载上述正式图纸，再只对内存临时副本为 6,016 个节点绑定唯一键并按 `500ms` 全量刷新；正式 `sacada测试.json` 保持 0 个非空 `dataKey`。测试在可见前台标签页使用 `scripts/browser-performance-probe.mjs` 收集最近秩 P95 和 Long Task。探针默认最多保留 4,096 个帧间隔、1,024 个 Long Task 和每个交互标签 1,024 个耗时样本；达到上限时压缩最旧样本，长时间运行也不会无限增长。编辑态连续采样 `97.3s`，帧间隔 P95 为 `14.1ms`、Long Task 为 `0`，406 个当前可视运行值持续收敛；文字输入到下一帧耗时 `2.2ms`，普通组件拖入、属性修改和建立连线均成功。退出预览并停止模拟器后，当时 Chromium 单次样本的 `usedJSHeapSize` 约为 `86.3MB`、`totalJSHeapSize` 约为 `115.6MB`，页面有 3,351 个 DOM 元素，画布只挂载 407 个节点和 406 个运行值，控制台错误为 0；该内存数字只用于观察本机是否异常增长，不能当作其他浏览器或目标设备的硬性内存上限。这里验证的是上一版前端渲染与调度链路；本轮源码的浏览器终验必须重新执行，网络、协议解析和未来服务端处理仍需在真实接入后独立压测。

浏览器复测统一在可见前台标签页执行；后台标签页数据无效。测试页可动态导入 `scripts/browser-performance-probe.mjs`，在开始采样后执行拖动、连线、数据推送、原始尺寸预览、自适应预览和全屏预览，再调用 `stop()` 取得结构化报告。验收必须同时满足两组目标，不能用其中一组替代另一组：

- **编辑态**：持续接数期间拖入、连线、属性编辑、大选区移动/缩放/旋转及 Undo/Redo 都有立即反馈；60Hz 帧间隔 P95 `<16.7ms`、Long Task `=0`、运行值最终收敛，新增或恢复对象立即可选择和继续编辑。
- **预览态**：原始尺寸、自适应和浏览器原生全屏分别达到帧间隔 P95 `<16.7ms`、Long Task `=0`；三种模式均非空、图层顺序正确、运行值最终收敛。自适应纯静态图使用单 Canvas；存在 live 节点时，只有在最高层向下最多 `24` 个条目内能形成覆盖全部 live 节点的完整尾段，且尾段不超过 `16` 个 node/`128` 挂载成本时，才允许以持久 DOM live plane 覆盖 Canvas，否则必须完整 DOM 回退。尾段可包含静态 node/drawing，Canvas 必须排除这些实体，混合态不得重复连线、节点或线稿。交接还须验证 `renderPlanKey + excludedNodeIds + excludedDrawingIds + freshness` 完全匹配，并验证 Canvas context 丢失/不可用时回退 DOM；关闭/原始/全屏释放自适应 committed plan。原始尺寸和全屏继续保留表单、按钮、视频、时间、CSS 动画及 Fullscreen API 功能，DOM ready 后释放 fit/bootstrap surface；若带缓冲视口超过 `1,024` 条连线，则另验证 edge-only Canvas 窗口清晰、滚动更新、SVG 不重复绘制及 Canvas 故障后恢复完整 SVG，并通过 resize/focus/visibilitychange 补偿校准全屏状态。

预览态的降级验收还必须证明完整 DOM 的节点与几何采用同一世代：节点、edges、drawings 尚有任一批次未提交时不得进入 `dom-fit`，首个几何批次不得超过 `64` 条连线和 `8` 个线稿，后续自适应倍率不得超过 `4`；关闭预览后迟到完成事件不得重新交接。edge-only 要分别模拟 bounds/plan 变化和设备 DPR 提高，并证明请求 DPR 已进入 plan key、提交前 `frameCommitGuard` 与显示时 committed 门禁都有效；旧 plan/bounds 帧不得清除当前 ready，当前匹配请求的低 DPR 帧必须进入完整 SVG fallback。

上一版拖入链路浏览器基线（非当前终验）使用真实 Vue DOM 和开启状态的鹰眼测量。测试图纸包含 `9,000` 个节点和 `8,999` 条连线；独立连续执行两批、每批 40 次普通矩形拖入，每次记录 `dropItem()` 返回、`nextTick()` DOM 提交及下一次 `requestAnimationFrame`，每批去除前 5 次预热，共统计 70 个有效样本：

| 阶段 | 第一批 P95 | 第一批最大值 | 第二批 P95 | 第二批最大值 |
| --- | ---: | ---: | ---: | ---: |
| 拖入同步阶段 | `0.3ms` | `0.5ms` | `0.4ms` | `0.4ms` |
| Vue DOM 提交 | `5.3ms` | `5.6ms` | `5.7ms` | `6.2ms` |
| 下一动画帧 | `14.7ms` | `27.5ms` | `14.3ms` | `14.4ms` |

70 次新增组件全部在 DOM 提交时成为当前选中对象，可立即进入移动、缩放、属性或文字编辑。两批下一帧 P95 均低于 `16.7ms` 的 60Hz 单帧预算；第一批仅出现一个 `27.5ms` 的孤立尾值，第二批最大值回到 `14.4ms`。该结果证明现有图纸总量不再进入普通新增的同步热路径；“零延迟”在这里表示交互无可感知等待和新增后立即可编辑，不表示浏览器调度与屏幕刷新耗时物理为 `0ms`。

当前开发机还使用 `36.04MB`、`6,016` 节点实际图纸完成了浏览器验证：从图纸库打开后，`9355 × 2643` 舞台在 `100%` 编辑视口只挂载 `233` 个节点；连续缩小到 `62.1%` 时，根据与生产空间索引相同的旋转边界和 `96px` 缓冲应显示 `546` 个节点，DOM 实际挂载 `546` 个，缺失为 `0`，并在恢复 `100%` 后收敛回 `233` 个。小尺寸 `mbar` 保持单行，顶部单字符也完整显示。

同一唯一键绑定临时副本的上一版预览性能基线（非当前终验）如下：原始尺寸预览稳态采样 `34.6s`，帧间隔 P95 为 `14.2ms`、Long Task 为 `0`，598 个运行值可见且抽样 `40/40` 随刷新变化；自适应预览采样 `43.3s`，P95 为 `14.1ms`、Long Task 为 `0`，提交的 `2560 × 723` Canvas 非白屏且像素哈希随运行值刷新变化；浏览器原生全屏稳态采样 `39.9s`，P95 为 `14.2ms`、Long Task 为 `0`，`document.fullscreenElement` 确认为 `preview-overlay`，运行值抽样 `40/40` 变化且控制台无错误。原生全屏入口仍使用 Fullscreen API；浏览器自身切换导航界面的动画和 rAF 暂停不计入应用进入后的稳态 P95。这些数字不能替代当前交接契约终验：自适应模式须分别覆盖纯 Canvas、有界图层尾段 DOM 覆盖、请求像素比门禁、正常等待期间的视口 DOM，以及无法在 `24` 条内覆盖 live 节点、超过 `16/128` 门禁或 Canvas 失败时的完整 DOM 回退；失败路径必须先显示原尺寸 DOM，完整挂载后再切换 `dom-fit`。原始尺寸和全屏须确认 fit/bootstrap surface 在 DOM ready 后释放，并在带缓冲视口超过 `1,024` 条连线时确认独立 edge-only Canvas 清晰、滚动覆盖连续、实体不截断、SVG 不重复且故障后完整回退。约 `31.9%` 比例时约有 `1,700` 个节点同时进入视口，DOM、SVG、文字和动画成本本来就更高；旧基准表明空间查询和滚轮逐帧全局响应式更新已不再是当时的主要瓶颈，但当前结论仍须以本轮浏览器终验为准。超大图纸字符串当前已由 `projectJson.worker.js` 解析并保留主线程故障降级，首次 Vue 代理与可见节点挂载、单屏复杂度和动画数量仍需按目标设备观察。

2026-08-03 本轮受控浏览器又在 `1280 × 720`、`devicePixelRatio = 1.5` 下复核 `__qa_dense_edges_20000`（`2000 × 1200`、20,000 条重叠连线）：100% 编辑画布非空且网格、节点和连线边界清楚，目录双击新增矩形与文本后均能立即进入编辑链路，逐步 Undo 后恢复原 2 个节点。原始尺寸预览完成后保留 2 个节点 DOM，连线只由 `2914 × 1694` 的 edge-only Canvas 接管，SVG 连线为 0；切换自适应预览在同一次浏览器操作中 `1.869s` 完成纯 Canvas 交接，稳定 backing 为 `2234 × 1340`、CSS 尺寸约 `1116.67 × 670`，实际约 `2x` 像素比高于请求 DPR，且无重复可见节点、控制台错误或警告。该结果验证本轮高密连线交接、清晰度与可撤销新增的浏览器冒烟，不替代 6,016 点位持续挂数、四种交互场景和目标工控机上的长时间帧率/内存终验。

当前交付数量以上述 2026-08-03 完整复跑为准。后续每轮仍必须顺序执行 `npm run test:stability`、`npm run test:performance`、`npm run build`、`npm audit --offline` 和 `npm ls --depth=0`，并以当日完整输出替换基线；测试数量和构建模块数会随新增回归变化，任何更早的历史计数都不能当作当前版本结论。

上线前应使用目标工控机和真实图纸做性能验收。建议指标：

| 场景 | 观察项 |
| --- | --- |
| 持续拖动节点 30 秒 | 主线程帧率、长任务、指针延迟 |
| 快速滚动画布 | DOM 节点数、内存是否持续增长 |
| 连续快速向外缩放 | 投影视口应显示节点与实际挂载 ID 一致、手势内临时范围只扩不缩、停止后节点数收敛 |
| 在 10,000 个稀疏节点中滚动和框选 | 空间索引候选数、查询耗时、框选结果与全量扫描是否一致 |
| 在 10,000 个节点中新增、删除并连续撤销重做 | 历史条目大小、未受影响对象引用、实体顺序、关联连线和空间索引是否正确 |
| 在数千图层中打开并滚动“结构”面板 | 实际挂载行数、首次打开耗时、滚动是否错行、选择是否正确 |
| 持续刷新数千数据键时选择、拖动、连线和新增组件 | 帧间隔、Long Task、最终值收敛、操作对象是否立即响应 |
| 滚动 50 × 12 固定行高及自动换行表格 | 首屏/右下角挂载单元格数、末行末列、动态行高底部锚定、合并区域 |
| 批量推送数据 10 分钟 | 每秒消息量、Vue 刷新次数、堆内存 |
| 在编辑和预览中启用动画 | CPU、GPU、动画掉帧 |
| 单屏显示 1、10、50 个视频并连续切换选择 | 选择延迟、媒体请求数、解码内存、是否重复 `loadstart` |
| 图纸 API 单图读写上限 | 使用较小的 `TC2D_MAX_DRAWING_BYTES` 测试值覆盖磁盘 stat 预读、列表忽略、直接打开 `413`、保存冲突校验、删除读取，以及 `Content-Length` 预检、chunked 累计、等于上限成功、超限 `413`、压缩体拒绝和单缓冲读取；另验证低于配置上限且大于 20MB 的合法图纸保存和重开 |
| 多工作空间恢复 | 至少 4 个工作空间往返，确认完整多图会话来自 IndexedDB；最新保存失败或并发旧保存迟到时，脏工作空间不得被 LRU 淘汰 |
| 大会话后台持久化 | 用正式 6,016 节点图纸验证 `64KiB` Blob chunks、默认 `4ms`/长字符串 `4KiB` 切片、输入优先让步、小 envelope clone、旧 object 与 customHandle 往返；编码中变脏或 store 关闭时不得调用 `put` |
| 大图纸解析与准备 | Worker 完成解析、结构/容量校验、迁移、归一化和有界分块回传；成功、不可用、创建/发送失败、运行崩溃、协议错误和消息错误均应结算请求，降级结果与同一 `parseAndPrepare` 主线程操作一致；主线程运行 bundle 按默认 `4ms` 私有分片建立，旧任务可取消，完成前不替换任一活动集合或索引 |
| 图纸列表缓存 | 未变化的合法文件命中 metadata/ETag 缓存；确定性 `422` 命中负缓存，stat 改变后重新校验，临时错误不进入负缓存 |
| 10 个独立浏览器上下文持续 10 分钟 | 工作空间串数据、未捕获异常、内存增长和保存冲突 |
| 同一图纸两个标签页交错保存 | 旧修订是否被阻止，不能静默覆盖 |

可生成可重复的压力图纸：

```bash
npm run generate:stress -- 2000
npm run generate:stress -- 10000
```

命令会在项目根目录生成 `stress-project.json`，通过顶部“打开”或“打开其他位置”加载。更改最后的数字即可测试不同规模；脚本最多生成 10,000 个节点。测试时同时记录图纸总节点数、当前屏幕可见节点数、空间索引候选数、数据更新频率和设备型号。

`scripts/editor-performance.test.mjs` 使用 10,000 个稀疏节点校验空间查询与全量扫描结果一致，并覆盖持久节点 Map、滚轮瞬时合成、渲染键缓存、差异历史、双游标层级、增量索引、稳定预览批次和结构面板窗口化；大型实体用例验证 2,000 节点/4,000 连线的单区间移除恢复、引用身份和索引往返。`scripts/entity-history-benchmark.mjs` 只读正式图纸并输出前 2,000 节点 Undo/Redo 的分阶段和 10 轮 P95。`scripts/document-indexes.test.mjs` 对 10,000 节点层级预留、`dataKey` 反向索引及 9,999 连线后的增量邻接更新做独立回归。

`scripts/runtime-update-pipeline.test.mjs` 覆盖 `2ms` 分片、公平轮转、重叠批次与尾部热键 latest-wins、未知 iterable 背压、总 pending/批次/键值上限、sink 异常重试和 stop/reconnect generation；`scripts/runtime-data.test.mjs` 覆盖 6,016 键首帧优先、`2ms` 时间/数量预算、未激活过滤和激活世代隔离；`scripts/runtime-value-format.test.mjs` 覆盖长度、深度、键数、条目数、循环和异常代理边界。`scripts/performance-acceptance.test.mjs` 把“6,016 键两批只通知最终值”、未激活大批不产生工作、视口订阅释放、监听器异常隔离和性能探针有界样本作为门槛。`scripts/project-json-parser.test.mjs`、`scripts/workspace-session-store.test.mjs`、`scripts/workspace-session-cache.test.mjs`、`scripts/cancellable-idle-task.test.mjs`、`scripts/async-operation-barrier.test.mjs` 与 `scripts/app-state-boundaries.test.mjs` 覆盖 Worker 及卸载降级、`64KiB` Blob/`4ms` 增量会话编码、旧记录和句柄往返、IndexedDB 故障、编码与 put freshness、保存版本门禁、脏会话 LRU、idle 回调取消/重排/迟到拒绝/timer 降级、自动持久化忙碌门禁、组件包/媒体异步操作结算、生命周期失效和覆盖层快捷键边界；图纸库、后台和 polyline 测试覆盖 256 MiB 可配置请求门禁、metadata 正/负缓存及前后端共享结构容量。`scripts/interaction-commit-barrier.test.mjs` 覆盖活动交互代次、干净恢复帧、key 合并重试和组件包/索引压实接线；`scripts/large-selection-transform.test.mjs` 覆盖 Worker 算法等价与 `2ms` 降级；`scripts/preview-bitmap-budget.test.mjs` 覆盖实际 DPR、活动 `8,388,608` 与 bootstrap `4,194,304` 像素上限。`scripts/editor-lod.test.mjs`、`scripts/minimap-rendering.test.mjs`、`scripts/chunked-render-scheduler.test.mjs` 与 `scripts/preview-handoff.test.mjs` 覆盖 LOD 几何局部合成、长连线/线稿分段索引、完整视口 DOM、自适应静态 Canvas/有界 DOM 尾段/完整 DOM 回退、`24` 条扫描窗与 `16/128` hybrid 预算、静态 node/drawing 随尾段提升、`renderPlanKey + excludedNodeIds + excludedDrawingIds` 原子提交、持久 live plane、图片成功事件按帧合并、隐藏 fit surface 暂停、`render-error` 回退接线、committed plan 释放、全屏状态补偿校准、文档/请求/提交世代新鲜度、部分运行帧不得越权交接、按节点复杂度控制预览挂载批次、运行脏区累加分片、时间局部刷新、世代取消和资源释放；`scripts/canvas-context-gate.test.mjs` 验证 context token 在丢失、恢复、目标替换和 release 后拒绝迟到提交，并覆盖坏 surface 不进入或重新进入复用池。真实浏览器触发 `contextlost` 后 DOM 非空回退、恢复重绘及关闭/卸载时的晚到事件仍属于组件级浏览器验收，不能用纯状态测试代替。`scripts/table-rendering.test.mjs` 覆盖表格虚拟化阈值、窗口到达末行末列、跨窗口合并原点和完整单元格集合。

`scripts/preview-handoff.test.mjs` 还必须锁定 `ProgressivePreviewGeometry` 的首批 `64/8`、最多 `4` 倍自适应、稳定不可变批次、世代取消、保留批次最新引用、edges/drawings 完整计数，以及 `previewDomNodesReady && previewDomGeometryReady` 加预览存活/挂载/目标门禁的联合交接；关闭预览推进 generation 后必须拒绝迟到完成事件。原始尺寸 edge Canvas 则锁定请求 DPR 已进入 plan key、提交前 active/plan/bounds/DPR guard、committed bounds/plan/DPR/视口覆盖可见门禁、旧帧不清 ready，以及当前低 DPR 请求的完整 SVG fallback。源码测试只防止接线回退，真实提交耗时、SVG 完整性和清晰度仍按上面的浏览器验收执行。

`scripts/project-runtime-preparation.test.mjs` 单独覆盖完整私有运行 bundle 的多片推进、响应式实体与各索引一致性、被新文档取代时取消、调度不可用降级和完成后原子交接；该测试与 `scripts/project-json-parser.test.mjs` 的 Worker/分块协议回归互补，不能只验证其中一段就把大图打开链路视为完整。`scripts/edge-raster-worker.test.mjs` 另行覆盖 typed-array 协议与逐边调用序列等价、调用后恢复原 `lineCap`、transfer list、批次握手、latest-wins、迟到位图关闭、故障回退和 MiniMap 门槛接线；它不替代 20,000 条连线首次自适应预览的真实浏览器 Long Task 与像素一致性验收。

提交前必须依次运行 `npm run test:performance`、`npm run test:stability` 和 `npm run build`。`test:stability` 固定使用 `--test-concurrency=1` 顺序执行测试文件，避免多个性能用例争抢同一 CPU 后把调度噪声误判为产品退化；该隔离不改变或放宽任何用例内的性能门槛。构建前置 `cleanBuildOutputPlugin()` 在 Vite `configResolved` 后只解析一次 outDir，清理前同时以项目根目录相对路径和最近现存祖先的 `realpath` 拒绝根目录本身、越界路径及符号链接逃逸，然后删除旧输出；Vite 自身的 `build.emptyOutDir: true` 继续作为第二道清理。`scripts/backend-services.test.mjs` 固定这些边界和插件顺序。测试数量和构建模块数会随功能增加而变化，以命令当次完整输出为准，不在此维护容易过期的固定计数。自动化用于防止实现退化，不替代目标工控机上的浏览器帧率和内存验收；`scripts/drawing-library.test.mjs` 另覆盖大于 20MB 图纸的保存、列表和重新读取。

低倍率编辑和自适应整图预览已经把静态内容合并到 Canvas；原始尺寸编辑、原始尺寸预览和全屏预览仍以视口虚拟化 DOM 保留完整节点与交互，只有超过 `1,024` 条的视口连线会转入独立 edge-only Canvas。若目标屏幕在原始倍率下本身同时容纳数千个视频、复杂表格或独立动画，瓶颈会转为媒体解码、布局和动画合成，仍需按目标设备降低单屏复杂度或增加专用 WebGL/媒体策略，不能只根据图纸总节点数承诺帧率。

服务端并发验收还应记录在线客户端数、每客户端图纸规模、消息频率、接口 p95/p99、错误率和数据库锁等待。账号级隔离、接口乐观锁和实时消息路由要求见 `docs/多人使用与数据隔离.md`。
