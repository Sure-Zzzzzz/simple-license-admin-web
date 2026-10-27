<script setup lang="ts">
import FormSelect from '@sure-zzzzzz/simple-iam-theme-contract/FormSelect';
import type { ProjectionRuleForm } from '../ui/projectionRules';
defineProps<{ form: ProjectionRuleForm; disabled?: boolean }>();
</script>

<template>
  <fieldset class="license-rule-editor">
    <legend>批准的应用权限</legend>
    <p class="license-hint">填写目标应用已登记并经批准的精确权限。每行一项；未填写的数据授权表示无数据权限。</p>
    <label>页面权限<textarea v-model="form.pages" aria-label="页面权限" rows="3" :disabled="disabled" placeholder="每行一个页面权限码" /></label>
    <label>接口权限<textarea v-model="form.apis" aria-label="接口权限" rows="3" :disabled="disabled" placeholder="每行一个接口权限码" /></label>
    <section v-for="(grant, index) in form.grants" :key="index" class="license-rule-grant">
      <div class="license-table-actions"><strong>数据授权 {{ index + 1 }}</strong><button type="button" class="button-secondary" :disabled="disabled" @click="form.grants.splice(index, 1)">移除数据授权</button></div>
      <label>数据资源<input v-model="grant.resource" :aria-label="`数据资源 ${index + 1}`" :disabled="disabled" required /></label>
      <label>数据操作<textarea v-model="grant.actions" :aria-label="`数据操作 ${index + 1}`" :disabled="disabled" rows="2" placeholder="每行一个操作" /></label>
      <div class="license-field"><span>数据范围</span><FormSelect :model-value="grant.all ? 'ALL' : 'RESTRICTED'" :options="[{ value: 'RESTRICTED', label: '指定范围' }, { value: 'ALL', label: '全部数据' }]" :aria-label="`数据范围 ${index + 1}`" :disabled="disabled" @update:model-value="value => { grant.all = value === 'ALL'; }" /></div>
      <p v-if="grant.all" class="license-hint">此授权允许所选资源和操作的全部数据，请确认已获得批准。</p>
      <template v-else>
        <section v-for="(constraint, constraintIndex) in grant.constraints" :key="constraintIndex" class="license-rule-constraint">
          <label>约束维度<input v-model="constraint.dimension" :aria-label="`约束维度 ${index + 1}-${constraintIndex + 1}`" :disabled="disabled" required /></label>
          <label>允许值<textarea v-model="constraint.values" :aria-label="`允许值 ${index + 1}-${constraintIndex + 1}`" :disabled="disabled" rows="2" placeholder="每行一个值；不同约束同时满足" /></label>
          <button type="button" class="button-secondary" :disabled="disabled" @click="grant.constraints.splice(constraintIndex, 1)">移除约束</button>
        </section>
        <button type="button" class="button-secondary" :disabled="disabled" @click="grant.constraints.push({ dimension: '', values: '' })">添加约束</button>
      </template>
    </section>
    <button type="button" class="button-secondary" :disabled="disabled" @click="form.grants.push({ resource: '', actions: '', all: false, constraints: [] })">添加数据授权</button>
  </fieldset>
</template>
