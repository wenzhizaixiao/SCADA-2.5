import {
  Activity, ArrowRight, BarChart3, Box, ChartNoAxesColumnIncreasing, Circle, CircleDot, Clock3, Cloud, Code2,
  Database, DatabaseZap, Diamond, Droplets, Fan, Gauge, GitBranch, HardDrive, Hexagon, Image, ListFilter,
  LineChart, Map as MapIcon, Minus, MousePointer2, MousePointerClick, MoveRight, Network, Pencil, PieChart, Radar,
  RadioTower, Router, ScatterChart, Server, Sparkles, Square, SquareCheckBig, Star, TableProperties, TextCursorInput, ToggleLeft, Triangle, Type,
  TriangleAlert, Video, Waves
} from 'lucide-vue-next'

// 组件入口、显示名称和新建默认值集中维护，避免页面模板与创建逻辑各留一份配置。
export const EDITOR_TOOLS = [
  { id: 'select', label: '选择', icon: MousePointer2 },
  { id: 'pencil', label: '铅笔', icon: Pencil },
  { id: 'map', label: '鹰眼地图', icon: MapIcon },
  { id: 'line', label: '连线', icon: GitBranch }
]

// 工作空间功能与画图工具分组显示，避免把数据源误认为画布操作模式。
export const WORKSPACE_TOOLS = [
  { id: 'dataSource', label: '数据源', icon: DatabaseZap }
]

const COMPONENT_GROUPS = [
  { name: '基本形状', open: true, items: [
    { type: 'rect', name: '矩形', icon: Square }, { type: 'circle', name: '圆形', icon: Circle },
    { type: 'triangle', name: '三角形', icon: Triangle }, { type: 'diamond', name: '菱形', icon: Diamond },
    { type: 'star', name: '星形', icon: Star }, { type: 'hexagon', name: '六边形', icon: Hexagon },
    { type: 'arrow', name: '箭头', icon: ArrowRight }, { type: 'lineShape', name: '直线', icon: Minus },
    { type: 'text', name: '文本', icon: Type }, { type: 'image', name: '图片', icon: Image },
    { type: 'video', name: '视频播放', icon: Video }
  ]},
  { name: '线段组件', open: true, items: [
    { type: 'polyline', name: '线段', icon: GitBranch }
  ]},
  { name: '功能组件', open: false, items: [
    { type: 'table', name: '表格', icon: TableProperties }, { type: 'checkbox', name: '复选框', icon: SquareCheckBig },
    { type: 'radio', name: '单选框', icon: CircleDot }, { type: 'switch', name: '开关', icon: ToggleLeft },
    { type: 'formProgress', name: '进度条', icon: ChartNoAxesColumnIncreasing }, { type: 'button', name: '按钮', icon: MousePointerClick },
    { type: 'input', name: '输入框', icon: TextCursorInput }, { type: 'select', name: '选择器', icon: ListFilter },
    { type: 'time', name: '时间', icon: Clock3 }
  ]},
  { name: '图表组件', open: false, items: [
    { type: 'lineChart', name: '折线图', icon: LineChart }, { type: 'barChart', name: '柱状图', icon: BarChart3 },
    { type: 'pieChart', name: '饼图', icon: PieChart }, { type: 'scatterChart', name: '散点图', icon: ScatterChart },
    { type: 'radarChart', name: '雷达图', icon: Radar }, { type: 'echartsCode', name: 'ECharts 代码', icon: Code2 }
  ]},
  { name: '动效组件', open: true, items: [
    { type: 'flowDirection', name: '流向', icon: MoveRight }, { type: 'flowPipe', name: '流动管道', icon: MoveRight }, { type: 'rotatingFan', name: '旋转风机', icon: Fan },
    { type: 'signalLight', name: '信号灯', icon: RadioTower }, { type: 'waterTank', name: '动态水箱', icon: Droplets },
    { type: 'heartbeat', name: '告警', icon: TriangleAlert }, { type: 'particles', name: '粒子流', icon: Waves }
  ]},
  { name: '自定义动效', open: true, items: [
    { type: 'customMotion', name: '自定义图形', icon: Sparkles }, { type: 'customTextMotion', name: '动态文字', icon: Type },
    { type: 'customImageMotion', name: '动态图片', icon: Image }, { type: 'customIndicator', name: '自定义指示器', icon: Activity }
  ]},
  { name: '网络与云', open: false, items: [
    { type: 'cloud', name: '云服务', icon: Cloud }, { type: 'network', name: '网络节点', icon: Network }
  ]},
  { name: '工业设备', open: false, items: [
    { type: 'gauge', name: '仪表盘', icon: Gauge }, { type: 'server', name: '服务器', icon: Server },
    { type: 'disk', name: '存储器', icon: HardDrive }, { type: 'router', name: '路由器', icon: Router }
  ]},
  { name: '流程图组件', open: false, items: [
    { type: 'process', name: '流程', icon: Box }, { type: 'decision', name: '判断', icon: GitBranch },
    { type: 'terminal', name: '开始/结束', icon: Minus }, { type: 'database', name: '数据库', icon: Database }
  ]}
]

// 展开状态属于编辑器会话，返回副本可避免多个编辑器实例互相修改目录配置。
export function createComponentGroups() {
  return COMPONENT_GROUPS.map(group => ({ ...group, items: [...group.items] }))
}

export const COMPONENT_CATEGORY_BY_TYPE = new Map()
export const COMPONENT_NAME_BY_TYPE = new Map()
for (const group of COMPONENT_GROUPS) {
  for (const item of group.items) {
    COMPONENT_CATEGORY_BY_TYPE.set(item.type, group.name)
    COMPONENT_NAME_BY_TYPE.set(item.type, item.name)
  }
}

// 旧图纸仍需名称和属性分类，但兼容类型不再出现在组件目录中。
const HIDDEN_COMPATIBILITY_COMPONENTS = Object.freeze([
  Object.freeze({ type: 'chart', name: '柱状图（旧版）', category: '图表组件' }),
  Object.freeze({ type: 'progress', name: '进度条（旧版）', category: '图表组件' }),
  Object.freeze({ type: 'code', name: '代码块（旧版）', category: '图表组件' })
])
for (const item of HIDDEN_COMPATIBILITY_COMPONENTS) {
  COMPONENT_CATEGORY_BY_TYPE.set(item.type, item.category)
  COMPONENT_NAME_BY_TYPE.set(item.type, item.name)
}

export const FORM_TYPE_IDS = new Set(['table', 'checkbox', 'radio', 'switch', 'formProgress', 'button', 'input', 'select', 'time'])

export const DEFAULT_RUNTIME_DATA_TYPES = new Set([
  'chart', 'lineChart', 'barChart', 'pieChart', 'scatterChart', 'radarChart',
  'gauge', 'cloud', 'network', 'server', 'router',
  'flowDirection', 'flowPipe', 'rotatingFan', 'signalLight', 'waterTank', 'heartbeat', 'particles'
])

// 元组依次为默认文字、宽度和高度；新增组件类型时必须同时加入上方目录。
export const SHAPE_DEFAULTS = {
  rect: ['矩形', 140, 72], circle: ['圆形', 90, 90], triangle: ['三角形', 110, 96], diamond: ['菱形', 110, 90],
  star: ['星形', 105, 100], hexagon: ['六边形', 120, 88], arrow: ['箭头', 140, 64], lineShape: ['', 150, 8], polyline: ['线段', 180, 100], pencil: ['铅笔线稿', 120, 80],
  text: ['双击编辑文本', 160, 50], image: ['图片', 150, 100], video: ['视频播放', 240, 135], table: ['数据表格', 720, 380], checkbox: ['复选框', 130, 38],
  radio: ['单选框', 130, 38], switch: ['开关', 130, 40], formProgress: ['进度条', 190, 44], button: ['按钮', 120, 42],
  input: ['输入框', 190, 42], select: ['选择器', 190, 42], time: ['时间', 160, 42], process: ['处理流程', 150, 72], decision: ['条件判断', 118, 90],
  terminal: ['开始 / 结束', 150, 64], database: ['数据库', 115, 95], gauge: ['仪表盘', 120, 120], server: ['服务器', 120, 90],
  disk: ['存储器', 120, 85], router: ['路由器', 130, 80],
  lineChart: ['折线图', 320, 220], barChart: ['柱状图', 320, 220], pieChart: ['饼图', 320, 220],
  scatterChart: ['散点图', 320, 220], radarChart: ['雷达图', 320, 220], echartsCode: ['ECharts 代码', 400, 300],
  chart: ['数据图表', 180, 110], progress: ['68%', 180, 45], code: ['function main() {}', 190, 90],
  cloud: ['云服务', 140, 80], network: ['网络节点', 140, 74],
  flowDirection: ['流向', 220, 130], flowPipe: ['介质流动', 190, 48], rotatingFan: ['风机', 110, 110], signalLight: ['运行状态', 90, 130],
  waterTank: ['液位', 120, 150], heartbeat: ['告警', 110, 100], particles: ['粒子流', 180, 90],
  customMotion: ['自定义图形', 150, 100], customTextMotion: ['动态文字', 180, 70],
  customImageMotion: ['动态图片', 170, 110], customIndicator: ['状态指示', 140, 90]
}

export const FORM_NODE_DEFAULTS = {
  table: {
    fill: '#ffffff', stroke: '#ebeef5', color: '#606266', radius: 0, options: '日期,姓名,省份,市区,地址', formName: 'table',
    tableRows: 7, tableColumns: 5, tableData: '', tableHeaders: ['日期', '姓名', '省份', '市区', '地址'],
    tableCells: [
      ['2016-05-03', '王小虎', '上海', '普陀区', '上海市普陀区金沙江路 1518 弄'],
      ['2016-05-02', '王小虎', '上海', '普陀区', '上海市普陀区金沙江路 1518 弄'],
      ['2016-05-04', '王小虎', '上海', '普陀区', '上海市普陀区金沙江路 1518 弄'],
      ['2016-05-01', '王小虎', '上海', '普陀区', '上海市普陀区金沙江路 1518 弄'],
      ['2016-05-08', '王小虎', '上海', '普陀区', '上海市普陀区金沙江路 1518 弄'],
      ['2016-05-06', '王小虎', '上海', '普陀区', '上海市普陀区金沙江路 1518 弄'],
      ['2016-05-07', '王小虎', '上海', '普陀区', '上海市普陀区金沙江路 1518 弄']
    ],
    tableColumnWidths: [1.25, 1, 1, 1, 2.6], tableColumnWidthsPx: [130, 105, 105, 105, 273], tableTitle: '配送信息', tableTitleFill: '#f5f7fa', tableTitleColor: '#909399', tableTitleAlign: 'center',
    tableHeaderFill: '#f5f7fa', tableHeaderColor: '#909399', tableHeaderAlign: 'left', tableRowFill: '#ffffff', tableAltRowFill: '#ffffff', tableCellColor: '#606266',
    tableGridColor: '#ebeef5', tableGridStyle: 'solid', tableBorderColor: '#ebeef5', tableHeaderHeight: 40, tableRowHeight: 40, tableTextAlign: 'left'
  },
  checkbox: { fill: '#16b89a', stroke: '#9aa5ac', color: '#26323d', radius: 3, formName: 'checkbox', checkedValue: '已选中', uncheckedValue: '未选中' },
  radio: { fill: '#16b89a', stroke: '#9aa5ac', color: '#26323d', radius: 50, formName: 'radio', checkedValue: '选中项', uncheckedValue: '' },
  switch: { fill: '#16b89a', stroke: '#bcc4c8', color: '#26323d', radius: 12, formName: 'switch', checkedValue: '开启', uncheckedValue: '关闭' },
  formProgress: { fill: '#16b89a', stroke: '#dfe5e8', color: '#26323d', radius: 4, formName: 'progress' },
  button: { fill: '#168eea', stroke: '#168eea', color: '#ffffff', radius: 4, formName: 'button' },
  input: { fill: '#ffffff', stroke: '#cfd6da', color: '#26323d', radius: 4, placeholder: '请输入内容', formName: 'input' },
  select: { fill: '#ffffff', stroke: '#cfd6da', color: '#26323d', radius: 4, value: 'option1', formName: 'select' },
  time: { fill: '#ffffff', stroke: '#cfd6da', color: '#26323d', radius: 4, value: '09:30:00', formName: 'time' }
}

export const ANIMATION_DEFAULTS = {
  flowDirection: 'flow', flowPipe: 'flow', rotatingFan: 'flow', signalLight: 'blink', waterTank: 'flow', heartbeat: 'pulse', particles: 'flow'
}
