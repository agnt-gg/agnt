// Single source of truth for the user's workspace directory across every chat
// surface (orchestrator, agent, workflow, tool, widget, goal, artifact) AND
// goal task execution. The path is set in onboarding and editable in artifacts
// settings; reading it here means tools that take a file path can default to
// under the workspace.
// userId: the chat's user (prompts are built outside any tool run, so it must be passed).
export async function loadWorkspaceContextSection(userId) {
  try {
    const { getWorkspaceRootPath } = await import('./codeTools.js');
    const workspaceRoot = await getWorkspaceRootPath(userId);
    if (!workspaceRoot) return '';
    return `## Workspace
The user's workspace directory is: ${workspaceRoot}
When you create, edit, or save files on the user's behalf, place them under this workspace path unless the user explicitly names a different location. This is where their project files live, and any tool that accepts a file path (file_operations, write_file, code generators, video tools, etc.) should default to a path under here.`;
  } catch (e) {
    console.warn('[workspaceContext] Failed to load workspace root:', e.message);
    return '';
  }
}
