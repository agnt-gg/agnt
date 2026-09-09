# Header model selector

The control beside the clock opens the account-default provider/model picker.
It is available throughout the authenticated app shell, including while model
settings are loading or when the model catalog is empty. Without a selected
model its label is **Select model**; otherwise it shows the existing
provider/model label.

The control is a native button. Tab can focus it, Enter or Space opens the
picker, and the picker closes on Escape or an outside click. Its
`aria-expanded` state reflects whether the picker is open.

## Why it could disappear

Saved settings can use lowercase built-in provider keys such as `openai-codex`,
while frontend provider identifiers and model-cache keys use `OpenAI-Codex`.
A case-sensitive lookup in `loadUserSettings` skipped fetching models and then
cleared the selected model. The header's `v-if` removed the entire control.

Settings loading now resolves case variants using the existing
`canonicalizeProviderCase` helper **before** fetching or committing the
provider. Exact custom-provider IDs remain opaque, unknown providers are not
mapped to another provider, and the existing model-validation behavior is
unchanged. This is a display/settings-loading fix, not an authentication or
provider-routing change. No new setting or migration is needed.

## Regression coverage

- `frontend/src/store/app/aiProvider.loadSettings.bdd.spec.js`: built-in casing,
  both settings/provider-list completion orders, custom and unknown providers,
  Local model loading, absent settings, and settings-service failure.
- `frontend/src/canvas/CanvasScreen.modelSelector.bdd.spec.js`: fallback and
  populated labels, opening/closing, reactive updates, and sign-in boundary.
- `tests/e2e/header-model-selector.spec.js`: real built app and picker, model
  persistence through reload, and keyboard/mouse recovery from an empty catalog.
  Uses the existing isolated backend fixture and synthetic settings/model
  responses; tagged `@ci` for the browser gate.
