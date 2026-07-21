<template>
  <div class="security-console">
    <section class="policy-hero">
      <div class="hero-copy">
        <div class="eyebrow"><i class="fas fa-shield-alt"></i> NOPE POLICY CONTROL</div>
        <h3>Security posture</h3>
        <p>Choose a baseline, then open any category to tune individual rules.</p>
      </div>
      <div class="hero-status">
        <span class="status-dot"></span>
        <div><small>ACTIVE POLICY</small><strong>{{ format(policy.mode) }}</strong></div>
      </div>
    </section>

    <div class="mode-grid">
      <Tooltip v-for="preset in presets" :key="preset.id" :title="preset.label" :text="preset.tooltip" position="bottom" width="290px">
        <button type="button" :class="['mode-card', { active: policy.mode === preset.id }]" @click="setMode(preset.id)">
          <span class="mode-icon"><i :class="preset.icon"></i></span>
          <span class="mode-copy"><strong>{{ preset.label }}</strong><small>{{ preset.description }}</small></span>
          <i v-if="policy.mode === preset.id" class="fas fa-check-circle selected-mark"></i>
        </button>
      </Tooltip>
    </div>

    <div v-if="error" class="notice error"><i class="fas fa-exclamation-triangle"></i>{{ error }}</div>
    <div v-if="saved" class="notice success"><i class="fas fa-check-circle"></i>Security policy saved.</div>

    <section class="management-panel">
      <div class="section-header">
        <div>
          <div class="section-kicker">POLICY GROUPS</div>
          <h3>Security categories</h3>
          <p>Set a category default or expand it for rule-level control.</p>
        </div>
        <div class="legend" aria-label="Restriction scale">
          <span>Least restrictive</span><i class="legend-line"></i><span>Most restrictive</span>
        </div>
      </div>

      <div class="category-stack">
        <article v-for="category in categories" :key="category" :class="['category-card', { open: isExpanded(category) }]">
          <div class="category-summary">
            <button type="button" class="category-identity" @click="toggleCategory(category)">
              <span class="category-icon"><i :class="categoryMeta(category).icon"></i></span>
              <span class="category-copy">
                <span class="category-title-row">
                  <strong>{{ format(category) }}</strong>
                  <span v-if="exceptionCount(category)" class="exception-badge">{{ exceptionCount(category) }} rule {{ exceptionCount(category) === 1 ? 'exception' : 'exceptions' }}</span>
                </span>
                <small>{{ categoryMeta(category).description }}</small>
              </span>
            </button>

            <div class="category-policy">
              <span class="control-label">Group default</span>
              <Tooltip :text="categoryTooltip(category)" position="left" width="360px">
                <SecurityLevelSlider
                  :model-value="categoryDecision(category)"
                  :options="decisionOptions"
                  @update:modelValue="setCategoryDecision(category, $event)"
                />
              </Tooltip>
            </div>

            <button type="button" class="expand-button" :aria-expanded="isExpanded(category)" @click="toggleCategory(category)">
              <span>{{ isExpanded(category) ? 'Hide rules' : 'Manage rules' }}</span>
              <i :class="['fas', isExpanded(category) ? 'fa-chevron-up' : 'fa-chevron-down']"></i>
            </button>
          </div>

          <div v-if="isExpanded(category)" class="rule-panel">
            <div class="rule-toolbar">
              <div>
                <strong>{{ rulesFor(category).length }} rules</strong>
                <span>Rule choices override the group default.</span>
              </div>
              <button v-if="exceptionCount(category)" type="button" class="text-button" @click="clearRuleExceptions(category)">
                Reset rule exceptions
              </button>
            </div>

            <div class="rule-list">
              <div v-for="rule in rulesFor(category)" :key="rule.id" class="rule-row">
                <div class="rule-copy">
                  <div class="rule-name-line">
                    <strong>{{ rule.description }}</strong>
                    <span :class="['severity', rule.severity]">{{ rule.severity }}</span>
                    <Tooltip :title="rule.id" :text="ruleTooltip(rule)" position="right" width="380px">
                      <i class="fas fa-info-circle info-icon"></i>
                    </Tooltip>
                  </div>
                  <small>{{ rule.id }}</small>
                </div>
                <Tooltip :text="decisionHelp" position="left" width="350px">
                  <SecurityLevelSlider
                    :model-value="effectiveRuleDecision(rule)"
                    :options="decisionOptions"
                    @update:modelValue="setRuleDecision(rule, $event)"
                  />
                </Tooltip>
              </div>
            </div>
          </div>
        </article>
      </div>
    </section>

    <div class="lower-grid">
      <section class="management-panel output-panel">
        <div class="section-header compact">
          <div>
            <div class="section-kicker">DATA PROTECTION</div>
            <h3>Tool-output secret scanning</h3>
            <p>Choose what AGNT does when a tool result contains an API key, token, password, or credential.</p>
          </div>
          <Tooltip text="This setting scans data returned by tools. It does not control whether the tool itself is allowed to run; the security categories above control execution." position="left" width="380px">
            <i class="fas fa-info-circle info-icon"></i>
          </Tooltip>
        </div>

        <div class="section-explainer">
          <i class="fas fa-info-circle"></i>
          <div>
            <strong>What this controls</strong>
            <p>This applies <em>after a tool has run</em>. AGNT inspects the tool's returned text or data for exposed credentials. It does not decide whether the tool may execute; the Security categories above do that.</p>
          </div>
        </div>

        <div class="output-choice-grid">
          <button
            v-for="option in outputScanningDetails"
            :key="option.value"
            type="button"
            :class="['output-choice', option.value, { active: policy.outputScanning === option.value }]"
            @click="policy.outputScanning = option.value"
          >
            <span class="output-choice-icon"><i :class="option.icon"></i></span>
            <span class="output-choice-copy"><strong>{{ option.label }}</strong><small>{{ option.description }}</small></span>
            <i v-if="policy.outputScanning === option.value" class="fas fa-check-circle output-choice-check"></i>
          </button>
        </div>

        <div class="output-scale-label">
          <span><i class="fas fa-exclamation-circle"></i> Less protection</span>
          <span>More protection <i class="fas fa-shield-alt"></i></span>
        </div>
        <SecurityLevelSlider v-model="policy.outputScanning" :options="outputScanningOptions" />

        <div class="active-output-summary">
          <i :class="activeOutputDetail.icon"></i>
          <div><small>CURRENT BEHAVIOR</small><strong>{{ activeOutputDetail.summary }}</strong></div>
        </div>
      </section>
    </div>

    <footer class="policy-footer">
      <div class="dirty-state"><span :class="{ changed: isDirty }"></span>{{ isDirty ? 'Unsaved policy changes' : 'Policy is up to date' }}</div>
      <div class="footer-actions">
        <Tooltip text="Remove saved overrides and restore the default Balanced policy." position="top" width="290px">
          <button type="button" class="secondary-button" :disabled="loading" @click="reset"><i class="fas fa-undo"></i>Reset to Balanced</button>
        </Tooltip>
        <Tooltip text="Save this account policy. It applies to new tool and workflow executions immediately." position="top" width="310px">
          <button type="button" class="primary-button" :disabled="loading || !isDirty" @click="save"><i class="fas fa-save"></i>{{ loading ? 'Saving…' : 'Save policy' }}</button>
        </Tooltip>
      </div>
    </footer>
  </div>
</template>

<script setup>
import { computed, onMounted, reactive, ref } from 'vue';
import Tooltip from '@/views/Terminal/_components/Tooltip.vue';
import { securityPolicyService } from '@/services/securityPolicyService.js';
import SecurityLevelSlider from './SecurityLevelSlider.vue';

const decisionOptions = [
  { value: 'allow', label: 'Allow' },
  { value: 'audit', label: 'Audit' },
  { value: 'block', label: 'Block' },
];
const outputScanningOptions = [
  { value: 'off', label: 'Off' },
  { value: 'report', label: 'Report only' },
  { value: 'enforce', label: 'Redact' },
];
const outputScanningDetails = [
  {
    value: 'off',
    label: 'Off',
    icon: 'fas fa-eye-slash',
    description: 'Return tool results unchanged. Do not look for exposed secrets.',
    summary: 'Tool results are returned unchanged and are not scanned for secrets.',
  },
  {
    value: 'report',
    label: 'Report only',
    icon: 'fas fa-clipboard-list',
    description: 'Detect possible secrets and write an audit event, but keep the result unchanged.',
    summary: 'Possible secrets are logged for review, but the tool result is not modified.',
  },
  {
    value: 'enforce',
    label: 'Redact',
    icon: 'fas fa-user-shield',
    description: 'Detect possible secrets and replace them before returning the tool result.',
    summary: 'Detected secrets are removed from tool results before they are returned.',
  },
];
const presets = [
  { id: 'off', label: 'Off', icon: 'fas fa-power-off', description: 'Allow every action', tooltip: 'Disables enforcement. Findings are allowed. Use only for temporary troubleshooting.' },
  { id: 'observe', label: 'Observe', icon: 'fas fa-eye', description: 'Log without blocking', tooltip: 'Allows actions but records every matching rule in Recent Decisions.' },
  { id: 'balanced', label: 'Balanced', icon: 'fas fa-shield-alt', description: 'Block critical risks', tooltip: 'Recommended default. Critical findings block; lower severities audit. Known legitimate AGNT patterns remain audit-only.' },
  { id: 'strict', label: 'Strict', icon: 'fas fa-lock', description: 'Block high + critical', tooltip: 'Blocks critical and high-severity findings. Medium and low findings audit.' },
  { id: 'custom', label: 'Custom', icon: 'fas fa-sliders-h', description: 'Tune every policy layer', tooltip: 'Starts from your saved choices. Category defaults can be refined with individual rule exceptions.' },
];
const presetSeverities = {
  off: { critical: 'allow', high: 'allow', medium: 'allow', low: 'allow' },
  observe: { critical: 'audit', high: 'audit', medium: 'audit', low: 'audit' },
  balanced: { critical: 'block', high: 'audit', medium: 'audit', low: 'audit' },
  strict: { critical: 'block', high: 'block', medium: 'audit', low: 'audit' },
};
const balancedRuleDefaults = {
  'cred-env-file-send': 'audit',
  'net-ssrf-private-10': 'audit',
  'net-ssrf-private-172': 'audit',
  'net-ssrf-private-192': 'audit',
  'net-ssrf-ipv6-private': 'audit',
};
const categoryMetadata = {
  filesystem: { icon: 'fas fa-folder-open', description: 'Files, protected paths, permissions, and destructive writes.' },
  database: { icon: 'fas fa-database', description: 'Schema changes and unbounded data mutations.' },
  system: { icon: 'fas fa-server', description: 'Processes, services, privileges, firewall, and OS controls.' },
  credentials: { icon: 'fas fa-key', description: 'API keys, tokens, credential files, and environment secrets.' },
  injection: { icon: 'fas fa-code', description: 'Command, terminal, template, and prompt injection patterns.' },
  exfiltration: { icon: 'fas fa-cloud-upload-alt', description: 'Sensitive data uploads, archives, pipes, and encoding.' },
  network: { icon: 'fas fa-network-wired', description: 'Private destinations, metadata endpoints, tunnels, and shells.' },
  git: { icon: 'fab fa-git-alt', description: 'History rewrites, forced pushes, and destructive repository actions.' },
  packages: { icon: 'fas fa-box-open', description: 'Global installs, publication, and risky package scripts.' },
  containers: { icon: 'fab fa-docker', description: 'Privileged execution, host mounts, and dangerous capabilities.' },
};
const decisionHelp = 'Allow executes without warning. Audit executes and records the finding. Block stops before execution.';
const decisionRank = { allow: 0, audit: 1, block: 2 };

const policy = reactive({ mode: 'balanced', severityDecisions: {}, categoryOverrides: {}, ruleOverrides: {}, outputScanning: 'report' });
const rules = ref([]);
const expandedCategories = ref(new Set());
const loading = ref(false);
const error = ref('');
const saved = ref(false);
const savedSnapshot = ref('');

const categories = computed(() => [...new Set(rules.value.map(rule => rule.category))].sort());
const isDirty = computed(() => savedSnapshot.value && JSON.stringify(compactPolicy()) !== savedSnapshot.value);
const activeOutputDetail = computed(() => outputScanningDetails.find(option => option.value === policy.outputScanning) || outputScanningDetails[1]);

const format = value => String(value || '').replace(/[-_]/g, ' ').replace(/\b\w/g, character => character.toUpperCase());
const categoryMeta = category => categoryMetadata[category] || { icon: 'fas fa-shield-alt', description: `Security rules for ${format(category)}.` };
const rulesFor = category => rules.value.filter(rule => rule.category === category);
const isExpanded = category => expandedCategories.value.has(category);

function toggleCategory(category) {
  const next = new Set(expandedCategories.value);
  next.has(category) ? next.delete(category) : next.add(category);
  expandedCategories.value = next;
}

function severityDefaults(mode = policy.mode) {
  return presetSeverities[mode] || policy.severityDecisions || presetSeverities.balanced;
}

function baseRuleDecision(rule, mode = policy.mode) {
  if (mode === 'balanced' && balancedRuleDefaults[rule.id]) return balancedRuleDefaults[rule.id];
  return severityDefaults(mode)[rule.severity] || 'audit';
}

function effectiveRuleDecision(rule) {
  return policy.ruleOverrides[rule.id] || policy.categoryOverrides[rule.category] || baseRuleDecision(rule);
}

function categoryDecision(category) {
  if (policy.categoryOverrides[category]) return policy.categoryOverrides[category];
  const counts = { allow: 0, audit: 0, block: 0 };
  for (const rule of rulesFor(category)) counts[baseRuleDecision(rule)] += 1;
  return Object.keys(counts).sort((a, b) => counts[b] - counts[a] || decisionRank[b] - decisionRank[a])[0] || 'audit';
}

function exceptionCount(category) {
  const baseline = categoryDecision(category);
  return rulesFor(category).filter(rule => effectiveRuleDecision(rule) !== baseline).length;
}

function enterCustomMode() {
  if (policy.mode === 'custom') return;
  policy.severityDecisions = { ...severityDefaults(policy.mode) };
  policy.mode = 'custom';
}

function setCategoryDecision(category, decision) {
  enterCustomMode();
  policy.categoryOverrides[category] = decision;
  for (const rule of rulesFor(category)) delete policy.ruleOverrides[rule.id];
  saved.value = false;
}

function setRuleDecision(rule, decision) {
  enterCustomMode();
  const inherited = policy.categoryOverrides[rule.category] || baseRuleDecision(rule);
  if (decision === inherited) delete policy.ruleOverrides[rule.id];
  else policy.ruleOverrides[rule.id] = decision;
  saved.value = false;
}

function clearRuleExceptions(category) {
  for (const rule of rulesFor(category)) delete policy.ruleOverrides[rule.id];
  saved.value = false;
}

function setMode(mode) {
  if (mode === 'custom') {
    // Custom freezes the visible preset as its baseline. No category, rule, or
    // output-scanning selection is changed.
    enterCustomMode();
    saved.value = false;
    return;
  }

  policy.mode = mode;
  policy.severityDecisions = { ...presetSeverities[mode] };
  policy.categoryOverrides = {};
  policy.ruleOverrides = mode === 'balanced' ? { ...balancedRuleDefaults } : {};
  saved.value = false;
}

function categoryTooltip(category) {
  return `${categoryMeta(category).description} The Group default is inherited by its rules. Expand Manage rules to add exceptions. ${decisionHelp}`;
}

function ruleTooltip(rule) {
  return `Category: ${format(rule.category)}. Severity: ${format(rule.severity)}. Effective choice: ${format(effectiveRuleDecision(rule))}. ${decisionHelp}`;
}

function compactPolicy() {
  return {
    version: 1,
    mode: policy.mode,
    severityDecisions: { ...(policy.severityDecisions || {}) },
    categoryOverrides: { ...(policy.categoryOverrides || {}) },
    ruleOverrides: { ...(policy.ruleOverrides || {}) },
    outputScanning: policy.outputScanning || 'report',
  };
}

function apply(next) {
  Object.assign(policy, next, {
    severityDecisions: { ...(next.severityDecisions || {}) },
    categoryOverrides: { ...(next.categoryOverrides || {}) },
    ruleOverrides: { ...(next.ruleOverrides || {}) },
    outputScanning: next.outputScanning || 'report',
  });
}

async function load() {
  loading.value = true;
  error.value = '';
  try {
    const result = await securityPolicyService.getPolicy();
    rules.value = result.rules || [];
    apply(result.policy);
    savedSnapshot.value = JSON.stringify(compactPolicy());
  } catch (loadError) {
    error.value = loadError.message;
  } finally {
    loading.value = false;
  }
}

async function save() {
  loading.value = true;
  error.value = '';
  saved.value = false;
  try {
    const result = await securityPolicyService.savePolicy(compactPolicy());
    apply(result.policy);
    savedSnapshot.value = JSON.stringify(compactPolicy());
    saved.value = true;
  } catch (saveError) {
    error.value = saveError.message;
  } finally {
    loading.value = false;
  }
}

async function reset() {
  loading.value = true;
  error.value = '';
  try {
    const result = await securityPolicyService.resetPolicy();
    apply(result.policy);
    savedSnapshot.value = JSON.stringify(compactPolicy());
    saved.value = true;
    expandedCategories.value = new Set();
  } catch (resetError) {
    error.value = resetError.message;
  } finally {
    loading.value = false;
  }
}

onMounted(load);
</script>

<style scoped>
.security-console{display:flex;flex-direction:column;gap:16px;color:var(--color-text)}
.policy-hero{border-radius:10px;display:flex;justify-content:space-between;align-items:center;gap:16px;padding:16px 20px;border:1px solid var(--terminal-border-color-light);background:linear-gradient(135deg,color-mix(in srgb,var(--color-primary) 8%,var(--terminal-section-bg)),var(--terminal-section-bg));position:relative;overflow:hidden}.eyebrow,.section-kicker{font:700 9px var(--font-family-monospace);letter-spacing:.12em;color:var(--color-primary)}.eyebrow i{margin-right:6px}.hero-copy h3,.section-header h3{font-size:16px;margin:4px 0 2px}.hero-copy p,.section-header p{margin:0;color:var(--color-text-muted);font-size:11px;line-height:1.4}.hero-status{display:flex;align-items:center;gap:8px;padding:8px 12px;border:1px solid var(--terminal-border-color-light);background:color-mix(in srgb,var(--terminal-bg) 72%,transparent);z-index:1}.hero-status>div{display:flex;flex-direction:column}.hero-status small{font:700 8px var(--font-family-monospace);color:var(--color-text-muted);letter-spacing:.12em}.hero-status strong{font-size:12px}.status-dot{width:7px;height:7px;border-radius:50%;background:var(--color-green);box-shadow:0 0 8px var(--color-green)}
.mode-grid{display:flex;justify-content:space-between;align-items:stretch;gap:8px;width:100%}.mode-grid :deep(.tooltip-container){height:100%;flex:1 1 0;min-width:0}.mode-card{border-radius:10px;width:100%;height:100%;min-height:64px;display:flex;align-items:center;gap:8px;padding:10px 12px;border:1px solid var(--terminal-border-color-light);background:var(--terminal-section-bg);color:var(--color-text);cursor:pointer;text-align:left;transition:.16s;position:relative}.mode-card:hover{border-color:color-mix(in srgb,var(--color-primary) 60%,var(--terminal-border-color-light));transform:translateY(-1px)}.mode-card.active{border-color:var(--color-primary);box-shadow:inset 0 0 0 1px var(--color-primary),0 6px 18px color-mix(in srgb,var(--color-primary) 10%,transparent)}.mode-icon{display:grid;place-items:center;width:28px;height:28px;flex:0 0 28px;background:color-mix(in srgb,var(--color-primary) 10%,transparent);color:var(--color-primary)}.mode-copy{display:flex;flex-direction:column;gap:2px;min-width:0}.mode-copy strong{font-size:11px}.mode-copy small{font-size:9px;color:var(--color-text-muted)}.selected-mark{position:absolute;right:8px;top:8px;color:var(--color-primary);font-size:11px}
.management-panel{border-radius:10px;border:1px solid var(--terminal-border-color-light);background:var(--terminal-section-bg);padding:16px}.section-header{display:flex;justify-content:space-between;align-items:flex-end;gap:16px;margin-bottom:12px}.section-header.compact{align-items:flex-start;margin-bottom:10px}.legend{display:flex;align-items:center;gap:6px;font:600 8px var(--font-family-monospace);text-transform:uppercase;color:var(--color-text-muted);white-space:nowrap}.legend-line{width:56px;height:2px;background:linear-gradient(90deg,var(--color-green),var(--color-yellow),var(--color-red));border-radius:3px}
.category-stack{display:flex;flex-direction:column;gap:6px}.category-card{border-radius:10px;border:1px solid var(--terminal-border-color-light);background:color-mix(in srgb,var(--terminal-bg) 35%,transparent);transition:.16s}.category-card.open{border-color:color-mix(in srgb,var(--color-primary) 45%,var(--terminal-border-color-light));box-shadow:0 8px 24px rgba(0,0,0,.1)}.category-summary{display:grid;grid-template-columns:minmax(250px,1fr) minmax(220px,310px) 112px;align-items:center;gap:16px;padding:10px 12px}.category-identity{display:flex;align-items:center;gap:10px;border:0;background:transparent;color:inherit;text-align:left;cursor:pointer;min-width:0}.category-icon{display:grid;place-items:center;flex:0 0 30px;height:30px;font-size:12px;border:1px solid var(--terminal-border-color-light);color:var(--color-primary);background:var(--terminal-section-bg)}.category-copy{display:flex;flex-direction:column;gap:3px;min-width:0}.category-title-row{display:flex;align-items:center;gap:8px}.category-title-row strong{font-size:12px}.category-copy small{color:var(--color-text-muted);font-size:10px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.exception-badge{padding:2px 5px;border:1px solid color-mix(in srgb,var(--color-yellow) 45%,transparent);color:var(--color-yellow);font:700 8px var(--font-family-monospace);text-transform:uppercase}.category-policy{display:flex;flex-direction:column;gap:3px}.control-label{font:700 8px var(--font-family-monospace);color:var(--color-text-muted);text-transform:uppercase;letter-spacing:.08em}.expand-button{display:flex;align-items:center;justify-content:space-between;gap:6px;border:1px solid var(--terminal-border-color-light);background:transparent;color:var(--color-text);padding:7px 9px;font-size:10px;cursor:pointer}.expand-button:hover{border-color:var(--color-primary);color:var(--color-primary)}
.rule-panel{border-top:1px solid var(--terminal-border-color-light);background:color-mix(in srgb,var(--terminal-bg) 58%,transparent);padding:10px 16px 14px}.rule-toolbar{display:flex;justify-content:space-between;align-items:center;padding:0 0 8px;border-bottom:1px solid var(--terminal-border-color-light)}.rule-toolbar>div{display:flex;gap:6px;align-items:baseline}.rule-toolbar strong{font-size:11px}.rule-toolbar span{font-size:10px;color:var(--color-text-muted)}.text-button{border:0;background:transparent;color:var(--color-primary);font-size:10px;cursor:pointer}.rule-list{display:flex;flex-direction:column}.rule-row{display:grid;grid-template-columns:minmax(250px,1fr) minmax(220px,310px);align-items:center;gap:20px;padding:9px 0;border-bottom:1px solid color-mix(in srgb,var(--terminal-border-color-light) 65%,transparent)}.rule-row:last-child{border-bottom:0}.rule-copy{display:flex;flex-direction:column;gap:2px;min-width:0}.rule-name-line{display:flex;align-items:center;gap:6px}.rule-name-line strong{font-size:11px}.rule-copy>small{font:500 8px var(--font-family-monospace);color:var(--color-text-muted)}.severity{padding:1px 5px;font:700 7px var(--font-family-monospace);text-transform:uppercase;border:1px solid}.severity.critical{color:var(--color-red);border-color:color-mix(in srgb,var(--color-red) 45%,transparent)}.severity.high{color:var(--color-orange);border-color:color-mix(in srgb,var(--color-orange) 45%,transparent)}.severity.medium{color:var(--color-yellow);border-color:color-mix(in srgb,var(--color-yellow) 45%,transparent)}.severity.low{color:var(--color-green);border-color:color-mix(in srgb,var(--color-green) 45%,transparent)}.info-icon{color:var(--color-text-muted);font-size:10px;cursor:help;opacity:.75}.info-icon:hover{opacity:1}
.lower-grid{display:grid;grid-template-columns:1fr;gap:12px}.section-explainer{display:flex;align-items:flex-start;gap:8px;padding:9px 12px;border:1px solid color-mix(in srgb,var(--color-primary) 28%,var(--terminal-border-color-light));background:color-mix(in srgb,var(--color-primary) 5%,var(--terminal-bg));margin:10px 0}.section-explainer>i{color:var(--color-primary);margin-top:2px}.section-explainer>div{display:flex;flex-direction:column;gap:3px}.section-explainer strong{font-size:10px}.section-explainer p{margin:0;color:var(--color-text-muted);font-size:9px;line-height:1.45}.section-explainer em{color:var(--color-text);font-style:normal;font-weight:700}.section-explainer b{color:var(--color-text);font-weight:700}.output-choice-grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:6px;margin:12px 0 10px}.output-choice{border-radius:10px;position:relative;display:flex;flex-direction:column;align-items:flex-start;gap:6px;min-height:104px;padding:10px 12px;border:1px solid var(--terminal-border-color-light);background:color-mix(in srgb,var(--terminal-bg) 40%,transparent);color:var(--color-text);text-align:left;cursor:pointer;transition:.16s}.output-choice:hover{transform:translateY(-2px);border-color:var(--color-primary)}.output-choice.active.off{border-color:var(--color-red);box-shadow:inset 0 0 0 1px var(--color-red)}.output-choice.active.report{border-color:var(--color-yellow);box-shadow:inset 0 0 0 1px var(--color-yellow)}.output-choice.active.enforce{border-color:var(--color-green);box-shadow:inset 0 0 0 1px var(--color-green)}.output-choice-icon{display:grid;place-items:center;width:26px;height:26px;font-size:12px;border:1px solid var(--terminal-border-color-light)}.output-choice.off .output-choice-icon{color:var(--color-red)}.output-choice.report .output-choice-icon{color:var(--color-yellow)}.output-choice.enforce .output-choice-icon{color:var(--color-green)}.output-choice-copy{display:flex;flex-direction:column;gap:3px}.output-choice-copy strong{font-size:11px}.output-choice-copy small{font-size:9px;line-height:1.4;color:var(--color-text-muted)}.output-choice-check{position:absolute;top:8px;right:8px;font-size:11px}.output-choice.active.off .output-choice-check{color:var(--color-red)}.output-choice.active.report .output-choice-check{color:var(--color-yellow)}.output-choice.active.enforce .output-choice-check{color:var(--color-green)}.output-scale-label{display:flex;justify-content:space-between;margin:0 2px 5px;color:var(--color-text-muted);font:600 8px var(--font-family-monospace);text-transform:uppercase}.output-scale-label span:first-child i{color:var(--color-red)}.output-scale-label span:last-child i{color:var(--color-green)}.output-panel :deep(.level-control){max-width:none;margin:0 0 10px}.active-output-summary{border-radius:10px;display:flex;align-items:center;gap:8px;padding:8px 10px;border:1px solid var(--terminal-border-color-light);background:color-mix(in srgb,var(--terminal-bg) 52%,transparent)}.active-output-summary>i{color:var(--color-primary);font-size:14px}.active-output-summary>div{display:flex;flex-direction:column;gap:2px}.active-output-summary small{font:700 7px var(--font-family-monospace);letter-spacing:.1em;color:var(--color-text-muted)}.active-output-summary strong{font-size:10px;line-height:1.35}.policy-footer{border-radius:0;position:sticky;bottom:0;display:flex;justify-content:space-between;align-items:center;gap:12px;padding:10px 16px;border:1px solid var(--terminal-border-color-light);background:color-mix(in srgb,var(--terminal-bg) 92%,transparent);backdrop-filter:blur(14px);z-index:4}.dirty-state{display:flex;align-items:center;gap:6px;font-size:10px;color:var(--color-text-muted)}.dirty-state>span{width:6px;height:6px;border-radius:50%;background:var(--color-green)}.dirty-state>span.changed{background:var(--color-yellow);box-shadow:0 0 10px var(--color-yellow)}.footer-actions{display:flex;gap:6px}.primary-button,.secondary-button{display:flex;align-items:center;gap:6px;padding:7px 12px;border:1px solid var(--color-primary);font-size:10px;font-weight:700;cursor:pointer}.primary-button{background:var(--color-primary);color:var(--terminal-bg)}.secondary-button{background:transparent;color:var(--color-primary)}.primary-button:disabled,.secondary-button:disabled{opacity:.45;cursor:not-allowed}.notice{border-radius:10px;display:flex;align-items:center;gap:6px;padding:8px 12px;border-left:3px solid;font-size:10px}.notice.error{border-color:var(--color-red);background:color-mix(in srgb,var(--color-red) 8%,transparent)}.notice.success{border-color:var(--color-green);background:color-mix(in srgb,var(--color-green) 8%,transparent)}
@media(max-width:1100px){.mode-grid{flex-wrap:wrap}.mode-grid :deep(.tooltip-container){flex-basis:calc(33.333% - 8px)}.category-summary{grid-template-columns:1fr minmax(240px,320px)}.expand-button{grid-column:1/-1;justify-content:center}.lower-grid{grid-template-columns:1fr}}
@media(max-width:760px){.policy-hero,.section-header,.policy-footer{align-items:flex-start;flex-direction:column}.mode-grid{flex-direction:column;flex-wrap:nowrap}.mode-grid :deep(.tooltip-container){flex-basis:auto;width:100%}.category-summary,.rule-row{grid-template-columns:1fr}.category-policy{width:100%}.legend{display:none}.output-choice-grid{grid-template-columns:1fr}.output-choice{min-height:auto}.footer-actions{width:100%}.footer-actions :deep(.tooltip-container){flex:1}.primary-button,.secondary-button{width:100%;justify-content:center}}
</style>
