<template>
  <BaseScreen
    ref="baseScreenRef"
    activeRightPanel="DashboardPanel"
    :panelProps="{
      missionId: null,
      showChart: true,
    }"
    screenId="DashboardScreen"
    :showInput="false"
    :terminalLines="terminalLines"
    @submit-input="handleUserInputSubmit"
    @panel-action="handlePanelAction"
    @screen-change="(screenName) => handleScreenChange(screenName)"
    @base-mounted="initializeScreen"
  >
    <!-- Default slot content: Main content for the Dashboard -->
    <template #default>
      <div class="dashboard-content">
        <div class="dashboard-inner-content">
          <TerminalHeader title="My Dashboard" subtitle="Live Operations Feed - AGNT Network Pulse" />

          <!-- Stats Cards Component - Updated Props -->
          <StatsCards
            :agentsActive="simulatedAgentsActive"
            :agentsIdle="simulatedAgentsIdle"
            :missionsPerSecond="simulatedMissionsPerSecond"
            :tokensPerSecond="simulatedTokensPerSecond"
            :totalTokens="simulatedTotalTokens"
          />

          <!-- Chart Component - Updated Props -->
          <ChartCard :tokenActivity="simulatedTokenActivityHistory" :isLoading="simulatedIsLoading" :performanceData="simulatedPerformanceData" />

          <!-- Agent Roster Section -->
          <AgentRoster :agents="simulatedAgents" :maxAgents="maxAgents" @upgrade-agent="handleAgentUpgrade" />

          <!-- Combined Upgrades and Modifiers Section -->
          <UpgradesAndModifiers
            :modifiers="simulatedGlobalModifiers"
            :upgrades="simulatedPermanentUpgrades"
            :totalTokens="simulatedTotalTokens"
            @activate-modifier="activateModifier"
            @purchase-upgrade="purchasePermanentUpgrade"
          />

          <!-- Mission Details Component - Hidden for now -->
          <MissionDetails
            v-if="false && selectedMissionId && selectedMission"
            :mission="selectedMission"
            @close="selectedMissionId = null"
            @log-message="handleLogMessage"
            ref="missionDetailsRef"
          />

          <div ref="scrollAnchorRef" class="scroll-anchor"></div>
        </div>
      </div>
    </template>
  </BaseScreen>

  <!-- Agent Upgrade Modal -->
  <AgentUpgradePopup
    :showModal="showAgentUpgradeModal"
    :agent="agentForUpgradeModal"
    :upgradeOptions="upgradeOptionsForModal"
    @close="closeAgentUpgradeModal"
    @select-upgrade="selectAgentUpgrade"
  />

  <PopupTutorial :config="tutorialConfig" :startTutorial="startTutorial" tutorialId="dashboard" @close="onTutorialClose" />
</template>

<script>
import { ref, onMounted, onUnmounted, nextTick, computed, inject } from 'vue';
import { useStore } from 'vuex';
import { useCleanup } from '@/composables/useCleanup';
import BaseScreen from '../../BaseScreen.vue';
import TerminalHeader from '../../../_components/TerminalHeader.vue';
import StatsCards from './components/StatsCards.vue';
import ChartCard from './components/ChartCard.vue';
import AgentRoster from './components/AgentRoster.vue';
import MissionDetails from './components/MissionDetails.vue';
// AgentActivity is not directly used in Dashboard.vue template, so removing for now if not needed
// import AgentActivity from "./components/AgentActivity.vue";
import PopupTutorial from '@/views/_components/utility/PopupTutorial.vue';
import { useDashboardTutorial } from './useDashboardTutorial.js';
import AgentUpgradePopup from './components/AgentUpgradePopup.vue'; // Import the new component
import UpgradesAndModifiers from './components/UpgradesAndModifiers.vue'; // Import the new combined component

const CHART_HISTORY_LENGTH = 30; // Number of data points for the chart
const BASE_XP_TO_LEVEL = 100;

const AGENT_SKILLS_DEFINITIONS = {
  Scan: { description: 'Ability to gather information and detect anomalies.' },
  Hack: { description: 'Bypassing security systems and accessing restricted data.' },
  Network: { description: 'Manipulating and navigating digital networks.' },
  Stealth: { description: 'Operating undetected, avoiding surveillance.' },
  Security: { description: 'Implementing and managing defensive measures.' },
  Logistics: { description: 'Coordinating resources and movement.' },
  Analysis: { description: 'Interpreting data and identifying patterns.' },
  Crypto: { description: 'Encrypting and decrypting communications.' },
  Decipher: { description: 'Breaking complex codes and encrypted messages.' },
  Firewall: { description: 'Managing and breaching network firewalls.' },
  Trace: { description: 'Tracking digital footprints and origins.' },
  Exploit: { description: 'Utilizing vulnerabilities in systems.' },
};
const AGENT_SKILLS_LIST = Object.keys(AGENT_SKILLS_DEFINITIONS);

const AGENT_TOOLS_LIST = [
  'Standard Issue Laptop',
  'Encrypted Comms Unit',
  'Multi-tool',
  'Optical Camo Fabric',
  'Portable Power Cell',
  'Logic Probe',
  'Data Scrubber',
];

const AGENT_ENHANCEMENT_DEFINITIONS = {
  agentSpeed: {
    id: 'agentSpeed',
    namePrefix: 'Efficiency Core',
    descriptionFormat: '+{VALUE}% Mission Speed',
    baseValuePerTier: 10, // e.g., 10% per tier
    costsByTier: [1, 2, 4, 7], // Cost for T1, T2, T3, T4
    maxTier: 4, // Changed from 5 to 4
    type: 'agent_speed_multiplier',
    icon: 'fas fa-tachometer-alt', // Example icon
  },
  agentXPGain: {
    id: 'agentXPGain',
    namePrefix: 'Cognitive Matrix',
    descriptionFormat: '+{VALUE}% XP Gain',
    baseValuePerTier: 15, // e.g., 15% per tier
    costsByTier: [1, 3, 5, 9], // Cost for T1, T2, T3, T4 - Already correct for 4 tiers
    maxTier: 4, // Remains 4
    type: 'agent_xp_multiplier',
    icon: 'fas fa-brain', // Example icon
  },
};

export default {
  name: 'DashboardScreen',
  components: {
    BaseScreen,
    TerminalHeader,
    StatsCards,
    ChartCard,
    AgentRoster,
    MissionDetails,
    // AgentActivity,
    PopupTutorial,
    AgentUpgradePopup,
    UpgradesAndModifiers, // Register the new combined component
  },
  emits: ['screen-change'],
  setup(props, { emit }) {
    const store = useStore();
    const cleanup = useCleanup();
    const baseScreenRef = ref(null);
    const selectedMissionId = ref(null); // Keep for panelProps, but details view is hidden
    const terminalLines = ref([]);
    const missionDetailsRef = ref(null);
    const scrollAnchorRef = ref(null);

    const playSound = inject('playSound');

    // --- Simulated Data for StatsCards & ChartCard ---
    const simulatedAgentsActive = ref(0);
    const simulatedAgentsIdle = ref(0);
    const simulatedMissionsPerSecond = ref(0);
    const simulatedTokensPerSecond = ref(0);
    const simulatedTotalTokens = ref(1000); // Start with some tokens

    const simulatedTokenActivityHistory = ref({
      labels: Array(CHART_HISTORY_LENGTH)
        .fill('')
        .map((_, i) => i.toString()),
      earned: Array(CHART_HISTORY_LENGTH).fill(0),
      spent: Array(CHART_HISTORY_LENGTH).fill(0),
    });
    const simulatedIsLoading = ref(false); // Chart loading state
    const simulatedPerformanceData = ref({
      dynamicInsight: 'Optimizing network flow...',
      efficiencyScore: 75,
    });

    const simulatedAgents = ref([]);
    const simulatedGlobalModifiers = ref([
      {
        id: 'tokenBoost1',
        name: 'Token Output I',
        effectDescription: '+10% Tokens/Sec',
        isActive: false,
        durationLeft: 0,
        initialDuration: 0,
        cost: 500,
        canActivate: true,
        bonusMultiplier: 0.1,
        type: 'token_flat_multiplier',
      },
      {
        id: 'xpBoost1',
        name: 'Agent XP Gain I',
        effectDescription: '+15% Agent XP',
        isActive: false,
        durationLeft: 0,
        initialDuration: 0,
        cost: 750,
        canActivate: true,
        bonusMultiplier: 0.15,
        type: 'xp_multiplier',
      },
      {
        id: 'missionSpeed1',
        name: 'Mission Cyc. Rate I',
        effectDescription: '+5% Mission Speed',
        isActive: false,
        durationLeft: 0,
        initialDuration: 0,
        cost: 1000,
        canActivate: true,
        bonusMultiplier: 0.05,
        type: 'mission_speed_multiplier',
      },
      {
        id: 'tokenBoost2',
        name: 'Token Output II',
        effectDescription: '+25% Tokens/Sec',
        isActive: false,
        durationLeft: 0,
        initialDuration: 0,
        cost: 2500,
        canActivate: true,
        bonusMultiplier: 0.25,
        type: 'token_flat_multiplier',
      },
      {
        id: 'xpBoost2',
        name: 'Agent XP Gain II',
        effectDescription: '+35% Agent XP',
        isActive: false,
        durationLeft: 0,
        initialDuration: 0,
        cost: 3500,
        canActivate: true,
        bonusMultiplier: 0.35,
        type: 'xp_multiplier',
      },
      {
        id: 'missionSpeed2',
        name: 'Mission Cyc. Rate II',
        effectDescription: '+15% Mission Speed',
        isActive: false,
        durationLeft: 0,
        initialDuration: 0,
        cost: 5000,
        canActivate: true,
        bonusMultiplier: 0.15,
        type: 'mission_speed_multiplier',
      },
      {
        id: 'agentEfficiency',
        name: 'Agent Efficiency',
        effectDescription: '+50% All Gains',
        isActive: false,
        durationLeft: 0,
        initialDuration: 0,
        cost: 10000,
        canActivate: true,
        bonusMultiplier: 0.5,
        type: 'all_gains_multiplier',
      },
      {
        id: 'tokenBoost3',
        name: 'Token Output III',
        effectDescription: '+100% Tokens/Sec',
        isActive: false,
        durationLeft: 0,
        initialDuration: 0,
        cost: 25000,
        canActivate: true,
        bonusMultiplier: 1.0,
        type: 'token_flat_multiplier',
      },
      {
        id: 'chronosAccelerator',
        name: 'Chronos Accelerator',
        effectDescription: '+30% Mission Speed',
        isActive: false,
        durationLeft: 0,
        initialDuration: 0,
        cost: 50000,
        canActivate: true,
        bonusMultiplier: 0.3,
        type: 'mission_speed_multiplier',
      },
    ]);

    // Add permanent upgrades
    const simulatedPermanentUpgrades = ref([
      {
        id: 'autoRecruit',
        name: 'Auto Recruitment',
        description: 'Automatically recruit new agents',
        cost: 5000,
        purchased: false,
        type: 'auto_recruit',
      },
      {
        id: 'skillAutomator',
        name: 'Skill Automator',
        description: 'Automates Agent Skill Upgrades.',
        cost: 8000,
        purchased: false,
        type: 'skill_automator',
      },
      { id: 'missionBonus', name: 'Mission Multiplier', description: '+20% Mission Rewards', cost: 12000, purchased: false, type: 'mission_bonus' },
      { id: 'agentCapacity', name: 'Extended Roster', description: '+4 Max Agents', cost: 20000, purchased: false, type: 'agent_capacity' },
      {
        id: 'autoActivateModifiers',
        name: 'Automated Command Core',
        description: 'Automates Global Modifier Activation.',
        cost: 30000,
        purchased: false,
        type: 'auto_activate_modifiers',
      },
      { id: 'megaBoost', name: 'Quantum Processors', description: '2x All Production', cost: 50000, purchased: false, type: 'mega_boost' },
    ]);

    let agentIdCounter = 0;
    const maxAgents = ref(8); // Make this reactive

    const agentForUpgradeModal = ref(null); // To store the agent whose upgrade modal is (conceptually) open
    const upgradeOptionsForModal = ref([]); // To store available upgrade options for that agent
    const showAgentUpgradeModal = ref(false); // Controls modal visibility

    const getAgentName = () => {
      const prefixes = ['Alpha', 'Beta', 'Gamma', 'Delta', 'Epsilon', 'Zeta', 'Eta', 'Theta'];
      const suffixes = ['One', 'Two', 'Three', 'Prime', 'Core', 'Unit', 'Node', 'Byte'];
      return `${prefixes[Math.floor(Math.random() * prefixes.length)]}-${suffixes[Math.floor(Math.random() * suffixes.length)]}`;
    };

    const addNewAgent = () => {
      if (simulatedAgents.value.length < maxAgents.value) {
        agentIdCounter++;
        const initialSkillsData = [];
        const skillsToGrant = Math.random() < 0.4 ? 2 : 1;
        const availableSkills = [...AGENT_SKILLS_LIST];
        for (let i = 0; i < skillsToGrant; i++) {
          if (availableSkills.length === 0) break;
          const randomIndex = Math.floor(Math.random() * availableSkills.length);
          const skillName = availableSkills.splice(randomIndex, 1)[0];
          initialSkillsData.push({ name: skillName, level: 1 });
        }

        const initialTools = [];
        if (Math.random() < 0.6) {
          initialTools.push(AGENT_TOOLS_LIST[Math.floor(Math.random() * AGENT_TOOLS_LIST.length)]);
        }

        simulatedAgents.value.push({
          id: agentIdCounter,
          name: getAgentName(),
          level: 1,
          xp: 0,
          xpToNextLevel: BASE_XP_TO_LEVEL,
          xpPercent: 0,
          status: 'Idle', // Idle, OnMission, Returning
          currentMissionId: null,
          skills: initialSkillsData, // Array of { name: string, level: number } - These are base skills
          tools: initialTools,
          skillPoints: 1,
          enhancements: [], // New: Array of { enhancementId: string, currentTier: number }
          tokensPerSecondGenerated: 0, // New: For individual agent TPS display
        });
      }
    };

    const activateModifier = (modifier) => {
      if (simulatedTotalTokens.value >= modifier.cost && !modifier.isActive) {
        simulatedTotalTokens.value -= modifier.cost;
        modifier.isActive = true;
        const DURATION = 60; // Define the duration
        modifier.durationLeft = DURATION;
        modifier.initialDuration = DURATION; // Set initialDuration here
        terminalLines.value.push({ text: `Activated ${modifier.name}!`, type: 'success' });
      } else if (simulatedTotalTokens.value < modifier.cost) {
        terminalLines.value.push({ text: `Not enough tokens to activate ${modifier.name}.`, type: 'error' });
      }
    };

    const applySelectedAgentUpgrade = (agent, chosenTierOption) => {
      if (!agent || !chosenTierOption) {
        terminalLines.value.push({ text: `Enhancement selection error.`, type: 'error', entity: 'agent' });
        return false; // Return false on failure
      }
      // Redundant check, already handled by click condition, but good for safety
      if (agent.skillPoints < chosenTierOption.cost) {
        terminalLines.value.push({
          text: `${agent.name} does not have enough skill points for ${chosenTierOption.name}. (Cost: ${chosenTierOption.cost} SP)`,
          type: 'warning',
          entity: 'agent',
        });
        return false; // Return false on failure
      }

      const definition = AGENT_ENHANCEMENT_DEFINITIONS[chosenTierOption.enhancementId];
      if (!definition) {
        terminalLines.value.push({ text: `Enhancement definition not found for ${chosenTierOption.enhancementId}.`, type: 'error', entity: 'agent' });
        return false; // Return false on failure
      }

      agent.skillPoints -= chosenTierOption.cost;

      let existingEnhancement = agent.enhancements.find((e) => e.enhancementId === chosenTierOption.enhancementId);
      if (existingEnhancement) {
        // Ensure we are setting to the new, potentially higher tier
        existingEnhancement.currentTier = Math.max(existingEnhancement.currentTier, chosenTierOption.tier);
      } else {
        agent.enhancements.push({ enhancementId: chosenTierOption.enhancementId, currentTier: chosenTierOption.tier });
      }

      terminalLines.value.push({
        text: `${agent.name} ${chosenTierOption.automated ? '[AUTO] ' : ''}upgraded ${definition.namePrefix} to Tier ${chosenTierOption.tier}!`,
        type: 'success',
        entity: 'agent',
      });
      terminalLines.value.push({ text: `Skill points remaining for ${agent.name}: ${agent.skillPoints}`, type: 'info', entity: 'agent' });

      // If called from manual upgrade, refresh modal. Automation doesn't need this.
      if (!chosenTierOption.automated && showAgentUpgradeModal.value && agentForUpgradeModal.value && agentForUpgradeModal.value.id === agent.id) {
        handleAgentUpgrade(agent);
      }
      return true; // Return true on success
    };

    const handleAgentUpgrade = (agent) => {
      agentForUpgradeModal.value = agent; // Set the agent for the modal immediately

      upgradeOptionsForModal.value = getAgentAvailableEnhancements(agent);

      // Only set showAgentUpgradeModal to true if it's not already shown
      // This prevents re-triggering modal appearance animation if it's just a refresh
      if (!showAgentUpgradeModal.value) {
        showAgentUpgradeModal.value = true;
      }
    };

    const getAgentAvailableEnhancements = (agent) => {
      const availableOptions = [];
      for (const enhId in AGENT_ENHANCEMENT_DEFINITIONS) {
        const definition = AGENT_ENHANCEMENT_DEFINITIONS[enhId];
        const agentEnhancementState = agent.enhancements.find((e) => e.enhancementId === enhId);
        const highestPurchasedTier = agentEnhancementState ? agentEnhancementState.currentTier : 0;

        for (let tier = 1; tier <= definition.maxTier; tier++) {
          const costForThisTier = definition.costsByTier[tier - 1];

          if (costForThisTier === undefined) {
            console.error(`Cost not defined for ${enhId} Tier ${tier}`);
            continue;
          }

          const isPurchased = highestPurchasedTier >= tier;
          // For automation, we only care about affordability if it's the *next* tier.
          // The modal needs to show all, but automation is more direct.
          const canAffordThisTier = agent.skillPoints >= costForThisTier;
          const isPrerequisiteMet = tier === 1 || highestPurchasedTier >= tier - 1;

          const effectValue = definition.baseValuePerTier * tier;
          const displayEffect = definition.descriptionFormat.replace('{VALUE}', effectValue.toString());

          availableOptions.push({
            enhancementId: enhId,
            name: `${definition.namePrefix} T${tier}`,
            description: displayEffect,
            cost: costForThisTier,
            tier: tier,
            icon: definition.icon || 'fas fa-cog',
            isPurchased: isPurchased,
            isAffordable: !isPurchased && canAffordThisTier && isPrerequisiteMet, // Affordability for UI
            prerequisiteMet: isPrerequisiteMet,
            // For automation:
            canBeAutoPurchased: !isPurchased && canAffordThisTier && isPrerequisiteMet,
          });
        }
      }
      return availableOptions;
    };

    const selectAgentUpgrade = (option) => {
      if (!agentForUpgradeModal.value || !option) {
        terminalLines.value.push({ text: `Upgrade selection error. Agent or option missing.`, type: 'error', entity: 'agent' });
        return;
      }

      const agent = agentForUpgradeModal.value; // Get current agent state

      // Check if already purchased (this should ideally be prevented by UI click logic but good safeguard)
      if (option.isPurchased) {
        terminalLines.value.push({ text: `${option.name} is already purchased for ${agent.name}.`, type: 'info', entity: 'agent' });
        return;
      }

      // Check prerequisites (also should be prevented by UI click logic)
      // The option.prerequisiteMet flag is static from when the modal opened, but it reflects a static game rule.
      if (option.tier > 1 && !option.prerequisiteMet) {
        terminalLines.value.push({
          text: `${option.name} for ${agent.name} - prerequisite Tier ${option.tier - 1} not met.`,
          type: 'warning',
          entity: 'agent',
        });
        return;
      }

      // CRITICAL CHECK: Use live agent skill points for affordability
      if (agent.skillPoints >= option.cost) {
        applySelectedAgentUpgrade(agent, option);
      } else {
        // This case should ideally not be reached if the popup's click logic is in sync,
        // but serves as a final gatekeeper if SP changed between click and this handler.
        terminalLines.value.push({
          text: `Not enough skill points for ${option.name}. Needs ${option.cost} SP, has ${agent.skillPoints} SP.`,
          type: 'warning',
          entity: 'agent',
        });
      }
    };

    const closeAgentUpgradeModal = () => {
      showAgentUpgradeModal.value = false;
      agentForUpgradeModal.value = null;
      upgradeOptionsForModal.value = [];
    };

    const purchasePermanentUpgrade = (upgrade) => {
      if (simulatedTotalTokens.value >= upgrade.cost && !upgrade.purchased) {
        simulatedTotalTokens.value -= upgrade.cost;
        upgrade.purchased = true;
        terminalLines.value.push({ text: `Purchased ${upgrade.name}! ${upgrade.description}`, type: 'success' });

        // Apply upgrade effects
        if (upgrade.type === 'agent_capacity') {
          maxAgents.value += 4;
        }
        // Other upgrade effects can be applied in the simulation loops
      } else if (upgrade.purchased) {
        terminalLines.value.push({ text: `${upgrade.name} already purchased.`, type: 'warning' });
      } else {
        terminalLines.value.push({ text: `Not enough tokens for ${upgrade.name}.`, type: 'error' });
      }
    };

    const startSimulations = () => {
      addNewAgent();
      if (Math.random() < 0.5) addNewAgent();

      cleanup.setInterval(() => {
        // Main StatsCards simulation
        const activeAgentsCount = simulatedAgents.value.filter((a) => a.status === 'On Mission').length;
        const idleAgentsCount = simulatedAgents.value.length - activeAgentsCount;
        simulatedAgentsActive.value = activeAgentsCount;
        simulatedAgentsIdle.value = idleAgentsCount;

        let effectiveTotalSkillLevels = 0;
        simulatedAgents.value.forEach((agent) => {
          let agentSkillSum = 0;
          agent.skills.forEach((skill) => (agentSkillSum += skill.level));

          // Apply agent-specific speed enhancements directly to their skill sum contribution
          agent.enhancements.forEach((enh) => {
            const def = AGENT_ENHANCEMENT_DEFINITIONS[enh.enhancementId];
            if (def && def.type === 'agent_speed_multiplier') {
              agentSkillSum *= 1 + (def.baseValuePerTier / 100) * enh.currentTier; // Full effect applied
            }
          });

          if (agent.status === 'On Mission') {
            effectiveTotalSkillLevels += agentSkillSum;
          } else {
            effectiveTotalSkillLevels += agentSkillSum * 0.25;
          }
        });
        const agentSkillBoostFactor = 1 + effectiveTotalSkillLevels * 0.02; // Increased skill impact

        let missionRateBase =
          (activeAgentsCount * 0.8 + simulatedAgents.value.length * 0.1 + effectiveTotalSkillLevels * 0.05) * (Math.random() * 0.4 + 0.8);
        missionRateBase *= agentSkillBoostFactor;

        // Apply modifiers
        simulatedGlobalModifiers.value.forEach((mod) => {
          if (mod.isActive) {
            if (mod.type === 'mission_speed_multiplier') missionRateBase *= 1 + mod.bonusMultiplier;
            if (mod.type === 'all_gains_multiplier') missionRateBase *= 1 + mod.bonusMultiplier;
          }
        });

        // Apply permanent upgrades
        simulatedPermanentUpgrades.value.forEach((upgrade) => {
          if (upgrade.purchased) {
            if (upgrade.type === 'mission_bonus') missionRateBase *= 1.2;
            if (upgrade.type === 'mega_boost') missionRateBase *= 2;
          }
        });

        simulatedMissionsPerSecond.value = parseFloat(Math.max(0.1, missionRateBase).toFixed(1));

        let tokenRateBase = simulatedMissionsPerSecond.value * (Math.random() * 25 + 20 + effectiveTotalSkillLevels * 0.8);
        tokenRateBase *= agentSkillBoostFactor;

        // Apply modifiers
        simulatedGlobalModifiers.value.forEach((mod) => {
          if (mod.isActive) {
            if (mod.type === 'token_flat_multiplier') tokenRateBase *= 1 + mod.bonusMultiplier;
            if (mod.type === 'all_gains_multiplier') tokenRateBase *= 1 + mod.bonusMultiplier;
          }
        });

        // Apply permanent upgrades
        simulatedPermanentUpgrades.value.forEach((upgrade) => {
          if (upgrade.purchased) {
            if (upgrade.type === 'mission_bonus') tokenRateBase *= 1.2;
            if (upgrade.type === 'mega_boost') tokenRateBase *= 2;
          }
        });

        simulatedTokensPerSecond.value = parseFloat(Math.max(1, tokenRateBase).toFixed(0));

        // Calculate and assign individual agent TPS
        let totalPowerOfActiveAgents = 0;
        const activeAgentsWithPower = [];

        simulatedAgents.value.forEach((agent) => {
          if (agent.status === 'On Mission') {
            let agentSkillSumBase = 0;
            agent.skills.forEach((skill) => (agentSkillSumBase += skill.level));

            let currentAgentPower = agentSkillSumBase;
            agent.enhancements.forEach((enh) => {
              const def = AGENT_ENHANCEMENT_DEFINITIONS[enh.enhancementId];
              if (def && def.type === 'agent_speed_multiplier') {
                currentAgentPower *= 1 + (def.baseValuePerTier / 100) * enh.currentTier;
              }
            });
            activeAgentsWithPower.push({ agent, power: currentAgentPower });
            totalPowerOfActiveAgents += currentAgentPower;
          } else {
            agent.tokensPerSecondGenerated = 0;
          }
        });

        if (totalPowerOfActiveAgents > 0 && simulatedTokensPerSecond.value > 0) {
          activeAgentsWithPower.forEach(({ agent, power }) => {
            agent.tokensPerSecondGenerated = parseFloat(((power / totalPowerOfActiveAgents) * simulatedTokensPerSecond.value).toFixed(1));
          });
        } else {
          activeAgentsWithPower.forEach(({ agent }) => {
            // Handles case if no active agents or 0 global TPS
            agent.tokensPerSecondGenerated = 0;
          });
          // Also ensure idle agents (or all agents if no active ones) are set to 0
          simulatedAgents.value.filter((a) => a.status !== 'On Mission').forEach((a) => (a.tokensPerSecondGenerated = 0));
        }
      }, 500); // Faster updates

      cleanup.setInterval(() => {
        // Total Tokens & Chart
        simulatedTotalTokens.value += simulatedTokensPerSecond.value;
        const newEarned = simulatedTokensPerSecond.value;
        const newSpent = Math.max(0, Math.random() * newEarned * 0.02); // Tiny fraction spent

        simulatedTokenActivityHistory.value = {
          labels: [...simulatedTokenActivityHistory.value.labels.slice(1), new Date().toLocaleTimeString().split(' ')[0]],
          earned: [...simulatedTokenActivityHistory.value.earned.slice(1), Math.max(0, newEarned)],
          spent: [...simulatedTokenActivityHistory.value.spent.slice(1), Math.max(0, newSpent)],
        };
      }, 1000);

      cleanup.setInterval(() => {
        // Performance Insights
        const insights = [
          'Network stable.',
          'Flux capacitors nominal.',
          'Agent morale high.',
          'Data flow optimal.',
          'Cognitive load balanced.',
          'Quantum cores synced.',
          'Neural nets optimized.',
        ];
        simulatedPerformanceData.value = {
          dynamicInsight: insights[Math.floor(Math.random() * insights.length)],
          efficiencyScore: Math.floor(Math.random() * 15 + 85), // 85-99%
        };
      }, 3000);

      cleanup.setInterval(() => {
        // Agent Simulation (XP, Level Up, Status)
        let missionAssignments = Math.ceil(simulatedMissionsPerSecond.value * 0.8); // More active agents
        let currentlyOnMission = simulatedAgents.value.filter((a) => a.status === 'On Mission').length;

        simulatedAgents.value.forEach((agent) => {
          if (agent.status === 'On Mission') {
            let xpFromMission =
              (15 + agent.level * 3) * (Math.random() * 0.5 + 0.75) * (simulatedMissionsPerSecond.value / Math.max(1, simulatedAgentsActive.value));

            // Apply Agent-Specific XP Gain Enhancements
            let xpMultiplierFromEnhancements = 1;
            agent.enhancements.forEach((enh) => {
              const def = AGENT_ENHANCEMENT_DEFINITIONS[enh.enhancementId];
              if (def && def.type === 'agent_xp_multiplier') {
                xpMultiplierFromEnhancements += (def.baseValuePerTier / 100) * enh.currentTier;
              }
            });
            xpFromMission *= xpMultiplierFromEnhancements;

            // Apply global XP modifiers
            simulatedGlobalModifiers.value.forEach((mod) => {
              if (mod.isActive) {
                if (mod.type === 'xp_multiplier') xpFromMission *= 1 + mod.bonusMultiplier;
                if (mod.type === 'all_gains_multiplier') xpFromMission *= 1 + mod.bonusMultiplier;
              }
            });

            agent.xp += Math.max(1, Math.floor(xpFromMission));

            if (agent.xp >= agent.xpToNextLevel) {
              agent.level++;
              let skillPointsGained = 1;

              // Check for skill bonus upgrade - REMOVED, replaced by skillAutomator
              // simulatedPermanentUpgrades.value.forEach(upgrade => {
              //     if (upgrade.purchased && upgrade.type === 'skill_bonus') {
              //         skillPointsGained += 1;
              //     }
              // });

              agent.skillPoints += skillPointsGained;
              agent.xp -= agent.xpToNextLevel;
              agent.xpToNextLevel = Math.floor(BASE_XP_TO_LEVEL * Math.pow(1.2, agent.level - 1) + agent.level * 75);
              terminalLines.value.push({
                text: `${agent.name} reached Level ${agent.level}! Gained ${skillPointsGained} Skill Point(s). Current SP: ${agent.skillPoints}`,
                type: 'success',
                entity: 'agent',
              });
            }
          }
          agent.xpPercent = Math.min(100, (agent.xp / agent.xpToNextLevel) * 100);

          // Agent Status Logic
          if (agent.status === 'On Mission') {
            if (currentlyOnMission > missionAssignments && Math.random() < 0.3) {
              agent.status = 'Idle';
              currentlyOnMission--;
            } else if (Math.random() < 0.1) {
              agent.status = 'Idle';
              currentlyOnMission--;
            }
          } else {
            // Agent is Idle
            if (currentlyOnMission < missionAssignments && Math.random() < 0.85) {
              agent.status = 'On Mission';
              currentlyOnMission++;
            }
          }
        });

        // Auto recruitment with upgrade
        const autoRecruitUpgrade = simulatedPermanentUpgrades.value.find((u) => u.id === 'autoRecruit');
        const recruitmentCost = (simulatedAgents.value.length + 1) * 1500;
        const shouldAutoRecruit = autoRecruitUpgrade?.purchased && simulatedTotalTokens.value > recruitmentCost * 2;

        if (simulatedAgents.value.length < maxAgents.value) {
          const naturalRecruitChance = simulatedTotalTokens.value > recruitmentCost && Math.random() < 0.02;

          if (shouldAutoRecruit || naturalRecruitChance) {
            if (shouldAutoRecruit) {
              simulatedTotalTokens.value -= recruitmentCost;
              terminalLines.value.push({
                text: `Auto-recruited new agent for ${recruitmentCost}T! Roster: ${simulatedAgents.value.length + 1}/${maxAgents.value}`,
                type: 'success',
                entity: 'agent',
              });
            } else {
              terminalLines.value.push({
                text: `New agent prospect identified! Roster: ${simulatedAgents.value.length + 1}/${maxAgents.value}`,
                type: 'info',
                entity: 'agent',
              });
            }
            addNewAgent();
          }
        }

        // REMOVE Auto-activate modifiers and Skill Automator from here
        // const autoActivateUpgrade = simulatedPermanentUpgrades.value.find(u => u.id === 'autoActivateModifiers');
        // if (autoActivateUpgrade?.purchased) {
        //   simulatedGlobalModifiers.value.forEach(modifier => {
        //     if (!modifier.isActive && modifier.canActivate && simulatedTotalTokens.value >= modifier.cost) {
        //       activateModifier(modifier);
        //     }
        //   });
        // }

        // const skillAutomatorUpgrade = simulatedPermanentUpgrades.value.find(u => u.id === 'skillAutomator');
        // if (skillAutomatorUpgrade?.purchased) {
        //     simulatedAgents.value.forEach(agent => {
        //         let purchasedSomethingForThisAgent = true;
        //         while(agent.skillPoints > 0 && purchasedSomethingForThisAgent) {
        //             purchasedSomethingForThisAgent = false;
        //             const availableEnhancements = getAgentAvailableEnhancements(agent);
        //             const priorityOrder = ['agentSpeed', 'agentXPGain'];
        //             for (const enhIdToPrioritize of priorityOrder) {
        //                 const enhancementTiers = availableEnhancements
        //                     .filter(e => e.enhancementId === enhIdToPrioritize && e.canBeAutoPurchased)
        //                     .sort((a, b) => a.tier - b.tier);
        //                 if (enhancementTiers.length > 0) {
        //                     const upgradeToBuy = enhancementTiers[0];
        //                     if (agent.skillPoints >= upgradeToBuy.cost) {
        //                         const success = applySelectedAgentUpgrade(agent, { ...upgradeToBuy, automated: true });
        //                         if (success) {
        //                             purchasedSomethingForThisAgent = true;
        //                             break;
        //                         }
        //                     }
        //                 }
        //             }
        //              if (purchasedSomethingForThisAgent) continue;
        //         }
        //     });
        // }
      }, 800);

      // ADD new/restored interval for modifier durations, auto-activation, and skill automation
      cleanup.setInterval(() => {
        // 1. Modifier Durations
        simulatedGlobalModifiers.value.forEach((mod) => {
          if (mod.isActive) {
            mod.durationLeft--;
            if (mod.durationLeft <= 0) {
              mod.isActive = false;
              mod.durationLeft = 0;
              mod.initialDuration = 0; // Reset initial duration when expired
              terminalLines.value.push({ text: `${mod.name} has expired.`, type: 'warning' });
            }
          }
        });

        // 2. Auto-activate modifiers if upgrade is purchased
        const autoActivateUpgrade = simulatedPermanentUpgrades.value.find((u) => u.id === 'autoActivateModifiers');
        if (autoActivateUpgrade?.purchased) {
          simulatedGlobalModifiers.value.forEach((modifier) => {
            if (!modifier.isActive && modifier.canActivate && simulatedTotalTokens.value >= modifier.cost) {
              activateModifier(modifier);
            }
          });
        }

        // 3. Skill Automator Logic
        const skillAutomatorUpgrade = simulatedPermanentUpgrades.value.find((u) => u.id === 'skillAutomator');
        if (skillAutomatorUpgrade?.purchased) {
          simulatedAgents.value.forEach((agent) => {
            let purchasedSomethingForThisAgent = true; // Loop while we are successfully purchasing
            while (agent.skillPoints > 0 && purchasedSomethingForThisAgent) {
              purchasedSomethingForThisAgent = false; // Assume no purchase this iteration
              const availableEnhancements = getAgentAvailableEnhancements(agent);

              const priorityOrder = ['agentSpeed', 'agentXPGain'];

              for (const enhIdToPrioritize of priorityOrder) {
                const enhancementTiers = availableEnhancements
                  .filter((e) => e.enhancementId === enhIdToPrioritize && e.canBeAutoPurchased)
                  .sort((a, b) => a.tier - b.tier); // Lowest tier first

                if (enhancementTiers.length > 0) {
                  const upgradeToBuy = enhancementTiers[0];
                  if (agent.skillPoints >= upgradeToBuy.cost) {
                    const success = applySelectedAgentUpgrade(agent, { ...upgradeToBuy, automated: true });
                    if (success) {
                      purchasedSomethingForThisAgent = true;
                      break;
                    }
                  }
                }
              }
              if (purchasedSomethingForThisAgent) continue;
            }
          });
        }
      }, 1000); // This interval runs every 1 second
    };

    // --- Original Computed Properties (mostly for reference or if Vuex is used later) ---
    // const tokenActivity = computed( // This would be replaced by simulatedTokenActivityHistory
    //   () => store.getters["userStats/tokenActivity"]
    // );
    // const isLoading = computed( // This would be replaced by simulatedIsLoading
    //   () => store.getters["userStats/isActivityLoading"]
    // );
    // const performanceData = computed(() => ({ // This would be replaced by simulatedPerformanceData
    //   missedTokens: store.getters["userStats/missedTokensYesterday"] || 0,
    //   roiPercentage: store.getters["userStats/roiPercentage"] || 0,
    // }));

    // Selected Mission (panel might still use it, details view is hidden)
    const selectedMission = computed(() => {
      if (!selectedMissionId.value) return null;
      return store.getters['missions/getMissionById'](selectedMissionId.value);
    });

    const handleScreenChange = (screenName) => {
      emit('screen-change', screenName);
    };

    const handleUserInputSubmit = (input) => {
      terminalLines.value.push({ text: `> ${input}`, type: 'input' });
      // Basic command handling for tutorial or future use
      if (input.toLowerCase() === 'help') {
        terminalLines.value.push({ text: 'Available commands: help, tutorial, clear', type: 'response' });
      } else if (input.toLowerCase() === 'tutorial') {
        terminalLines.value.push({ text: 'Starting tutorial...', type: 'response' });
        startTutorial.value = true;
      } else if (input.toLowerCase() === 'clear') {
        terminalLines.value = [];
      } else {
        terminalLines.value.push({ text: "Command not recognized. Type 'help'.", type: 'error' });
      }
      baseScreenRef.value?.scrollToBottom();
    };

    const handleLogMessage = (message) => {
      terminalLines.value.push(message); // Assuming message is an object {text, type}
      baseScreenRef.value?.scrollToBottom();
    };

    const handlePanelAction = async (action, payload) => {
      // Panel actions will likely change significantly with new game mechanics
      switch (action) {
        case 'log-message':
          terminalLines.value.push(payload);
          break;
        // case "boost-purchased": // Example, will be tied to new Global Modifiers
        //   await store.dispatch("userStats/fetchStats"); // Or a new game state action
        //   terminalLines.value.push(
        //     `Purchased ${payload.multiplier} boost for ${payload.duration}`
        //   );
        //   break;
        case 'mission-selected': // This might be repurposed or removed if panel doesn't select missions anymore
          // handleMissionSelected(payload);
          break;
        case 'refresh-dashboard': // This might fetch real data if we switch from simulation
          terminalLines.value.push({ text: 'Refreshing dashboard data (simulated)...', type: 'system' });
          stopSimulations();
          startSimulations(); // Restart to show a "refresh"
          break;
        default:
          terminalLines.value.push({ text: `Unhandled panel action: ${action}`, type: 'system' });
          console.log('Unhandled panel action:', action, payload);
      }
      baseScreenRef.value?.scrollToBottom();
    };

    const { tutorialConfig, startTutorial, onTutorialClose, initializeDashboardTutorial } = useDashboardTutorial();

    const initializeScreen = async () => {
      terminalLines.value.push({ text: 'Initializing AGNT Network Pulse...', type: 'system' });

      // If using real data, fetch it here. For now, simulation starts.
      // await Promise.all([...]);

      terminalLines.value.push({ text: 'Dashboard Live. Simulating operations.', type: 'success' });
      baseScreenRef.value?.scrollToBottom();
      startSimulations();
    };

    onMounted(() => {
      // console.log("DashboardScreen Mounted - Fast Pace Idle Game");
      document.body.setAttribute('data-page', 'terminal-dashboard-idle');
      initializeScreen();

      setTimeout(() => {
        initializeDashboardTutorial();
      }, 2000);
    });

    onUnmounted(() => {
      // console.log("DashboardScreen Unmounted");
      selectedMissionId.value = null;
    });

    return {
      baseScreenRef,
      terminalLines,
      selectedMissionId,
      selectedMission,

      // Simulated Data for Template
      simulatedAgentsActive,
      simulatedAgentsIdle,
      simulatedMissionsPerSecond,
      simulatedTokensPerSecond,
      simulatedTotalTokens,
      simulatedTokenActivityHistory,
      simulatedIsLoading,
      simulatedPerformanceData,
      simulatedAgents,
      simulatedGlobalModifiers,
      simulatedPermanentUpgrades,
      activateModifier,
      purchasePermanentUpgrade,
      handleAgentUpgrade,
      maxAgents,
      // For conceptual modal state, if needed by template or other parts
      agentForUpgradeModal,
      upgradeOptionsForModal,
      showAgentUpgradeModal,
      selectAgentUpgrade,
      closeAgentUpgradeModal,

      initializeScreen,
      handlePanelAction,
      handleUserInputSubmit,
      handleScreenChange,
      missionDetailsRef,
      scrollAnchorRef,
      handleLogMessage,
      tutorialConfig,
      startTutorial,
      onTutorialClose,
    };
  },
};
</script>

<style scoped>
/* Add dashboard-specific styles here */
.dashboard-content {
  width: 100%;
  flex: 1;
  overflow-y: auto;
  box-sizing: border-box;
  position: relative;
  overflow-x: hidden;
  scrollbar-width: thin;
}

/* New style for the inner padded container */
.dashboard-inner-content {
  display: flex;
  flex-direction: column;
  /* padding: 16px;
  padding-right: 8px; */
  height: 100%;
  box-sizing: border-box;
  gap: 16px; /* Consistent gap between components */
}

/* Remove margin from the last child to prevent double padding at bottom */
.dashboard-inner-content > :last-child {
  margin-bottom: 0;
}

/* Clickable element styles - can be moved to a global style if used widely */
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

.scroll-anchor {
  height: 0px;
  width: 100%;
  pointer-events: none;
}

/* General Section Styling */
.data-section {
  background: rgba(0, 0, 0, 0.15);
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

/* Global style overrides for this specific page context if needed */
body[data-page='terminal-dashboard-idle'] .scrollable-content {
  padding: 0; /* Example: remove padding if BaseScreen's scrollable-content needs it */
}
</style>
