import { parse as parseJavaScript } from 'acorn'

export const DEFAULT_ECHARTS_CODE_LIMITS = Object.freeze({
  maxSourceLength: 200_000,
  maxAstNodes: 30_000,
  maxAstDepth: 128,
  maxValueDepth: 64,
  maxObjectProperties: 5_000,
  maxArrayItems: 20_000,
  maxStringLength: 200_000,
  maxOutputLength: 1_000_000
})

const HARD_LIMITS = Object.freeze({
  maxSourceLength: 1_000_000,
  maxAstNodes: 120_000,
  maxAstDepth: 256,
  maxValueDepth: 96,
  maxObjectProperties: 20_000,
  maxArrayItems: 80_000,
  maxStringLength: 1_000_000,
  maxOutputLength: 4_000_000
})

const UNSAFE_KEYS = new Set(['__proto__', 'prototype', 'constructor'])
const FUNCTION_NODE_TYPES = new Set([
  'ArrowFunctionExpression',
  'FunctionDeclaration',
  'FunctionExpression'
])

function locationOf(value) {
  const location = value?.loc?.start || value?.loc || null
  return {
    line: Number.isInteger(location?.line) ? location.line : 0,
    column: Number.isInteger(location?.column) ? location.column + 1 : 0
  }
}

function withLocation(message, line, column) {
  return line > 0 ? `${message}（第 ${line} 行，第 ${column || 1} 列）` : message
}

export class EChartsCodeParseError extends Error {
  constructor(code, message, location, cause) {
    const { line, column } = locationOf(location)
    super(withLocation(message, line, column), cause ? { cause } : undefined)
    this.name = 'EChartsCodeParseError'
    this.code = code
    this.line = line
    this.column = column
  }
}

function fail(code, message, node, cause) {
  throw new EChartsCodeParseError(code, message, node, cause)
}

function normalizedLimits(options = {}) {
  const configured = options?.limits && typeof options.limits === 'object' ? options.limits : options
  const result = {}
  for (const [key, fallback] of Object.entries(DEFAULT_ECHARTS_CODE_LIMITS)) {
    const number = Math.floor(Number(configured?.[key]))
    result[key] = Number.isFinite(number) && number > 0
      ? Math.min(HARD_LIMITS[key], number)
      : fallback
  }
  return result
}

function parseProgram(source) {
  try {
    return parseJavaScript(source, {
      ecmaVersion: 'latest',
      sourceType: 'module',
      allowHashBang: true,
      locations: true
    })
  } catch (error) {
    throw new EChartsCodeParseError('SYNTAX_ERROR', `JavaScript 语法错误：${error.message}`, error, error)
  }
}

function validateAstBudget(program, limits) {
  const stack = [{ node: program, depth: 0 }]
  let count = 0
  while (stack.length) {
    const { node, depth } = stack.pop()
    count += 1
    if (count > limits.maxAstNodes) {
      fail('AST_NODE_LIMIT', `示例代码结构过大，最多允许 ${limits.maxAstNodes} 个语法节点`, node)
    }
    if (depth > limits.maxAstDepth) {
      fail('AST_DEPTH_LIMIT', `示例代码嵌套过深，最多允许 ${limits.maxAstDepth} 层`, node)
    }
    for (const [key, value] of Object.entries(node)) {
      if (['loc', 'start', 'end', 'range'].includes(key) || !value) continue
      if (Array.isArray(value)) {
        for (let index = value.length - 1; index >= 0; index -= 1) {
          const child = value[index]
          if (child && typeof child.type === 'string') stack.push({ node: child, depth: depth + 1 })
        }
      } else if (typeof value.type === 'string') {
        stack.push({ node: value, depth: depth + 1 })
      }
    }
  }
}

function plainRecord(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  try {
    const prototype = Object.getPrototypeOf(value)
    return prototype === Object.prototype || prototype === null
  } catch {
    return false
  }
}

function safePropertyKey(key, node) {
  const normalized = String(key)
  if (UNSAFE_KEYS.has(normalized)) fail('UNSAFE_PROPERTY', `option 不允许属性 ${normalized}`, node)
  return normalized
}

function countObjectProperty(context, node, amount = 1) {
  context.objectProperties += amount
  if (context.objectProperties > context.limits.maxObjectProperties) {
    fail(
      'OBJECT_PROPERTY_LIMIT',
      `option 最多允许 ${context.limits.maxObjectProperties} 个对象属性`,
      node
    )
  }
}

function countArrayItem(context, node, amount = 1) {
  context.arrayItems += amount
  if (context.arrayItems > context.limits.maxArrayItems) {
    fail('ARRAY_ITEM_LIMIT', `option 最多允许 ${context.limits.maxArrayItems} 个数组项`, node)
  }
}

function assertValueDepth(context, node, depth) {
  if (depth > context.limits.maxValueDepth) {
    fail('VALUE_DEPTH_LIMIT', `option 最多允许 ${context.limits.maxValueDepth} 层嵌套`, node)
  }
}

function staticString(value, context, node) {
  if (value.length > context.limits.maxStringLength) {
    fail('STRING_LENGTH_LIMIT', `单个字符串最多允许 ${context.limits.maxStringLength} 个字符`, node)
  }
  return value
}

function identifierValue(node, context) {
  const record = context.environment.get(node.name)
  if (!record) fail('UNKNOWN_IDENTIFIER', `option 引用了未定义的静态变量 ${node.name}`, node)
  if (!record.resolved) {
    if (record.error instanceof EChartsCodeParseError) throw record.error
    fail('DYNAMIC_IDENTIFIER', `变量 ${node.name} 不是可静态提取的数据`, node, record.error)
  }
  if (record.value && typeof record.value === 'object' && context.taintedValues.has(record.value)) {
    fail('DYNAMIC_MUTATION', `变量 ${node.name} 被动态修改，无法静态提取最终值`, node)
  }
  return record.value
}

function propertyName(property, context, depth) {
  if (!property.computed) {
    if (property.key.type === 'Identifier') return safePropertyKey(property.key.name, property.key)
    if (property.key.type === 'Literal') return safePropertyKey(property.key.value, property.key)
    fail('UNSUPPORTED_PROPERTY_KEY', 'option 属性名必须是静态标识符、文本或数值', property.key)
  }
  const key = evaluateStatic(property.key, context, depth + 1)
  if (!['string', 'number'].includes(typeof key)) {
    fail('UNSUPPORTED_PROPERTY_KEY', 'option 的计算属性名必须是静态文本或数值', property.key)
  }
  return safePropertyKey(key, property.key)
}

function evaluateObject(node, context, depth) {
  const result = Object.create(null)
  for (const property of node.properties) {
    if (property.type === 'SpreadElement') {
      const spread = evaluateStatic(property.argument, context, depth + 1)
      if (!plainRecord(spread)) fail('INVALID_OBJECT_SPREAD', '对象展开只能引用静态对象', property)
      const keys = Object.keys(spread)
      countObjectProperty(context, property, keys.length)
      for (const key of keys) result[safePropertyKey(key, property)] = spread[key]
      continue
    }
    if (property.type !== 'Property' || property.kind !== 'init' || property.method) {
      fail('UNSUPPORTED_OBJECT_MEMBER', 'option 不支持方法、getter 或 setter', property)
    }
    const key = propertyName(property, context, depth)
    countObjectProperty(context, property)
    result[key] = evaluateStatic(property.value, context, depth + 1)
  }
  return result
}

function evaluateArray(node, context, depth) {
  const result = []
  for (const item of node.elements) {
    if (!item) fail('ARRAY_HOLE', 'option 数组不支持空项，请明确填写 null', node)
    if (item.type === 'SpreadElement') {
      const spread = evaluateStatic(item.argument, context, depth + 1)
      if (!Array.isArray(spread)) fail('INVALID_ARRAY_SPREAD', '数组展开只能引用静态数组', item)
      countArrayItem(context, item, spread.length)
      result.push(...spread)
      continue
    }
    countArrayItem(context, item)
    result.push(evaluateStatic(item, context, depth + 1))
  }
  return result
}

function finiteNumericResult(value, node) {
  if (!Number.isFinite(value)) fail('NON_FINITE_NUMBER', 'option 中的数值计算结果必须是有限数', node)
  return value
}

function evaluateBinary(node, context, depth) {
  const left = evaluateStatic(node.left, context, depth + 1)
  const right = evaluateStatic(node.right, context, depth + 1)
  switch (node.operator) {
    case '+': {
      if (!['string', 'number'].includes(typeof left) || !['string', 'number'].includes(typeof right)) {
        fail('UNSUPPORTED_BINARY', '加法只支持静态文本或数值', node)
      }
      const value = left + right
      return typeof value === 'string' ? staticString(value, context, node) : finiteNumericResult(value, node)
    }
    case '-': return finiteNumericResult(Number(left) - Number(right), node)
    case '*': return finiteNumericResult(Number(left) * Number(right), node)
    case '/': return finiteNumericResult(Number(left) / Number(right), node)
    case '%': return finiteNumericResult(Number(left) % Number(right), node)
    case '**': return finiteNumericResult(Number(left) ** Number(right), node)
    case '<': return left < right
    case '<=': return left <= right
    case '>': return left > right
    case '>=': return left >= right
    case '===': return left === right
    case '!==': return left !== right
    default: fail('UNSUPPORTED_BINARY', `option 不支持运算符 ${node.operator}`, node)
  }
}

function evaluateMember(node, context, depth) {
  const owner = evaluateStatic(node.object, context, depth + 1)
  if ((typeof owner !== 'object' && typeof owner !== 'string') || owner === null) {
    fail('INVALID_MEMBER_ACCESS', '静态属性访问的目标必须是对象、数组或文本', node)
  }
  const key = node.computed
    ? evaluateStatic(node.property, context, depth + 1)
    : node.property.name
  if (!['string', 'number'].includes(typeof key)) {
    fail('INVALID_MEMBER_ACCESS', '静态属性访问只支持文本或数值下标', node.property)
  }
  const normalizedKey = safePropertyKey(key, node.property)
  if (!Object.prototype.hasOwnProperty.call(owner, normalizedKey)) {
    fail('MISSING_STATIC_PROPERTY', `静态值中不存在属性 ${normalizedKey}`, node)
  }
  return owner[normalizedKey]
}

function evaluateStatic(node, context, depth = 0) {
  if (!node) fail('MISSING_VALUE', '缺少 option 静态值', node)
  assertValueDepth(context, node, depth)
  switch (node.type) {
    case 'Literal':
      if (node.regex || node.bigint != null) fail('UNSUPPORTED_LITERAL', 'option 不支持正则或 BigInt', node)
      if (typeof node.value === 'number' && !Number.isFinite(node.value)) {
        fail('NON_FINITE_NUMBER', 'option 数值必须是有限数', node)
      }
      return typeof node.value === 'string' ? staticString(node.value, context, node) : node.value
    case 'Identifier':
      return identifierValue(node, context)
    case 'ObjectExpression':
      return evaluateObject(node, context, depth)
    case 'ArrayExpression':
      return evaluateArray(node, context, depth)
    case 'TemplateLiteral':
      if (node.expressions.length) fail('DYNAMIC_TEMPLATE', 'option 模板字符串不能包含动态表达式', node)
      return staticString(node.quasis[0]?.value?.cooked ?? '', context, node)
    case 'UnaryExpression': {
      const value = evaluateStatic(node.argument, context, depth + 1)
      if (node.operator === '!') return !value
      if (node.operator === '+') return finiteNumericResult(+value, node)
      if (node.operator === '-') return finiteNumericResult(-value, node)
      fail('UNSUPPORTED_UNARY', `option 不支持一元运算符 ${node.operator}`, node)
      break
    }
    case 'BinaryExpression':
      return evaluateBinary(node, context, depth)
    case 'LogicalExpression': {
      const left = evaluateStatic(node.left, context, depth + 1)
      if (node.operator === '&&') return left ? evaluateStatic(node.right, context, depth + 1) : left
      if (node.operator === '||') return left ? left : evaluateStatic(node.right, context, depth + 1)
      if (node.operator === '??') return left == null ? evaluateStatic(node.right, context, depth + 1) : left
      fail('UNSUPPORTED_LOGICAL', `option 不支持逻辑运算符 ${node.operator}`, node)
      break
    }
    case 'ConditionalExpression':
      return evaluateStatic(node.test, context, depth + 1)
        ? evaluateStatic(node.consequent, context, depth + 1)
        : evaluateStatic(node.alternate, context, depth + 1)
    case 'MemberExpression':
      return evaluateMember(node, context, depth)
    case 'ChainExpression':
      return evaluateStatic(node.expression, context, depth + 1)
    case 'CallExpression':
    case 'NewExpression':
      fail('DYNAMIC_EXPRESSION', 'option 不能包含函数调用或构造器；请改为静态数据', node)
      break
    case 'ArrowFunctionExpression':
    case 'FunctionExpression':
      fail('FUNCTION_VALUE', 'option 不能包含函数；formatter 等动态逻辑暂不支持', node)
      break
    default:
      fail('UNSUPPORTED_EXPRESSION', `option 暂不支持 ${node.type} 语法`, node)
  }
}

function attemptStatic(node, context) {
  try {
    return { resolved: true, value: evaluateStatic(node, context) }
  } catch (error) {
    if (!(error instanceof EChartsCodeParseError)) throw error
    return { resolved: false, value: undefined, error }
  }
}

function callableReferences(node) {
  const references = new Set()
  const stack = [node]
  let containsCallable = false
  while (stack.length) {
    const current = stack.pop()
    if (!current || typeof current.type !== 'string') continue
    if (FUNCTION_NODE_TYPES.has(current.type)) containsCallable = true
    if (current.type === 'Identifier') references.add(current.name)
    for (const [key, value] of Object.entries(current)) {
      if (['loc', 'start', 'end', 'range'].includes(key) || !value) continue
      if (Array.isArray(value)) {
        for (const child of value) if (child && typeof child.type === 'string') stack.push(child)
      } else if (typeof value.type === 'string') stack.push(value)
    }
  }
  return containsCallable ? references : null
}

function withCallableMetadata(record, node) {
  const references = callableReferences(node)
  if (references) {
    record.callable = true
    record.callableReferences = references
  }
  return record
}

function registerDeclaration(declaration, context) {
  if (declaration.id.type !== 'Identifier') return
  if (!declaration.init) {
    context.environment.set(declaration.id.name, {
      resolved: false,
      error: new EChartsCodeParseError('UNINITIALIZED_IDENTIFIER', `变量 ${declaration.id.name} 尚未赋值`, declaration.id)
    })
    return
  }
  context.environment.set(
    declaration.id.name,
    withCallableMetadata(attemptStatic(declaration.init, context), declaration.init)
  )
}

function setOptionCall(node) {
  const call = node?.type === 'ChainExpression' ? node.expression : node
  if (call?.type !== 'CallExpression') return null
  const callee = call.callee?.type === 'ChainExpression' ? call.callee.expression : call.callee
  if (callee?.type !== 'MemberExpression') return null
  const name = callee.computed
    ? callee.property?.type === 'Literal' ? callee.property.value : ''
    : callee.property?.name
  return name === 'setOption' ? call : null
}

function rootIdentifier(node) {
  let current = node
  if (current?.type === 'ChainExpression') current = current.expression
  while (current?.type === 'MemberExpression') current = current.object
  return current?.type === 'Identifier' ? current : null
}

function taintIdentifier(identifier, context) {
  if (!identifier) return
  const record = context.environment.get(identifier.name)
  if (!record?.resolved || !record.value || typeof record.value !== 'object') return
  const stack = [record.value]
  while (stack.length) {
    const value = stack.pop()
    if (!value || typeof value !== 'object' || context.taintedValues.has(value)) continue
    context.taintedValues.add(value)
    for (const key of Object.keys(value)) {
      const child = value[key]
      if (child && typeof child === 'object') stack.push(child)
    }
  }
}

function taintCallableReferences(references, context) {
  if (!references) return
  for (const name of references) taintIdentifier({ name }, context)
}

function taintExpressionValue(node, context) {
  if (!node) return
  if (FUNCTION_NODE_TYPES.has(node.type)) {
    taintCallableReferences(callableReferences(node), context)
    return
  }
  if (node.type === 'Identifier') {
    const record = context.environment.get(node.name)
    if (record?.callable) taintCallableReferences(record.callableReferences, context)
    taintIdentifier(node, context)
    return
  }
  if (node.type === 'MemberExpression' || node.type === 'ChainExpression') {
    taintIdentifier(rootIdentifier(node), context)
  }
}

function taintInvocationClosure(call, context) {
  const callee = call.callee?.type === 'ChainExpression' ? call.callee.expression : call.callee
  if (FUNCTION_NODE_TYPES.has(callee?.type)) {
    taintCallableReferences(callableReferences(callee), context)
  }
  const root = rootIdentifier(callee)
  const record = root ? context.environment.get(root.name) : null
  if (record?.callable) taintCallableReferences(record.callableReferences, context)
}

function markDynamicMutations(node, context) {
  const stack = [node]
  while (stack.length) {
    const current = stack.pop()
    if (!current || FUNCTION_NODE_TYPES.has(current.type)) continue
    if (current.type === 'AssignmentExpression' && current.left.type !== 'Identifier') {
      taintExpressionValue(current.left, context)
    } else if (current.type === 'UpdateExpression') {
      taintExpressionValue(current.argument, context)
    } else if (current.type === 'CallExpression' && !setOptionCall(current)) {
      taintInvocationClosure(current, context)
      taintIdentifier(rootIdentifier(current.callee), context)
      for (const argument of current.arguments) {
        if (argument?.type === 'SpreadElement') taintExpressionValue(argument.argument, context)
        else taintExpressionValue(argument, context)
      }
    }
    for (const [key, value] of Object.entries(current)) {
      if (['loc', 'start', 'end', 'range'].includes(key) || !value) continue
      if (Array.isArray(value)) {
        for (const child of value) if (child && typeof child.type === 'string') stack.push(child)
      } else if (typeof value.type === 'string') stack.push(value)
    }
  }
}

function recordSetOption(call, context) {
  if (!call.arguments.length || call.arguments[0].type === 'SpreadElement') {
    fail('MISSING_SET_OPTION_ARGUMENT', 'setOption 必须传入一个静态 option 对象', call)
  }
  const option = evaluateStatic(call.arguments[0], context)
  if (!plainRecord(option)) fail('INVALID_OPTION', 'setOption 的第一个参数必须是对象', call.arguments[0])
  context.setOptions.push({ option, node: call.arguments[0] })
}

function containsSetOption(node) {
  const stack = [node]
  while (stack.length) {
    const current = stack.pop()
    if (!current || FUNCTION_NODE_TYPES.has(current.type)) continue
    if (setOptionCall(current)) return true
    for (const [key, value] of Object.entries(current)) {
      if (['loc', 'start', 'end', 'range'].includes(key) || !value) continue
      if (Array.isArray(value)) {
        for (const child of value) if (child && typeof child.type === 'string') stack.push(child)
      } else if (typeof value.type === 'string') stack.push(value)
    }
  }
  return false
}

function processExpression(node, context) {
  if (!node || FUNCTION_NODE_TYPES.has(node.type)) return
  const optionCall = setOptionCall(node)
  if (optionCall) {
    recordSetOption(optionCall, context)
    return
  }
  switch (node.type) {
    case 'AssignmentExpression': {
      if (node.left.type !== 'Identifier') {
        taintExpressionValue(node.left, context)
        if (containsSetOption(node.right)) processExpression(node.right, context)
        return
      }
      if (node.operator !== '=') {
        context.environment.set(node.left.name, {
          resolved: false,
          error: new EChartsCodeParseError('DYNAMIC_ASSIGNMENT', `变量 ${node.left.name} 使用了动态赋值`, node)
        })
        return
      }
      context.environment.set(
        node.left.name,
        withCallableMetadata(attemptStatic(node.right, context), node.right)
      )
      return
    }
    case 'SequenceExpression':
      for (const expression of node.expressions) processExpression(expression, context)
      return
    case 'LogicalExpression': {
      let left
      try {
        left = evaluateStatic(node.left, context)
      } catch (error) {
        if (containsSetOption(node.right)) {
          fail('DYNAMIC_CONTROL_FLOW', 'setOption 不能由动态逻辑条件控制', node.left, error)
        }
        return
      }
      if (node.operator === '&&' && left) processExpression(node.right, context)
      else if (node.operator === '||' && !left) processExpression(node.right, context)
      else if (node.operator === '??' && left == null) processExpression(node.right, context)
      return
    }
    case 'ConditionalExpression': {
      let condition
      try {
        condition = evaluateStatic(node.test, context)
      } catch (error) {
        if (containsSetOption(node.consequent) || containsSetOption(node.alternate)) {
          fail('DYNAMIC_CONTROL_FLOW', 'setOption 不能由动态条件表达式控制', node.test, error)
        }
        return
      }
      processExpression(condition ? node.consequent : node.alternate, context)
      return
    }
    case 'ChainExpression':
      processExpression(node.expression, context)
      return
    case 'CallExpression':
      markDynamicMutations(node, context)
      for (const argument of node.arguments) {
        if (argument?.type !== 'SpreadElement') processExpression(argument, context)
      }
      return
    default:
      return
  }
}

function processStatement(statement, context) {
  if (!statement) return
  switch (statement.type) {
    case 'ImportDeclaration':
    case 'EmptyStatement':
      return
    case 'VariableDeclaration':
      for (const declaration of statement.declarations) registerDeclaration(declaration, context)
      return
    case 'FunctionDeclaration':
    case 'ClassDeclaration':
      if (statement.id?.name) {
        context.environment.set(statement.id.name, withCallableMetadata({
            resolved: false,
            error: new EChartsCodeParseError('FUNCTION_IDENTIFIER', `变量 ${statement.id.name} 是可执行代码`, statement)
          }, statement))
      }
      return
    case 'ExpressionStatement':
      processExpression(statement.expression, context)
      return
    case 'BlockStatement':
      for (const child of statement.body) processStatement(child, context)
      return
    case 'ExportNamedDeclaration':
    case 'ExportDefaultDeclaration':
      if (statement.declaration?.type?.endsWith('Declaration')) processStatement(statement.declaration, context)
      return
    default:
      if (containsSetOption(statement)) {
        fail('DYNAMIC_CONTROL_FLOW', 'setOption 位于循环、条件或异步控制流中，无法确定唯一静态配置', statement)
      }
      markDynamicMutations(statement, context)
      return
  }
}

function saturatedAdd(left, right, limit) {
  if (left > limit || right > limit || left > limit - right) return limit + 1
  return left + right
}

function scalarSerializedLength(value, location) {
  const serialized = JSON.stringify(value)
  if (typeof serialized !== 'string') {
    fail('INVALID_OPTION', 'option 只能包含可序列化的静态值', location)
  }
  return serialized.length
}

function analyzeExpandedValue(value, context, location, state, depth = 0) {
  if (depth > context.limits.maxValueDepth) {
    fail('VALUE_DEPTH_LIMIT', `option 最多允许 ${context.limits.maxValueDepth} 层嵌套`, location)
  }
  if (value === null || typeof value !== 'object') {
    return {
      arrayItems: 0,
      objectProperties: 0,
      serializedLength: scalarSerializedLength(value, location),
      maxDepth: 0
    }
  }
  if (context.taintedValues.has(value)) {
    fail('DYNAMIC_MUTATION', 'option 引用了可能被动态代码修改的数据', location)
  }
  const cached = state.memo.get(value)
  if (cached) {
    if (depth + cached.maxDepth > context.limits.maxValueDepth) {
      fail('VALUE_DEPTH_LIMIT', `option 最多允许 ${context.limits.maxValueDepth} 层嵌套`, location)
    }
    return cached
  }
  if (state.active.has(value)) fail('INVALID_OPTION', '静态 option 不能包含循环引用', location)
  state.active.add(value)

  const array = Array.isArray(value)
  if (!array && !plainRecord(value)) fail('INVALID_OPTION', 'option 只能包含普通对象和数组', location)
  const keys = array ? null : Object.keys(value)
  const children = array ? value : keys.map(key => value[key])
  const result = {
    arrayItems: array ? value.length : 0,
    objectProperties: array ? 0 : keys.length,
    serializedLength: 2,
    maxDepth: 0
  }

  if (result.arrayItems > context.limits.maxArrayItems) {
    fail('ARRAY_ITEM_LIMIT', `option 最多允许 ${context.limits.maxArrayItems} 个数组项`, location)
  }
  if (result.objectProperties > context.limits.maxObjectProperties) {
    fail('OBJECT_PROPERTY_LIMIT', `option 最多允许 ${context.limits.maxObjectProperties} 个对象属性`, location)
  }
  if (children.length > 1) {
    result.serializedLength = saturatedAdd(
      result.serializedLength,
      children.length - 1,
      context.limits.maxOutputLength
    )
  }

  for (let index = 0; index < children.length; index += 1) {
    const child = analyzeExpandedValue(children[index], context, location, state, depth + 1)
    result.arrayItems = saturatedAdd(result.arrayItems, child.arrayItems, context.limits.maxArrayItems)
    if (result.arrayItems > context.limits.maxArrayItems) {
      fail('ARRAY_ITEM_LIMIT', `option 最多允许 ${context.limits.maxArrayItems} 个数组项`, location)
    }
    result.objectProperties = saturatedAdd(
      result.objectProperties,
      child.objectProperties,
      context.limits.maxObjectProperties
    )
    if (result.objectProperties > context.limits.maxObjectProperties) {
      fail('OBJECT_PROPERTY_LIMIT', `option 最多允许 ${context.limits.maxObjectProperties} 个对象属性`, location)
    }
    if (!array) {
      const keyLength = scalarSerializedLength(keys[index], location) + 1
      result.serializedLength = saturatedAdd(
        result.serializedLength,
        keyLength,
        context.limits.maxOutputLength
      )
    }
    result.serializedLength = saturatedAdd(
      result.serializedLength,
      child.serializedLength,
      context.limits.maxOutputLength
    )
    if (result.serializedLength > context.limits.maxOutputLength) {
      fail('OUTPUT_LENGTH_LIMIT', `option 序列化后最多允许 ${context.limits.maxOutputLength} 个字符`, location)
    }
    result.maxDepth = Math.max(result.maxDepth, child.maxDepth + 1)
  }

  state.active.delete(value)
  state.memo.set(value, result)
  return result
}

function validateExpandedOutput(option, context, location) {
  analyzeExpandedValue(option, context, location, {
    active: new WeakSet(),
    memo: new WeakMap()
  })
}

function plainOutput(value, seen = new Map()) {
  if (value === null || typeof value !== 'object') return value
  if (seen.has(value)) throw new TypeError('静态 option 不能包含循环引用')
  if (Array.isArray(value)) {
    const result = []
    seen.set(value, result)
    for (const item of value) result.push(plainOutput(item, seen))
    seen.delete(value)
    return result
  }
  const result = {}
  seen.set(value, result)
  for (const key of Object.keys(value)) result[safePropertyKey(key, null)] = plainOutput(value[key], seen)
  seen.delete(value)
  return result
}

function outputOption(context, program) {
  let option
  let location = program
  if (context.setOptions.length > 1) {
    fail('MULTIPLE_SET_OPTION', '检测到多次 setOption，无法确定应保存哪一份静态配置', context.setOptions[1].node)
  }
  if (context.setOptions.length === 1) {
    option = context.setOptions[0].option
    location = context.setOptions[0].node
  } else {
    const candidate = context.environment.get('option')
    if (!candidate) fail('OPTION_NOT_FOUND', '未找到 option 声明、赋值或 setOption 调用', program)
    if (!candidate.resolved) {
      if (candidate.error instanceof EChartsCodeParseError) throw candidate.error
      fail('OPTION_NOT_STATIC', 'option 不是可静态提取的对象', program, candidate.error)
    }
    option = candidate.value
  }
  if (!plainRecord(option)) fail('INVALID_OPTION', '提取到的 option 必须是对象', location)

  validateExpandedOutput(option, context, location)

  let normalized
  try {
    normalized = plainOutput(option)
  } catch (error) {
    if (error instanceof EChartsCodeParseError) throw error
    fail('INVALID_OPTION', error.message || 'option 无法安全复制', location, error)
  }
  const serialized = JSON.stringify(normalized)
  if (serialized.length > context.limits.maxOutputLength) {
    fail('OUTPUT_LENGTH_LIMIT', `option 序列化后最多允许 ${context.limits.maxOutputLength} 个字符`, location)
  }
  return normalized
}

/**
 * 从完整 ECharts 示例中提取静态 option。该函数只解析 AST，不执行输入代码。
 */
export function parseEChartsCode(source, options = {}) {
  if (typeof source !== 'string') throw new TypeError('ECharts 示例代码必须是字符串')
  const limits = normalizedLimits(options)
  if (source.length > limits.maxSourceLength) {
    fail('SOURCE_LENGTH_LIMIT', `示例代码最多允许 ${limits.maxSourceLength} 个字符`)
  }
  const program = parseProgram(source)
  validateAstBudget(program, limits)
  const context = {
    limits,
    environment: new Map(),
    taintedValues: new WeakSet(),
    setOptions: [],
    objectProperties: 0,
    arrayItems: 0
  }
  for (const statement of program.body) processStatement(statement, context)
  return outputOption(context, program)
}

export const extractEChartsOption = parseEChartsCode

/**
 * 校验完整示例代码，并移除浏览器无法直接解析的裸模块导入。
 * 返回值只用于无同源权限的 iframe；该函数本身不会执行输入代码。
 */
export function prepareEChartsCodeForSandbox(source, options = {}) {
  if (typeof source !== 'string') throw new TypeError('ECharts 示例代码必须是字符串')
  if (!source.trim()) fail('EMPTY_SOURCE', 'ECharts 示例代码不能为空')
  const limits = normalizedLimits(options)
  if (source.length > limits.maxSourceLength) {
    fail('SOURCE_LENGTH_LIMIT', `示例代码最多允许 ${limits.maxSourceLength} 个字符`)
  }
  const program = parseProgram(source)
  validateAstBudget(program, limits)

  const imports = program.body
    .filter(statement => statement.type === 'ImportDeclaration')
    .sort((left, right) => right.start - left.start)
  let prepared = source
  for (const statement of imports) {
    const removed = source.slice(statement.start, statement.end)
    const preservedLines = removed.replace(/[^\r\n]/g, ' ')
    prepared = `${prepared.slice(0, statement.start)}${preservedLines}${prepared.slice(statement.end)}`
  }
  return prepared
}

export function tryParseEChartsCode(source, options = {}) {
  try {
    return { ok: true, option: parseEChartsCode(source, options), error: null }
  } catch (error) {
    const normalized = error instanceof EChartsCodeParseError
      ? error
      : new EChartsCodeParseError('PARSE_FAILED', error?.message || 'ECharts 示例解析失败', null, error)
    return { ok: false, option: null, error: normalized }
  }
}
