import { describe, expect, it } from 'vitest';
import { createProjectionRuleForm, serializeProjectionRules } from './projectionRules';
describe('批准三权规则结构化表单', () => {
  it('空精确规则明确无数据授权，不补全部数据', () => { expect(serializeProjectionRules(createProjectionRuleForm())).toEqual({ pagePermissions: [], apiPermissions: [], dataGrantTemplate: null }); });
  it('限定范围按维度和值保留，不按逗号猜测多个值', () => {
    const form = createProjectionRuleForm(); form.grants.push({ resource: 'app:order', actions: 'read\nwrite', all: false, constraints: [{ dimension: 'customerId', values: 'customer,a\ncustomer-b' }] });
    expect(serializeProjectionRules(form).dataGrantTemplate?.grants[0]).toEqual({ resource: 'app:order', actions: ['read', 'write'], all: false, constraints: [{ dimension: 'customerId', operator: 'IN', values: ['customer,a', 'customer-b'] }] });
  });
  it('明确选全部数据时才提交 all，约束不隐式转成全部', () => {
    const form = createProjectionRuleForm(); form.grants.push({ resource: 'app:order', actions: 'read', all: false, constraints: [] }); expect(() => serializeProjectionRules(form)).toThrow('至少包含一个约束');
    form.grants[0]!.all = true; expect(serializeProjectionRules(form).dataGrantTemplate?.grants[0]?.all).toBe(true);
  });
  it('重复维度、空值、空操作不接受', () => {
    const form = createProjectionRuleForm(); form.grants.push({ resource: 'app:order', actions: '', all: true, constraints: [] }); expect(() => serializeProjectionRules(form)).toThrow('资源与操作');
    Object.assign(form.grants[0]!, { actions: 'read', all: false, constraints: [{ dimension: 'customerId', values: '' }] }); expect(() => serializeProjectionRules(form)).toThrow('至少一个允许值');
    form.grants[0]!.constraints = [{ dimension: 'customerId', values: 'a' }, { dimension: 'customerId', values: 'b' }]; expect(() => serializeProjectionRules(form)).toThrow('不能重复');
  });
});
