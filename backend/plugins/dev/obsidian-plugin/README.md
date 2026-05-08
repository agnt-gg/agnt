# AGNT Obsidian Plugin

Comprehensive AGNT integration for the Obsidian Local REST API.

## Auth

This plugin intentionally uses AGNT's canonical remote auth provider:

- `authProvider`: `obsidian`
- `authRequired`: `apiKey`

Store the Obsidian Local REST API token in AGNT under provider ID `obsidian`. The token is injected into the plugin as `params.__auth.token` by AGNT's plugin runtime. The plugin does not read local SQLite credentials, `.env` secrets, or `obsidian-local-rest-api` aliases.

## Requirements

1. Install and enable the Obsidian community plugin **Local REST API**.
2. In Obsidian, open Settings -> Local REST API and copy the API key.
3. In AGNT, connect/store the key under provider `obsidian`.
4. Keep Obsidian running while AGNT calls the local API.

Default base URL:

```text
https://127.0.0.1:27124
```

The Local REST API uses a self-signed localhost certificate. `allowSelfSignedLocalhostCert` defaults to true, but only works for localhost/loopback URLs.

## Actions

- `CHECK_STATUS`
- `LIST_FILES`
- `READ_NOTE`
- `CREATE_OR_REPLACE_NOTE`
- `APPEND_TO_NOTE`
- `PATCH_NOTE`
- `DELETE_NOTE`
- `OPEN_NOTE`
- `GET_ACTIVE_FILE`
- `REPLACE_ACTIVE_FILE`
- `APPEND_ACTIVE_FILE`
- `PATCH_ACTIVE_FILE`
- `DELETE_ACTIVE_FILE`
- `SEARCH_SIMPLE`
- `SEARCH_DQL`
- `SEARCH_JSONLOGIC`
- `GET_PERIODIC_NOTE`
- `CREATE_OR_REPLACE_PERIODIC_NOTE`
- `APPEND_PERIODIC_NOTE`
- `PATCH_PERIODIC_NOTE`
- `DELETE_PERIODIC_NOTE`
- `LIST_TAGS`
- `LIST_COMMANDS`
- `EXECUTE_COMMAND`
- `GET_OPENAPI_SPEC`
- `GET_CERTIFICATE`

## Common examples

Read a note:

```json
{
  "action": "READ_NOTE",
  "path": "Projects/AGNT.md"
}
```

Append to a note:

```json
{
  "action": "APPEND_TO_NOTE",
  "path": "Daily/2026-05-08.md",
  "content": "- Updated AGNT Obsidian plugin."
}
```

Patch a heading:

```json
{
  "action": "PATCH_NOTE",
  "path": "Projects/AGNT.md",
  "operation": "append",
  "targetType": "heading",
  "target": "Next Steps",
  "content": "- Test the installed AGNT plugin."
}
```

Search:

```json
{
  "action": "SEARCH_SIMPLE",
  "query": "AGNT auth provider"
}
```

## Safety

- No credential logging.
- No local credential fallback.
- No global AuthManager behavior changes.
- Destructive actions require explicit action and path.
