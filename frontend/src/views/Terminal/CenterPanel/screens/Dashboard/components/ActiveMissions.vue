<template>
  <div class="activity-feed mission-order-board">
    <div class="header-with-info main-header">
      <h3>
        <i class="fas fa-bolt"></i> Global Mission Board
      </h3>
    </div>
    <div class="feed-container" ref="feedContainerRef">
      <ul v-if="displayMissions.length > 0">
        <li
          v-for="mission in displayMissions"
          :key="mission.id"
          class="mission-item"
          :class="['status-' + mission.status.toLowerCase(), 'type-' + mission.type.toLowerCase().replace(/\s+/g, '-')]"
        >
          <div class="mission-content">
            <div class="mission-type-skill">
              <span class="mission-type">{{ mission.type }} L{{mission.level}}</span>
              <div class="mission-skills">
                <Tooltip v-for="skill in mission.skills" :key="skill" :text="skill" width="auto">
                  <i :class="getSkillIcon(skill)"></i>
                </Tooltip>
              </div>
            </div>
            <div class="mission-rewards-status">
              <span class="mission-rewards">
                <i class="fas fa-coins"></i> {{ mission.tokenReward }}T | <i class="fas fa-star"></i> {{ mission.xpReward }}XP
              </span>
              <div class="mission-progress-bar-container" v-if="mission.status === 'InProgress'">
                <div class="mission-progress-bar-fill" :style="{ width: mission.progress + '%' }"></div>
              </div>
              <span class="mission-status-text" :class="mission.status === 'Complete' ? 'text-green' : mission.status === 'Failed' ? 'text-red' : ''">
                {{ mission.status === 'InProgress' ? Math.round(mission.progress) + '%' : mission.status }}
              </span>
            </div>
          </div>
        </li>
      </ul>
      <p v-else class="empty-state">
        Generating missions...
      </p>
    </div>
  </div>
</template>

<script>
import { ref, onMounted, onUnmounted, nextTick, computed, inject } from "vue";
import { useStore } from "vuex"; // If we need to dispatch actions later
import Tooltip from '@/views/Terminal/_components/Tooltip.vue';

// Helper to generate unique IDs
let missionIdCounter = 0;
const getUniqueId = () => missionIdCounter++;

// Mission configuration
const MISSION_TYPES = [
  { name: "Data Skim Op", baseDuration: 1500, skills: ["Scan", "Hack"], baseToken: 30, baseXp: 20, minSkillLevel: 1 },
  { name: "Network Infiltration", baseDuration: 3400, skills: ["Network", "Stealth"], baseToken: 50, baseXp: 35, minSkillLevel: 1 },
  { name: "Security Sweep", baseDuration: 2400, skills: ["Security", "Scan"], baseToken: 40, baseXp: 30, minSkillLevel: 2 },
  { name: "Logistics Run", baseDuration: 500, skills: ["Logistics"], baseToken: 25, baseXp: 15, minSkillLevel: 1 },
  { name: "Intel Analysis", baseDuration: 4800, skills: ["Analysis", "Decipher"], baseToken: 60, baseXp: 40, minSkillLevel: 2 },
  { name: "Crypto Comms Crack", baseDuration: 6300, skills: ["Crypto", "Hack"], baseToken: 75, baseXp: 50, minSkillLevel: 2 },
  { name: "Firewall Breach", baseDuration: 7200, skills: ["Firewall", "Exploit"], baseToken: 100, baseXp: 60, minSkillLevel: 3 },
  { name: "Trace Digital Ghost", baseDuration: 5300, skills: ["Trace", "Network"], baseToken: 80, baseXp: 55, minSkillLevel: 2 },
  { name: "Asset Extraction", baseDuration: 9600, skills: ["Stealth", "Logistics", "Hack"], baseToken: 120, baseXp: 70, minSkillLevel: 3 },
  { name: "Corporate Espionage", baseDuration: 12000, skills: ["Exploit", "Stealth", "Analysis"], baseToken: 150, baseXp: 80, minSkillLevel: 3 },
];

const SKILL_ICONS = {
  Scan: "fas fa-search",
  Hack: "fas fa-laptop-code", 
  Network: "fas fa-wifi",
  Stealth: "fas fa-user-secret",
  Security: "fas fa-shield-alt",
  Logistics: "fas fa-truck-loading",
  Analysis: "fas fa-chart-line",
  Crypto: "fas fa-key",
  Decipher: "fas fa-unlock-alt",
  Firewall: "fas fa-fire",
  Trace: "fas fa-route",
  Exploit: "fas fa-bug",
  default: "fas fa-question-circle"
};

const MAX_DISPLAY_MISSIONS = 25; // Increased for more activity

export default {
  name: "ActiveMissions",
  components: {
    Tooltip,
  },
  // Props might be reintroduced later if missions come from Vuex
  // props: {
  //   activeMissions: {
  //     type: Array,
  //     default: () => []
  //   },
  // },
  setup() {
    const store = useStore(); // For potential future use
    const allMissions = ref([]);
    const feedContainerRef = ref(null);
    const playSound = inject("playSound"); // Inject playSound

    let missionGeneratorInterval = null;
    let missionUpdateInterval = null;

    const createRandomMission = () => {
      const typeConfig = MISSION_TYPES[Math.floor(Math.random() * MISSION_TYPES.length)];
      const level = Math.ceil(Math.random() * 5); // Level 1-5
      const duration = Math.max(200, typeConfig.baseDuration / level + (Math.random() * 500 - 250)); // Ensure min duration

      return {
        id: getUniqueId(),
        type: typeConfig.name,
        level: level,
        skills: typeConfig.skills,
        tokenReward: Math.floor(typeConfig.baseToken * level * (1 + Math.random() * 0.2)),
        xpReward: Math.floor(typeConfig.baseXp * level * (1 + Math.random() * 0.2)),
        status: "Available", // Available -> Assigning -> InProgress -> Complete/Failed
        duration: duration, // ms
        progress: 0,
        startTime: 0,
      };
    };

    const getSkillIcon = (skill) => {
      return SKILL_ICONS[skill] || SKILL_ICONS.default;
    };

    const processMissions = () => {
      const now = Date.now();
      allMissions.value.forEach(mission => {
        if (mission.status === "Assigning") {
          // Simulate agent assignment
          mission.status = "InProgress";
          mission.startTime = now;
          mission.progress = 0;
        } else if (mission.status === "InProgress") {
          const elapsedTime = now - mission.startTime;
          mission.progress = Math.min(100, (elapsedTime / mission.duration) * 100);
          if (mission.progress >= 100) {
            mission.status = "Complete"; // Or "Failed" with some probability
            if (playSound) { // Play sound on completion
              playSound('chaChingMoney', 0.15); // Example: play 'chaChingMoney' at 15% volume
            }
            // Potentially dispatch to Vuex store here
            // store.dispatch('game/missionCompleted', { missionId: mission.id, reward: mission.tokenReward });
          }
        }
      });

      // Remove completed/failed missions after a short delay for visual effect
      allMissions.value = allMissions.value.filter(mission => {
        if (mission.status === "Complete" || mission.status === "Failed") {
          // Keep for a very short time to flash status, then remove
          if (!mission.removeTime) mission.removeTime = now + 300; // 0.3s visibility
          return now < mission.removeTime;
        }
        return true;
      });
    };

    const addNewMissions = () => {
      const activeMissionCount = allMissions.value.filter(m => m.status === "Available" || m.status === "Assigning" || m.status === "InProgress").length;
      
      // Generate multiple missions at once for crazy activity
      const missionsToAdd = Math.min(3, MAX_DISPLAY_MISSIONS - activeMissionCount);
      
      for (let i = 0; i < missionsToAdd; i++) {
        if (activeMissionCount + i < MAX_DISPLAY_MISSIONS + 10) {
          const newMission = createRandomMission();
          allMissions.value.unshift(newMission);

          // Auto-assign available missions very quickly
          if (newMission.status === "Available") {
            setTimeout(() => {
              if (newMission.status === "Available") {
                newMission.status = "Assigning";
              }
            }, Math.random() * 100 + 25); // Much faster assignment
          }
        }
      }
      
      // Prune old missions more aggressively
      if (allMissions.value.length > MAX_DISPLAY_MISSIONS * 1.5) {
        allMissions.value.splice(MAX_DISPLAY_MISSIONS * 1.5);
      }
    };

    const displayMissions = computed(() => {
      // Show latest N missions, primarily those not yet removed.
      return allMissions.value.slice(0, MAX_DISPLAY_MISSIONS);
    });


    onMounted(() => {
      missionGeneratorInterval = setInterval(addNewMissions, 1000); // Slower generation
      missionUpdateInterval = setInterval(processMissions, 200); // Slower updates
    });

    onUnmounted(() => {
      clearInterval(missionGeneratorInterval);
      clearInterval(missionUpdateInterval);
    });

    return {
      displayMissions,
      feedContainerRef,
      getSkillIcon
    };
  }
};
</script>

<style scoped>
.mission-order-board {
  background: rgba(0, 0, 0, 0.15); /* Darker for mission board */
  border: 1px solid rgba(25, 239, 131, 0.25);
  padding: 10px;
  height: 100%; /* Fill available space in panel */
  display: flex;
  flex-direction: column;
  overflow: hidden; /* Important for fast scrolling feel */
}

.mission-order-board h3 {
  margin: 0 0 10px 0;
  color: var(--color-light-green); /* Brighter header */
  font-size: 1em;
  display: flex;
  align-items: center;
  gap: 6px;
}

.feed-container {
  flex: 1;
  overflow-y: hidden; /* Crucial for the "ticker" feel, items disappear fast */
  padding-right: 0; /* No scrollbar visible if items cycle fast */
}

.feed-container ul {
  list-style: none;
  padding: 0;
  margin: 0;
  display: flex;
  flex-direction: column;
}

.mission-item {
  background-color: rgba(25, 239, 131, 0.05);
  border: 1px solid rgba(25, 239, 131, 0.1);
  border-left: 3px solid var(--color-blue); /* Default for "Available" */
  border-radius: 3px;
  padding: 6px 8px;
  margin-bottom: 4px; /* Tighter spacing */
  transition: all 0.1s ease-out; /* Faster transitions */
  display: flex;
  align-items: center;
  font-size: 0.85em; /* Smaller font for density */
}

.mission-item.status-assigning {
  border-left-color: var(--color-yellow);
  background-color: rgba(251, 191, 36, 0.05);
}
.mission-item.status-inprogress {
  border-left-color: var(--color-orange); /* Or some "active" color */
   background-color: rgba(255, 165, 0, 0.05);
}
.mission-item.status-complete {
  border-left-color: var(--color-green);
  background-color: rgba(25, 239, 131, 0.1);
  animation: flash-green 0.3s ease-out;
}
.mission-item.status-failed {
  border-left-color: var(--color-red);
  background-color: rgba(239, 68, 68, 0.1);
   animation: flash-red 0.3s ease-out;
}

@keyframes flash-green {
  0% { background-color: rgba(25, 239, 131, 0.3); }
  100% { background-color: rgba(25, 239, 131, 0.1); }
}
@keyframes flash-red {
  0% { background-color: rgba(239, 68, 68, 0.3); }
  100% { background-color: rgba(239, 68, 68, 0.1); }
}


.mission-content {
  display: flex;
  justify-content: space-between;
  align-items: center;
  width: 100%;
  gap: 8px;
}

.mission-type-skill {
  display: flex;
  flex-direction: column;
  gap: 2px;
  flex-shrink: 0;
}

.mission-type {
  font-weight: 600;
  color: var(--color-grey-light);
  font-size: 0.95em;
}

.mission-skills {
  display: flex;
  gap: 4px;
}

.mission-skills i {
  font-size: 0.9em;
  color: var(--color-grey);
}

.mission-rewards-status {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-grow: 1;
  justify-content: flex-end;
}

.mission-rewards {
  color: var(--color-light-green);
  font-size: 0.9em;
  white-space: nowrap;
}
.mission-rewards i {
  color: var(--color-yellow);
}
.mission-rewards i.fa-star {
  color: var(--color-orange);
}


.mission-progress-bar-container {
  width: 60px; /* Fixed width for progress bar */
  height: 6px;
  background-color: rgba(25, 239, 131, 0.2);
  border-radius: 3px;
  overflow: hidden;
}

.mission-progress-bar-fill {
  height: 100%;
  background-color: var(--color-green);
  border-radius: 3px;
  transition: width 0.05s linear; /* Very fast update */
}

.mission-status-text {
  font-size: 0.9em;
  color: var(--color-grey);
  font-weight: bold;
  min-width: 70px; /* Ensure status text doesn't jump around too much */
  text-align: right;
}
.mission-status-text.text-green {
  color: var(--color-green);
}
.mission-status-text.text-red {
  color: var(--color-red);
}

.empty-state {
  color: var(--color-grey);
  font-style: italic;
  font-size: 0.85em;
  text-align: center;
  padding: 20px;
}

/* Header and Icon Styling - kept for consistency if needed */
.header-with-info {
  display: inline-flex;
  align-items: center;
  gap: 4px;
}
.main-header {
  width: 100%;
  margin-bottom: 8px; /* Reduced margin */
  display: flex;
}
</style> 