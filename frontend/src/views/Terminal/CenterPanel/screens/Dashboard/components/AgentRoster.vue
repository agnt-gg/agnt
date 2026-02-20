<template>
  <div class="agent-roster-section data-section">
    <h4 class="section-title"><i class="fas fa-users"></i> Agent Roster ({{ agents.length }}/{{ maxAgents }})</h4>
    <div class="agents-grid">
      <div v-for="agent in agents" :key="agent.id" class="agent-card">
        <div class="agent-header">
          <span class="agent-name">{{ agent.name }} - Lvl {{ agent.level }}</span>
          <span class="agent-status" :class="agent.status.toLowerCase().replace(' ', '-')">{{ agent.status }}</span>
        </div>
        <div class="agent-xp-bar">
          <div class="xp-fill" :style="{ width: agent.xpPercent + '%' }"></div>
          <span class="xp-text">{{ agent.xp }}/{{ agent.xpToNextLevel }} XP</span>
        </div>
        <div class="agent-details">
          <div class="agent-skills">
            <strong>Skills:</strong>
            <span v-if="agent.skills.length">
              <span v-for="(skill, index) in agent.skills" :key="skill.name" class="skill-tag">
                {{ skill.name }} Lvl {{ skill.level }}{{ index < agent.skills.length - 1 ? ', ' : '' }}
              </span>
            </span>
            <span v-else>None</span>
          </div>
          <div class="agent-tools">
            <strong>Tools:</strong>
            <span v-if="agent.tools.length">
              <span v-for="(tool, index) in agent.tools" :key="tool" class="tool-tag">
                {{ tool }}{{ index < agent.tools.length - 1 ? ', ' : '' }}
              </span>
            </span>
            <span v-else>Basic Gear</span>
          </div>
          <div class="agent-skill-points">
            <strong>Skill Points:</strong> {{ agent.skillPoints }}
          </div>
          <div class="agent-tps">
            <strong>Est. TPS:</strong> {{ agent.tokensPerSecondGenerated?.toFixed(1) || '0.0' }}
          </div>
        </div>
        <button class="upgrade-agent-button clickable" @click="emitAgentUpgrade(agent)">Upgrade Agent</button>
      </div>
      <div v-if="!agents.length" class="empty-state-small">Recruiting initial agents...</div>
    </div>
  </div>
</template>

<script>
export default {
  name: "AgentRoster",
  props: {
    agents: {
      type: Array,
      required: true,
      default: () => []
    },
    maxAgents: {
      type: Number,
      required: true,
      default: 0
    }
  },
  emits: ['upgrade-agent'],
  setup(props, { emit }) {
    const emitAgentUpgrade = (agent) => {
      emit('upgrade-agent', agent);
    };

    return {
      emitAgentUpgrade
    };
  }
};
</script>

<style scoped>
/* Styles from Dashboard.vue relevant to agent roster */
.data-section {
  background: rgba(0,0,0,0.15);
  border: 1px solid rgba(var(--green-rgb), 0.2);
  border-radius: 6px;
  padding: 16px;
}

.section-title {
  color: var(--color-light-green);
  font-size: 1.1em;
  margin: 0 0 12px 0;
  padding-bottom: 8px;
  border-bottom: 1px solid rgba(var(--green-rgb), 0.15);
  display: flex;
  align-items: center;
  gap: 8px;
}
.section-title i {
  color: var(--color-green);
}

.empty-state-small {
    color: var(--color-grey);
    font-style: italic;
    padding: 10px;
    text-align: center;
    font-size: 0.9em;
}

.agents-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(280px, 1fr));
  gap: 12px;
}

.agent-card {
  background: rgba(var(--green-rgb), 0.05);
  border: 1px solid rgba(var(--green-rgb), 0.15);
  border-left: 3px solid var(--color-green);
  border-radius: 4px;
  padding: 10px 12px;
  display: flex;
  flex-direction: column;
  gap: 10px;
  transition: transform 0.2s ease, box-shadow 0.2s ease;
}
.agent-card:hover {
    transform: translateY(-2px);
    box-shadow: 0 2px 8px rgba(25,239,131,0.1);
}

.agent-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
}

.agent-name {
  font-weight: 600;
  color: var(--color-white);
  font-size: 0.95em;
}

.agent-status {
  font-size: 0.8em;
  font-weight: bold;
  padding: 2px 6px;
  border-radius: 3px;
  color: var(--color-primary);
}
.agent-status.idle {
  background-color: var(--color-grey-medium);
}
.agent-status.on-mission {
  background-color: var(--color-orange);
}

.agent-xp-bar {
  width: 100%;
  height: 18px;
  background-color: rgba(0,0,0, 0.3);
  border-radius: 16px;
  position: relative;
  overflow: hidden;
  border: 1px solid rgba(25,239,131,0.1);
}

.xp-fill {
  height: 100%;
  background-color: var(--color-blue);
  border-radius: 2px 0 0 2px;
  transition: width 0.3s ease-in-out;
}
.xp-text {
  position: absolute;
  top: 0;
  left: 50%;
  transform: translateX(-50%);
  color: var(--color-white);
  font-size: 0.75em;
  line-height: 18px;
  font-weight: bold;
  text-shadow: 1px 1px 1px rgba(0,0,0,0.5);
}

.agent-details {
    font-size: 0.8em;
    color: var(--color-grey-light);
    display: flex;
    flex-direction: column;
    gap: 4px;
    border-top: 1px solid rgba(25,239,131,0.1);
    padding-top: 8px;
    margin-top: 6px;
}

.agent-skills strong, .agent-tools strong, .agent-skill-points strong, .agent-tps strong {
    color: var(--color-grey-medium);
    margin-right: 4px;
    font-weight: 600; 
}

.skill-tag, .tool-tag {
    background-color: rgba(255,255,255,0.07);
    padding: 1px 4px;
    border-radius: 2px;
    margin-right: 2px;
    font-style: italic;
    display: inline-block; 
    margin-bottom: 2px;
}

.agent-tps {
  color: var(--color-yellow);
  font-weight: bold;
}

.upgrade-agent-button {
    background-color: var(--color-blue-dark);
    color: var(--color-white);
    border: 1px solid var(--color-blue);
    padding: 6px 10px;
    border-radius: 3px;
    cursor: pointer;
    font-size: 0.85em;
    margin-top: auto;
    transition: background-color 0.2s ease, transform 0.1s ease;
    text-align: center;
}
.upgrade-agent-button:hover {
    background-color: var(--color-blue);
}
.upgrade-agent-button:active {
    transform: scale(0.97);
}

/* Clickable utility class, if needed locally or for other buttons */
.clickable {
  cursor: pointer;
  transition: all 0.2s ease;
}
.clickable:hover {
  filter: brightness(1.2);
}
.clickable:active {
  transform: scale(0.98);
}
</style>
