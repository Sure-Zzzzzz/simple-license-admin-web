<script setup lang="ts">
import type { ProjectionRules } from '../api/domain';
defineProps<{ rules: ProjectionRules; title?: string }>();
</script>

<template>
  <section class="license-rule-summary">
    <h3>{{ title || '应用权限' }}</h3>
    <dl class="license-detail-grid">
      <div><dt>页面权限</dt><dd>{{ rules.pagePermissions.join('、') || '无' }}</dd></div>
      <div><dt>接口权限</dt><dd>{{ rules.apiPermissions.join('、') || '无' }}</dd></div>
    </dl>
    <p v-if="!rules.dataGrantTemplate" class="license-hint">无数据授权</p>
    <template v-else-if="rules.dataGrantTemplate.protocol === 'simple-data-permission' && rules.dataGrantTemplate.version === '1.0' && Array.isArray(rules.dataGrantTemplate.grants)">
      <section v-for="(grant, index) in rules.dataGrantTemplate.grants" :key="index" class="license-rule-grant">
        <strong>{{ grant.resource }}</strong>
        <p>允许操作：{{ grant.actions.join('、') }}</p>
        <p v-if="grant.all">范围：全部数据</p>
        <p v-else v-for="constraint in grant.constraints" :key="constraint.dimension">{{ constraint.dimension }}：{{ constraint.values.join('、') }}</p>
      </section>
    </template>
    <p v-else class="license-message danger">数据授权格式暂无法展示，请在目标应用核对批准规则。</p>
  </section>
</template>
