// One source for the Settings and Apps navigation, shared by the desktop
// panels (SettingsPanel, ConnectorsPanel) and the mobile landing views. Both
// panels render whatever groups are declared here, in order, so regrouping is
// an edit to this file only.

// Settings: what you set once and come back to. AI Models leads (and is the
// page Settings opens on). "Advanced" is the plumbing: navigation, remote
// access and backend connections, backup and restore, reset.
export const settingsDirectory = [
  {
    "label": "General",
    "items": [
      {
        "id": "providers",
        "icon": "fas fa-robot",
        "label": "AI Models",
        "description": "Which model Annie uses, and its fallbacks"
      },
      {
        "id": "learning",
        "icon": "fas fa-seedling",
        "label": "Learning",
        "screen": "LearningScreen",
        "description": "Evidence, trials and supported improvements"
      },
      {
        "id": "theme",
        "icon": "fas fa-palette",
        "label": "Theme",
        "description": "Appearance and backgrounds"
      },
      {
        "id": "sounds",
        "icon": "fas fa-volume-up",
        "label": "Sounds",
        "description": "Audio feedback"
      },
      {
        "id": "security",
        "icon": "fas fa-shield-alt",
        "label": "Security",
        "description": "Permissions and policy"
      }
    ]
  },
  {
    "label": "Account",
    "items": [
      {
        "id": "profile",
        "icon": "fas fa-user",
        "label": "Profile",
        "description": "Your profile and AGNT score"
      },
      {
        "id": "members",
        "icon": "fas fa-users",
        "label": "Members",
        "description": "Team access, invitations and roles"
      },
      {
        "id": "billing",
        "icon": "fas fa-wallet",
        "label": "Billing",
        "description": "Plan and subscription"
      },
      {
        "id": "usage",
        "icon": "fas fa-chart-bar",
        "label": "Usage",
        "description": "What you've used of Models, Search, Sandbox, Mail and Webhooks"
      },
      {
        "id": "referrals",
        "icon": "fas fa-users",
        "label": "Referrals",
        "description": "Invites and commissions"
      },
      {
        "id": "leaderboard",
        "icon": "fas fa-trophy",
        "label": "Leaderboard",
        "description": "Referral and global rankings"
      },
      {
        "id": "api-keys",
        "icon": "fas fa-key",
        "label": "AGNT API Key",
        "description": "A key for bots and scripts that never expires"
      },
      {
        "id": "general",
        "icon": "fas fa-sign-out-alt",
        "label": "Sign in / out",
        "description": "Switch or sign out of your account"
      }
    ]
  },
  {
    "label": "Advanced",
    "items": [
      {
        "id": "navigation",
        "icon": "fas fa-bars",
        "label": "Navigation",
        "description": "Groups, order and visibility"
      },
      {
        "id": "phone-access",
        "icon": "fas fa-mobile-alt",
        "label": "Remote Access",
        "description": "Connect your phone"
      },
      {
        "id": "connection",
        "icon": "fas fa-server",
        "label": "Connections",
        "description": "This computer, remote servers and teams"
      },
      {
        "id": "backup",
        "icon": "fas fa-database",
        "label": "Backup & Restore",
        "description": "Data management"
      },
      {
        "id": "reset",
        "icon": "fas fa-undo",
        "label": "Reset",
        "description": "Clear data and start fresh"
      }
    ]
  },
  {
    "label": "Help",
    "items": [
      {
        "id": "tours",
        "icon": "fas fa-route",
        "label": "Tours",
        "description": "Guided walkthroughs"
      },
      {
        "id": "about",
        "icon": "fas fa-info-circle",
        "label": "About & Resources",
        "description": "Version, updates and help"
      }
    ]
  }
];

// The page Settings opens on: the first row of its nav (AI Models).
export const DEFAULT_SETTINGS_SECTION = settingsDirectory[0].items[0].id;

// Plugins: catalog, forge and connection services share one navigation list.
// Persisted section IDs stay unchanged; model connections live in Settings.
export const appsDirectory = [
  {
    "label": "Plugins",
    "items": [
      {
        "id": "apps",
        "icon": "fas fa-th-large",
        "label": "Your plugins",
        "description": "Everything you installed and connected"
      },
      {
        "id": "email-server",
        "icon": "fas fa-envelope",
        "label": "Email Inbox",
        "pro": true,
        "description": "Active email listeners"
      },
      {
        "id": "webhooks",
        "icon": "fas fa-link",
        "label": "Webhooks",
        "pro": true,
        "description": "Incoming events"
      },
      {
        "id": "mcp-servers",
        "icon": "fas fa-server",
        "label": "MCP Servers",
        "description": "Tools supplied by MCP servers"
      },
      {
        "id": "plugins",
        "icon": "fas fa-hammer",
        "label": "Plugin Forge",
        "screen": "PluginsScreen",
        "description": "Build, bundle or install a plugin"
      },
      {
        "id": "oauth",
        "icon": "fas fa-key",
        "label": "Keys & Sign-ins",
        "description": "Every stored key and sign-in, with health"
      }
    ]
  }
];
