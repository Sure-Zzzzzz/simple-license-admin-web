import type { ProjectionRules } from '../api/domain';

export interface ProjectionRuleForm {
  pages: string; apis: string;
  grants: Array<{ resource: string; actions: string; all: boolean; constraints: Array<{ dimension: string; values: string }> }>;
}
export function createProjectionRuleForm(): ProjectionRuleForm { return { pages: '', apis: '', grants: [] }; }

/** 权限和约束值逐行填写；重复或不完整条目拒绝提交，避免静默扩大或缩减批准范围。 */
function lines(value: string, label: string): string[] {
  const values = value.split(/\r?\n/).map(item => item.trim()).filter(Boolean);
  if (new Set(values).size !== values.length) throw new Error(`${label}包含重复值，请核对后提交。`);
  return values;
}
export function serializeProjectionRules(form: ProjectionRuleForm): ProjectionRules {
  const grants = form.grants.map((grant, index) => {
    const resource = grant.resource.trim();
    const actions = lines(grant.actions, '数据操作');
    if (!resource || !actions.length) throw new Error(`第 ${index + 1} 项数据授权须填写资源与操作。`);
    const constraints = grant.all ? [] : grant.constraints.map(constraint => {
      const dimension = constraint.dimension.trim();
      const values = lines(constraint.values, '允许值');
      if (!dimension || !values.length) throw new Error('数据范围须填写约束维度与至少一个允许值。');
      return { dimension, operator: 'IN' as const, values };
    });
    if (!grant.all && !constraints.length) throw new Error('指定范围的数据授权须至少包含一个约束。');
    if (new Set(constraints.map(item => item.dimension)).size !== constraints.length) throw new Error('同一数据授权的约束维度不能重复。');
    return { resource, actions, all: grant.all, constraints };
  });
  return {
    pagePermissions: lines(form.pages, '页面权限'), apiPermissions: lines(form.apis, '接口权限'),
    dataGrantTemplate: grants.length ? { protocol: 'simple-data-permission', version: '1.0', grants } : null
  };
}
