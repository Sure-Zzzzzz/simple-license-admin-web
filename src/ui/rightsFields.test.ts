import { describe, expect, it } from 'vitest';
import type { ModelFieldDef, RightsValues } from '../api/domain';
import { createRightsFields, serializeRightsFields, type RightsFieldInput } from './rightsFields';

const definitions: Record<string, ModelFieldDef> = {
  seats: { type: 'INTEGER', minimum: 0, maximum: 100 },
  enabled: { type: 'BOOLEAN' },
  label: { type: 'STRING' },
  regions: { type: 'STRING_SET' }
};

function fieldOf(fields: RightsFieldInput[], name: string): RightsFieldInput {
  const field = fields.find(item => item.name === name);
  expect(field, `权益「${name}」应有输入项`).toBeDefined();
  return field!;
}

describe('权益字段的类型化往返', () => {
  it('混合权益回读、编辑和提交保留四种 wire 类型', () => {
    const initial: RightsValues = {
      seats: 8,
      enabled: true,
      label: '  专业版  ',
      regions: ['华北', 'a,b', '第一行\n第二行', '🙂', '']
    };
    const fields = createRightsFields(definitions, initial);

    expect(serializeRightsFields(fields)).toEqual(initial);
    fieldOf(fields, 'seats').scalar = '12';
    fieldOf(fields, 'enabled').scalar = 'false';
    fieldOf(fields, 'label').scalar = ' 新版本 ';
    fieldOf(fields, 'regions').items.push('新增,区域');

    expect(serializeRightsFields(fields)).toEqual({
      seats: 12,
      enabled: false,
      label: ' 新版本 ',
      regions: [...initial.regions as string[], '新增,区域']
    });
  });

  it('零、false、空文本和空集合都是明确提供的值', () => {
    const initial: RightsValues = { seats: 0, enabled: false, label: '', regions: [] };
    const fields = createRightsFields(definitions, initial);

    expect(fields.every(field => field.included)).toBe(true);
    expect(serializeRightsFields(fields)).toEqual(initial);
  });

  it('方案部分预填保持缺省，不能补入未存字段的默认值', () => {
    const fields = createRightsFields(definitions, { enabled: false });

    expect(fieldOf(fields, 'enabled').included).toBe(true);
    expect(fieldOf(fields, 'seats').included).toBe(false);
    expect(fieldOf(fields, 'label').included).toBe(false);
    expect(fieldOf(fields, 'regions').included).toBe(false);
    expect(serializeRightsFields(fields)).toEqual({ enabled: false });

    fieldOf(fields, 'seats').included = true;
    fieldOf(fields, 'seats').scalar = '2';
    expect(serializeRightsFields(fields)).toEqual({ seats: 2, enabled: false });
  });

  it('明确空预填保持空对象，首次创建生成四类可编辑初值', () => {
    expect(serializeRightsFields(createRightsFields(definitions, {}))).toEqual({});
    expect(serializeRightsFields(createRightsFields(definitions))).toEqual({
      seats: 0, enabled: false, label: '', regions: []
    });
  });

  it('首次创建的整数初值在声明范围内，支持全正数或全负数范围', () => {
    const fields = createRightsFields({
      positive: { type: 'INTEGER', minimum: 5, maximum: 12 },
      negative: { type: 'INTEGER', minimum: -12, maximum: -5 }
    });

    expect(serializeRightsFields(fields)).toEqual({ positive: 5, negative: -5 });
  });

  it('集合输入和输出都与来源隔离，编辑或消费结果不污染原值', () => {
    const initial: RightsValues = { regions: ['原区域'] };
    const fields = createRightsFields(definitions, initial);
    fieldOf(fields, 'regions').items.push('新区域');

    expect(initial.regions).toEqual(['原区域']);
    const output = serializeRightsFields(fields);
    (output.regions as string[]).push('调用方追加');
    expect(fieldOf(fields, 'regions').items).toEqual(['原区域', '新区域']);
  });

  it('取消包含后不提交保留的输入，再启用时仍保留原始文本', () => {
    const fields = createRightsFields(definitions, { label: '  保留内容  ' });
    fieldOf(fields, 'label').included = false;
    expect(serializeRightsFields(fields)).toEqual({});

    fieldOf(fields, 'label').included = true;
    expect(serializeRightsFields(fields)).toEqual({ label: '  保留内容  ' });
  });
});

describe('权益整数的输入与范围校验', () => {
  it.each(['', ' ', '\t\n', '1.5', '-2.5', 'NaN', 'Infinity', '-Infinity', '1e309', '9007199254740992', '-9007199254740992'])
  ('拒绝非法整数输入 %j，不转换成零或截断', raw => {
    const fields = createRightsFields({ amount: { type: 'INTEGER' } });
    fieldOf(fields, 'amount').scalar = raw;

    expect(() => serializeRightsFields(fields)).toThrow(/amount.*有效整数/);
  });

  it.each([-3, 7])('接受声明范围的包含边界 %i', value => {
    const fields = createRightsFields({ amount: { type: 'INTEGER', minimum: -3, maximum: 7 } });
    fieldOf(fields, 'amount').scalar = String(value);
    expect(serializeRightsFields(fields)).toEqual({ amount: value });
  });

  it.each([-4, 8])('拒绝声明范围之外的整数 %i', value => {
    const fields = createRightsFields({ amount: { type: 'INTEGER', minimum: -3, maximum: 7 } });
    fieldOf(fields, 'amount').scalar = String(value);
    expect(() => serializeRightsFields(fields)).toThrow(/amount.*不能/);
  });

  it.each([Number.MIN_SAFE_INTEGER, Number.MAX_SAFE_INTEGER])('安全整数边界 %i 能精确往返', value => {
    const fields = createRightsFields({ amount: { type: 'INTEGER' } }, { amount: value });
    expect(serializeRightsFields(fields)).toEqual({ amount: value });
  });

  it('未包含的可选整数不会因其暂存非法输入阻止方案保存', () => {
    const fields = createRightsFields({ amount: { type: 'INTEGER' } }, {});
    fieldOf(fields, 'amount').scalar = '不是数字';
    expect(serializeRightsFields(fields)).toEqual({});
  });
});

describe('文本、布尔及集合约束', () => {
  it.each(['', '0', '1', 'FALSE', ' true '])('布尔只接受明确 true/false，拒绝 %j', scalar => {
    const fields = createRightsFields({ enabled: { type: 'BOOLEAN' } });
    fieldOf(fields, 'enabled').scalar = scalar;
    expect(() => serializeRightsFields(fields)).toThrow(/enabled.*布尔值/);
  });

  it('文本长度按 Unicode code point 计数，不能按 UTF-16 长度误拒绝 emoji', () => {
    const fields = createRightsFields({ label: { type: 'STRING', maxLength: 2 } }, { label: '🙂中' });
    expect(serializeRightsFields(fields)).toEqual({ label: '🙂中' });

    fieldOf(fields, 'label').scalar = '🙂中文';
    expect(() => serializeRightsFields(fields)).toThrow(/label.*超过 2/);
  });

  it('长度零只允许空文本', () => {
    const fields = createRightsFields({ label: { type: 'STRING', maxLength: 0 } }, { label: '' });
    expect(serializeRightsFields(fields)).toEqual({ label: '' });

    fieldOf(fields, 'label').scalar = ' ';
    expect(() => serializeRightsFields(fields)).toThrow(/label.*超过 0/);
  });

  it('枚举精确匹配，不去掉空格或改变大小写，允许显式声明的空串', () => {
    const fields = createRightsFields({ label: { type: 'STRING', enumValues: ['', ' Pro '] } }, { label: '' });
    expect(serializeRightsFields(fields)).toEqual({ label: '' });

    fieldOf(fields, 'label').scalar = ' Pro ';
    expect(serializeRightsFields(fields)).toEqual({ label: ' Pro ' });
    fieldOf(fields, 'label').scalar = 'Pro';
    expect(() => serializeRightsFields(fields)).toThrow(/label.*允许的文本值/);
  });

  it('空枚举声明不限制文本', () => {
    const fields = createRightsFields({ label: { type: 'STRING', enumValues: [] } }, { label: '任意内容' });
    expect(serializeRightsFields(fields)).toEqual({ label: '任意内容' });
  });

  it('集合数量上限为包含边界，不去重或拆分已存的逗号与换行', () => {
    const fields = createRightsFields({ regions: { type: 'STRING_SET', maxItems: 3 } }, {
      regions: ['a,b', '第一行\n第二行', 'a,b']
    });
    expect(serializeRightsFields(fields)).toEqual({ regions: ['a,b', '第一行\n第二行', 'a,b'] });

    fieldOf(fields, 'regions').items.push('第四项');
    expect(() => serializeRightsFields(fields)).toThrow(/regions.*最多 3 项/);
  });

  it('集合数量零允许空数组，禁止任何成员', () => {
    const fields = createRightsFields({ regions: { type: 'STRING_SET', maxItems: 0 } }, { regions: [] });
    expect(serializeRightsFields(fields)).toEqual({ regions: [] });

    fieldOf(fields, 'regions').items.push('');
    expect(() => serializeRightsFields(fields)).toThrow(/regions.*最多 0 项/);
  });

  it('集合不套用仅属于文本字段的长度和枚举约束，成员原值保持不变', () => {
    const fields = createRightsFields({ regions: { type: 'STRING_SET', maxLength: 2, enumValues: ['🙂中', ''] } }, {
      regions: ['🙂中', '']
    });
    expect(serializeRightsFields(fields)).toEqual({ regions: ['🙂中', ''] });

    fieldOf(fields, 'regions').items = ['🙂中文'];
    expect(serializeRightsFields(fields)).toEqual({ regions: ['🙂中文'] });
    fieldOf(fields, 'regions').items = ['别的'];
    expect(serializeRightsFields(fields)).toEqual({ regions: ['别的'] });
  });
});

describe('已有预填值的严格读取', () => {
  const invalidValues: Array<[ModelFieldDef['type'], unknown]> = [
    ['INTEGER', '2'], ['INTEGER', 2.5], ['INTEGER', Infinity], ['INTEGER', NaN],
    ['INTEGER', Number.MAX_SAFE_INTEGER + 1], ['INTEGER', true],
    ['BOOLEAN', 'false'], ['BOOLEAN', 0],
    ['STRING', 1], ['STRING', false], ['STRING', ['文本']],
    ['STRING_SET', 'a,b'], ['STRING_SET', [1]], ['STRING_SET', ['合法文本', null]],
    ['INTEGER', null], ['BOOLEAN', null], ['STRING', null], ['STRING_SET', null]
  ];

  it.each(invalidValues)('拒绝 %s 字段的错误类型已存值 %j', (type, value) => {
    expect(() => createRightsFields({ value: { type } }, { value } as RightsValues))
      .toThrow(/value.*已存值与模型类型不一致/);
  });

  it('未知权益键须报错，不能编辑后静默丢掉已有数据', () => {
    expect(() => createRightsFields(definitions, { enabled: true, undeclared: '已有内容' }))
      .toThrow(/undeclared.*未在引用模型中声明/);
  });

  it('已存整数越界在提交前被拒绝，不自动压回合法范围', () => {
    const fields = createRightsFields({ seats: { type: 'INTEGER', minimum: 1, maximum: 5 } }, { seats: 8 });
    expect(fieldOf(fields, 'seats').scalar).toBe('8');
    expect(() => serializeRightsFields(fields)).toThrow(/seats.*不能大于 5/);
  });
});

describe('权益缺省与必填规则', () => {
  const requiredDefinitions: Record<string, ModelFieldDef> = {
    seats: { type: 'INTEGER', required: true, minimum: 0, maximum: 10 },
    enabled: { type: 'BOOLEAN', required: true },
    label: { type: 'STRING', required: true },
    regions: { type: 'STRING_SET', required: true },
    optional: { type: 'STRING' }
  };

  it('方案默认允许部分预填，required 不应强制方案给出全部权益', () => {
    const fields = createRightsFields(requiredDefinitions, {});
    expect(serializeRightsFields(fields)).toEqual({});
  });

  it.each(['seats', 'enabled', 'label', 'regions'])('授权校验拒绝缺失的 required 字段 %s', name => {
    const fields = createRightsFields(requiredDefinitions, { seats: 0, enabled: false, label: '', regions: [] });
    fieldOf(fields, name).included = false;
    expect(() => serializeRightsFields(fields, true)).toThrow(new RegExp(`必填权益「${name}」`));
  });

  it('零、false、空文本和空集合满足已提供要求，可选字段仍可缺省', () => {
    const values: RightsValues = { seats: 0, enabled: false, label: '', regions: [] };
    const fields = createRightsFields(requiredDefinitions, values);
    expect(serializeRightsFields(fields, true)).toEqual(values);
  });
});
