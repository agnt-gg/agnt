// Mirrors the existing panel navigation; shared with mobile landing views.
export const settingsDirectory = [
  {
    "label": "General",
    "items": [
      {
        "id": "providers",
        "icon": "fas fa-robot",
        "label": "AI Provider",
        "description": "Default models and fallback providers"
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
        "label": "API Key",
        "description": "A key for bots and scripts that never expires"
      }
    ]
  },
  {
    "label": "Assistant",
    "items": [
      {
        "id": "autonomy",
        "icon": "fas fa-user-shield",
        "label": "Approvals",
        "screen": "AutonomyScreen",
        "description": "Decisions and permissions"
      },
      {
        "id": "evolution",
        "icon": "fas fa-dna",
        "label": "Improvements",
        "screen": "ExperimentsScreen",
        "description": "Insights and experiments"
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
export const appsDirectory = [
  {
    "label": "Connections",
    "items": [
      {
        "id": "providers",
        "icon": "fas fa-robot",
        "label": "AI Providers",
        "description": "Default models and fallback providers"
      },
      {
        "id": "oauth",
        "icon": "fas fa-plug",
        "label": "API / OAuth",
        "description": "Connected services"
      },
      {
        "id": "email-server",
        "icon": "fas fa-envelope",
        "label": "Emails",
        "pro": true,
        "description": "Active email listeners"
      },
      {
        "id": "mcp-servers",
        "icon": "fas fa-server",
        "label": "MCP",
        "description": "Servers, tools and resources"
      },
      {
        "id": "webhooks",
        "icon": "fas fa-link",
        "label": "Webhooks",
        "pro": true,
        "description": "Incoming events"
      },
      {
        "id": "plugins",
        "icon": "fas fa-puzzle-piece",
        "label": "Plugins",
        "screen": "PluginsScreen",
        "description": "Installed app extensions"
      }
    ]
  }
];
