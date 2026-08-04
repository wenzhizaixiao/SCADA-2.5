# 数据源 JSON 绑定实施计划

## 目标

在正式 `tc2d` 项目中完成“数据源统一管理、组件属性按 JSONPath 取值、源级共享请求与高性能运行时更新”，同时兼容旧图纸中的 `pointId` 绑定。

## 实施步骤

1. **绑定模型与兼容**
   - 修改 `src/models/dataBindingModel.js`，支持 `{ target, sourceId, jsonPath, adapter, enabled }`，并保留旧 `{ target, pointId }`。
   - 修改 `src/utils/projectValidation.js`、`src/models/editorModel.js` 相关规范化链路，确保保存、打开、复制和自定义组件不丢失新绑定。
   - 使用稳定派生键连接现有运行时存储，避免在组件渲染阶段解析 JSON。

2. **数据源快照**
   - 修改 `src/services/pointCatalogGateway.js`，增加结构化快照读取、写入和订阅接口。
   - 快照只驻留运行内存，配置继续按工作空间保存；凭据和大响应不写入图纸 JSON。
   - 精简 `src/components/DataSourceManager.vue`，只管理连接、协议配置、启停、测试、保存和删除。

3. **安全 JSONPath 与派生运行时**
   - 新增 `src/utils/jsonPathBinding.js`，只支持根、对象键和数组索引，不执行用户 JavaScript。
   - 新增 `src/services/sourceBindingRuntime.js`，按 `sourceId -> 唯一路径` 建索引并缓存编译结果。
   - 高频快照只保留最新版本，同一路径每个版本只解析一次，更新通过现有帧合并管线提交。

4. **通信面板**
   - 修改 `src/components/CommunicationBindingPanel.vue`，操作顺序为“选择属性 -> 选择数据源 -> 点选 JSON 字段/输入路径 -> 预览 -> 应用”。
   - JSON 树按需展开，限制单层和总可见节点；类型不兼容或路径失效时禁止应用并显示原因。

5. **应用接线**
   - 修改 `src/App.vue`，用数据源快照驱动派生运行值；绑定增删、节点增删和图纸切换都增量同步索引。
   - `NodeVisual.vue`、`MiniMapPreview.vue` 和运行时物化继续读取稳定运行键，保持编辑、预览和鹰眼一致。
   - 工作空间切换后重新装载所需数据源的最新快照；删除数据源时绑定保留但回退静态属性值。

6. **验证**
   - 补充 JSONPath、绑定规范化、旧图纸兼容、同源同路径去重、最新快照覆盖和高扇出测试。
   - 运行 `npm run test:stability`、`npm run test:performance`、`npm run build`。
   - 启动开发服务，通过浏览器验证连接管理、绑定、保存重开、编辑画布和预览。

## 性能验收原则

- 一个数据源只有一个采集入口，组件不单独发请求。
- 数据源更新不扫描全画布，只处理该源已登记的唯一路径。
- 大 JSON 不进入 Vue 深响应式状态；树按需展开，表格结果必须分页或限量。
- 同一帧内节点更新合并提交，旧快照与中间高频消息可丢弃，最终值不能丢失。
