# Calendly Plugin for AGNT

Calendly scheduling automation for AGNT workflows using AGNT's API-key auth injection.

## Auth

Create an AGNT auth provider named:

```text
calendly
```

Store your Calendly Personal Access Token in that provider. The plugin reads it from:

```js
params.__auth.token
```

and sends it to Calendly as:

```http
Authorization: Bearer <token>
```

## Actions

- `GET_CURRENT_USER`
- `LIST_EVENT_TYPES`
- `GET_AVAILABLE_TIMES`
- `CREATE_SCHEDULING_LINK`
- `BOOK_INVITEE`
- `LIST_SCHEDULED_EVENTS`
- `CANCEL_EVENT`

## Notes

- All plugin and tool icons are set to `calendly`.
- `BOOK_INVITEE` requires `confirmBooking: true`.
- `CANCEL_EVENT` requires `confirmCancellation: true`.
- `GET_AVAILABLE_TIMES` validates Calendly's 7-day maximum query window.
