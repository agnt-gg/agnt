# Opt-in workstation image facade

Operator-only environment `AGNT_WORKSTATION_IMAGE_URL=http://127.0.0.1:<port>` enables the teacher-prep facade image provider. No endpoint, path or credentials are accepted from a tool call. This is not an OpenAI-compatible service; it must use the documented `/image/health` and `/image/generate` contract on the same host. Only generation is supported; editing must be explicitly switched to an edit-capable provider in Settings. No fallback is performed.

Runtime admission belongs to the workstation owner (`lane-op`), never this adapter. The facade's generate endpoint requests admission and may return503 while room is being prepared. No automatic retry is made. Operator model/profile selection is reported; restricted Ideogram canary use is private/non-commercial and not promoted by this integration. No workload is forcibly displaced by AGNT.

## Cold startup

Observed owner-admitted cold warm-up:299202ms including pipeline loading; facade-reported generation15.794s. Immediately subsequent native warm generation15923ms with the old HTTP client succeeded. Earlier cold request hit Node fetch's response-header timeout yet produced an image; it must not be regenerated automatically.

The local generation request now uses dedicated node:http with connect5s, headers600s, body-idle15s, total620s, and adapter630s deadlines. No global timeout change, redirects, credentials or request retry. Parent cancellation may impose a shorter deadline; no guarantee the server stops generating after client cancellation. Failure receipts preserve requestId, dispatch uncertainty and the owned request directory through action/tool layers. Missing usage/cost remain unknown.

Responses are capped at1MiB. Output is confined to the owned request directory and validated as bounded noninterlaced8bit PNG (chunks, CRCs, decompressed dimensions and filters). Shared PNG validation is reused by Codex, not copied into a separate weaker check. Existing output recovery is an explicit reconciliation operation, never automatic extra generation or invented successful HTTP metadata.

## Qualification / remaining acceptance

52 focused HTTP/local/Codex transport cases pass, including delayed headers, silent server, body stall, cancellation, size bound and one dispatch. Frontend4475passes. This does not establish real rendered success; the diagnostic browser remains at normal AGNT sign-in. No test token is inserted to bypass that barrier.

Local full backend in original codex-pr checkout still encounters stream builtin resolution errors before plugin test execution; a same-dependency settings checkout passes that test. A fresh exact-tree qualification is required before declaring this environment issue settled. No assertions skipped.

The feature remains opt-in. A separate local candidate can be restarted with the env setting and existing test data; it does not replace the dirty normal installation. #129 must stay draft until final qualification and the real Settings->Send->generation->explicit provider switch->edit->reload journey is observed. #117 history is retained until its successor is qualified.
