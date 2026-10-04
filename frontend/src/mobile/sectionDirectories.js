// Mirrors the existing panel navigation; shared with mobile landing views.
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
        "id": "profile",
        "icon": "fas fa-user",
        "label": "Profile",
        "description": "Your profile and AGNT score"
      },
      {
        "id": "referrals",
        "icon": "fas fa-users",
        "label": "Referrals",
        "description": "Invites and commissions"
      },
      {
        "id": "api-keys",
        "icon": "fas fa-key",
        "label": "AGNT API Key",
        "description": "A key for bots and scripts that never expires"
      }
    ]
  },
  {
    "label": "Assistant",
    "items": [
      {
        "id": "learning",
        "icon": "fas fa-seedling",
        "label": "Learning",
        "screen": "LearningScreen",
        "description": "Evidence, trials and supported improvements"
      }
    ]
  },
  {
    "label": "Config",
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
        "id": "security",
        "icon": "fas fa-shield-alt",
        "label": "Security",
        "description": "Permissions and policy"
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
        "id": "tours",
        "icon": "fas fa-route",
        "label": "Tours",
        "description": "Guided walkthroughs"
      }
    ]
  },
  {
    "label": "Data",
    "items": [
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
    "label": "About",
    "items": [
      {
        "id": "about",
        "icon": "fas fa-info-circle",
        "label": "About & Resources",
        "description": "Version, updates and help"
      },
      {
        "id": "leaderboard",
        "icon": "fas fa-trophy",
        "label": "Leaderboard",
        "description": "Referral and global rankings"
      }
    ]
  },
  {
    "label": "Account",
    "items": [
      {
        "id": "general",
        "label": "Sign in / out",
        "icon": "fas fa-user"
      },
      {
        "id": "api-keys",
        "label": "AGNT.gg API Key",
        "icon": "fas fa-key"
      }
    ]
  }
];
// Apps: one place for everything AGNT can use. A plugin and the sign-in it
// needs are ONE card in "Your apps" (services/appCards); AI models are not
// apps and live in Settings › AI Models. "Advanced" holds the raw plumbing a
// power user still wants to reach: every stored key, inboxes, webhooks.
export const appsDirectory = [
  {
    "label": "Apps",
    "items": [
      {
        "id": "apps",
        "icon": "fas fa-th-large",
        "label": "Your apps",
        "description": "Everything you installed and connected"
      },
      {
        "id": "plugins",
        "icon": "fas fa-hammer",
        "label": "App Forge",
        "screen": "PluginsScreen",
        "description": "Build, bundle or install an app"
      },
      {
        "id": "mcp-servers",
        "icon": "fas fa-server",
        "label": "MCP Servers",
        "description": "Apps that run as MCP servers"
      }
    ]
  },
  {
    "label": "Advanced",
    "items": [
      {
        "id": "oauth",
        "icon": "fas fa-key",
        "label": "Keys & Sign-ins",
        "description": "Every stored key and sign-in, with health"
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
      }
    ]
  }
];
