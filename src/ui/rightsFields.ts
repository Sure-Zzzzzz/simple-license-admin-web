import type { ModelFieldDef, RightsValue, RightsValues } from '../api/domain';

/** 原始输入与 wire 值分离，布尔、空值和文本集合回读时不做字符串强转。 */
export interface RightsFieldInput {
  name: string;
  definition: ModelFieldDef;
  included: boolean;
  scalar: string;
  items: string[];
}

export function createRightsFields(definitions: Record<string, ModelFieldDef>, initial?: RightsValues): RightsFieldInput[] {
  for (const name of Object.keys(initial ?? {})) {
    if (!Object.prototype.hasOwnProperty.call(definitions, name)) throw new Error(`权益「${name}」未在引用模型中声明，请检查方案。`);
  }
  return Object.entries(definitions).map(([name, definition]) => {
    const hasValue = initial !== undefined && Object.prototype.hasOwnProperty.call(initial, name);
    const value = hasValue ? initial[name] : undefined;
    if (hasValue && !matchesType(definition.type, value)) {
      throw new Error(`权益「${name}」的已存值与模型类型不一致，请检查方案。`);
    }
    const defaultInteger = Math.min(definition.maximum ?? Infinity, Math.max(definition.minimum ?? -Infinity, 0));
    return {
      name, definition,
      included: initial === undefined || hasValue,
      scalar: hasValue && !Array.isArray(value) ? String(value)
        : definition.type === 'BOOLEAN' ? 'false' : definition.type === 'INTEGER' ? String(defaultInteger) : '',
      items: Array.isArray(value) ? [...value] : []
    };
  });
}

function matchesType(type: ModelFieldDef['type'], value: unknown): value is RightsValue {
  if (type === 'INTEGER') return typeof value === 'number' && Number.isSafeInteger(value);
  if (type === 'BOOLEAN') return typeof value === 'boolean';
  if (type === 'STRING') return typeof value === 'string';
  return type === 'STRING_SET' && Array.isArray(value) && value.every(item => typeof item === 'string');
}

/** 方案允许部分预填；授权按模型 required 校验，缺失与 false/0/空文本必须分开。 */
export function serializeRightsFields(fields: RightsFieldInput[], requireRequired = false): RightsValues {
  const values: RightsValues = Object.create(null);
  for (const field of fields) {
    const { name, definition, scalar, items } = field;
    if (!field.included) {
      if (requireRequired && definition.required) throw new Error(`请填写必填权益「${name}」。`);
      continue;
    }
    let value: RightsValue;
    if (definition.type === 'INTEGER') {
      const parsed = Number(scalar);
      if (!scalar.trim() || !Number.isSafeInteger(parsed)) throw new Error(`权益「${name}」必须是有效整数。`);
      if (definition.minimum !== undefined && parsed < definition.minimum) throw new Error(`权益「${name}」不能小于 ${definition.minimum}。`);
      if (definition.maximum !== undefined && parsed > definition.maximum) throw new Error(`权益「${name}」不能大于 ${definition.maximum}。`);
      value = parsed;
    } else if (definition.type === 'BOOLEAN') {
      if (scalar !== 'true' && scalar !== 'false') throw new Error(`请选择权益「${name}」的布尔值。`);
      value = scalar === 'true';
    } else if (definition.type === 'STRING') {
      validateText(name, scalar, definition);
      value = scalar;
    } else if (definition.type === 'STRING_SET') {
      if (definition.maxItems !== undefined && items.length > definition.maxItems) throw new Error(`权益「${name}」最多 ${definition.maxItems} 项。`);
      // 模型的 maxLength/enumValues 只约束 STRING；集合按 core 语义仅校验数量与元素类型。
      value = [...items];
    } else {
      throw new Error(`权益「${name}」使用了不支持的类型。`);
    }
    values[name] = value;
  }
  return values;
}

function validateText(name: string, value: string, definition: ModelFieldDef) {
  if (definition.maxLength !== undefined && [...value].length > definition.maxLength) throw new Error(`权益「${name}」文本不能超过 ${definition.maxLength} 个字符。`);
  if (definition.enumValues?.length && !definition.enumValues.includes(value)) throw new Error(`权益「${name}」必须使用模型允许的文本值。`);
}
