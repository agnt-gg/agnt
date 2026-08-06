<template>
  <div class="security-activity-panel">
    <div class="activity-heading">
      <div class="heading-row">
        <div>
          <div class="eyebrow">SECURITY ACTIVITY LOG</div>
          <h3>Recent policy decisions</h3>
        </div>
        <Tooltip text="Reload the latest policy decisions from the local security audit log." position="left" width="260px">
          <button type="button" class="refresh-button" :disabled="loading" @click="loadAudit">
            <i :class="['fas fa-sync-alt', { 'fa-spin': loading }]"></i>
          </button>
        </Tooltip>
      </div>
      <p>A read-only history of rules matched during tool and workflow execution.</p>
    </div>

    <div class="log-guide">
      <i class="fas fa-list-alt"></i>
      <div>
        <strong>How to read this log</strong>
        <p><b>Decision</b> shows whether AGNT allowed, audited, or blocked an action. <b>Tool</b> identifies what was running. <b>Matched rules</b> explains why the policy reacted. Commands, payloads, and secrets are never stored.</p>
      </div>
    </div>

    <div v-if="error" class="error-message"><i class="fas fa-exclamation-triangle"></i>{{ error }}</div>

    <div class="column-headings">
      <span>Decision</span>
      <span>Tool and matched rules</span>
      <span>Time</span>
    </div>

    <div v-if="!loading && !events.length" class="empty-state">
      <i class="fas fa-shield-alt"></i>
      <strong>No security events yet</strong>
      <span>Policy decisions will appear here as tools and workflows run.</span>
    </div>

    <div v-else class="activity-list">
      <article v-for="event in events" :key="event.ts + event.toolName + event.action" class="activity-item">
        <span :class="['decision', event.action]">{{ event.action }}</span>
        <div class="event-copy">
          <strong>{{ event.toolName || 'Unknown tool' }}</strong>
          <small>{{ matchedRules(event) }}</small>
        </div>
        <time>{{ shortDate(event.ts) }}</time>
      </article>
    </div>
  </div>
</template>

<script setup>
import { onMounted, ref } from 'vue';
import Tooltip from '@/views/Terminal/_components/Tooltip.vue';
import { securityPolicyService } from '@/services/securityPolicyService.js';

const events = ref([]);
const loading = ref(false);
const error = ref('');

// Naming the argument is what makes a false positive visible here rather than
// only in the log: a rule matching `params.content` is obviously wrong, while
// the same rule matching `command` is obviously right. Falls back to the bare
// rule id for events recorded before the gate reported a field.
const matchedRules = event =>
  event.violations?.map(violation => (violation.field ? `${violation.rule} in ${violation.field}` : violation.rule)).join(', ')
  || 'No matched rules';
const shortDate = value => new Date(value).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });

async function loadAudit() {
  loading.value = true;
  error.value = '';
  try {
    events.value = (await securityPolicyService.getAudit(100)).events || [];
  } catch (loadError) {
    error.value = loadError.message;
  } finally {
    loading.value = false;
  }
}

onMounted(loadAudit);
</script>

<style scoped>
.security-activity-panel{display:flex;flex-direction:column;gap:16px;height:100%;padding:0;color:var(--color-text);overflow:hidden}.activity-heading{border:1px solid var(--terminal-border-color-light);border-radius:12px;background:var(--terminal-section-bg);padding:16px}.heading-row{display:flex;justify-content:space-between;align-items:flex-start;gap:12px}.eyebrow{font:700 9px var(--font-family-monospace);letter-spacing:.12em;color:var(--color-primary)}h3{margin:5px 0 0;font-size:16px}.activity-heading>p{margin:10px 0 0;color:var(--color-text-muted);font-size:11px;line-height:1.5}.refresh-button{display:grid;place-items:center;width:32px;height:32px;border:1px solid var(--terminal-border-color-light);border-radius:8px;background:transparent;color:var(--color-primary);cursor:pointer}.refresh-button:hover{border-color:var(--color-primary)}.refresh-button:disabled{opacity:.5}.log-guide{display:flex;align-items:flex-start;gap:10px;padding:12px;border:1px solid color-mix(in srgb,var(--color-primary) 25%,var(--terminal-border-color-light));border-radius:12px;background:color-mix(in srgb,var(--color-primary) 5%,var(--terminal-bg))}.log-guide>i{color:var(--color-primary);margin-top:2px}.log-guide>div{display:flex;flex-direction:column;gap:5px}.log-guide strong{font-size:11px}.log-guide p{margin:0;color:var(--color-text-muted);font-size:10px;line-height:1.55}.log-guide b{color:var(--color-text)}.column-headings{display:grid;grid-template-columns:58px minmax(0,1fr) auto;gap:8px;padding:0 4px 8px;border-bottom:1px solid var(--terminal-border-color-light);color:var(--color-text-muted);font:700 8px var(--font-family-monospace);letter-spacing:.06em;text-transform:uppercase}.activity-list{flex:1;overflow-y:auto}.activity-item{display:grid;grid-template-columns:58px minmax(0,1fr) auto;align-items:center;gap:8px;padding:12px 4px;border-bottom:1px solid var(--terminal-border-color-light)}.decision{font:700 9px var(--font-family-monospace);text-transform:uppercase}.decision.blocked{color:var(--color-red)}.decision.audit{color:var(--color-yellow)}.decision.allow{color:var(--color-green)}.event-copy{display:flex;flex-direction:column;gap:3px;min-width:0}.event-copy strong{font-size:11px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.event-copy small{color:var(--color-text-muted);font:500 9px var(--font-family-monospace);line-height:1.4;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}time{color:var(--color-text-muted);font-size:9px;white-space:nowrap}.empty-state{display:flex;flex:1;flex-direction:column;align-items:center;justify-content:center;gap:8px;text-align:center;color:var(--color-text-muted)}.empty-state i{font-size:24px;color:var(--color-primary)}.empty-state strong{font-size:12px;color:var(--color-text)}.empty-state span{max-width:220px;font-size:10px;line-height:1.5}.error-message{display:flex;gap:8px;padding:10px 12px;border-left:3px solid var(--color-red);border-radius:8px;background:color-mix(in srgb,var(--color-red) 8%,transparent);font-size:10px}
</style>
