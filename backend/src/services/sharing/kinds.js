/**
 * Every kind of item that can be shared, in one place.
 *
 * A kind is a PURE description of a portable definition: which fields may
 * travel (deny by default), which of them are code (refused, never edited, if
 * they carry a credential), what other shareable items it points at, how those
 * pointers are rewritten after install, and which connections it needs. Storage
 * lives in nativeStore.js; policy (secrets, paths, limits) lives in
 * TeamBundle.js. Adding a kind here makes it shareable everywhere at once:
 * copy to team, copy from team, public links and files.
 *
 * Memory, conversations and run history are deliberately not kinds.
 */
import { randomBytes, randomUUID } from 'node:crypto';

const list = value => (Array.isArray(value) ? value : []);
const string = value => (typeof value === 'string' && value ? value : null);
const pick = (source, fields) => Object.fromEntries(fields.filter(field => source?.[field] !== undefined && source[field] !== null).map(field => [field, source[field]]));

/** Where a window sits and which widget it shows. Navigation history and bound private state never travel. */
const WINDOW_FIELDS = ['instanceId', 'widgetId', 'chatKey', 'col', 'row', 'cols', 'rows', 'collapsed', 'visible', 'zIndex'];
/** A goal travels as a plan: its tasks, never their inputs, outputs, errors or progress. */
const TASK_FIELDS = ['key', 'parentKey', 'title', 'description', 'requiredTools', 'dependencies', 'orderIndex', 'agentId', 'workflowId'];
const MAX_WINDOWS = 60;
const MAX_TASKS = 200;

export const KIND_DEFINITIONS = Object.freeze({
  tool: {
    label: 'Tool', order: 0,
    fields: ['title', 'category', 'type', 'icon', 'description', 'parameters', 'outputs', 'base', 'code', 'config'],
    codeFields: ['code'],
    slots: definition => [[definition.config?.provider, 'model']],
  },
  skill: {
    label: 'Skill', order: 1,
    fields: ['name', 'description', 'instructions', 'category', 'icon', 'license', 'compatibility', 'allowedTools', 'metadata'],
  },
  widget: {
    label: 'Widget', order: 1,
    fields: ['name', 'description', 'icon', 'category', 'widget_type', 'source_code', 'config', 'data_bindings', 'default_size', 'min_size', 'useThemeStyles'],
    codeFields: ['source_code'],
    // The canvas recognises a custom widget by this prefix (canvasBridge.js).
    newId: () => 'cw_' + randomBytes(6).toString('hex'),
  },
  workflow: {
    label: 'Workflow', order: 2,
    fields: ['name', 'description', 'category', 'nodes', 'edges', 'trigger', 'variables'],
    slots: (definition, { nodeProvider }) => list(definition.nodes).flatMap(node => [[node?.parameters?.provider, 'model'], [nodeProvider(node?.type), 'connection']]),
    references: (definition, { isCustomTool }) => list(definition.nodes)
      .map(node => node?.parameters?.toolId || node?.toolId || node?.type)
      .filter(id => typeof id === 'string' && isCustomTool(id))
      .map(id => ({ kind: 'tool', id })),
    remap: (definition, remap, installed) => ({
      ...definition,
      nodes: Array.isArray(definition.nodes) ? definition.nodes.map(node => {
        if (!node || typeof node !== 'object') return node;
        const next = { ...node };
        if (typeof next.type === 'string' && installed('tool', next.type)) next.type = remap('tool', next.type);
        if (typeof next.toolId === 'string') next.toolId = remap('tool', next.toolId);
        if (next.parameters && typeof next.parameters.toolId === 'string') next.parameters = { ...next.parameters, toolId: remap('tool', next.parameters.toolId) };
        return next;
      }) : definition.nodes,
    }),
  },
  agent: {
    label: 'Agent', order: 3,
    fields: ['name', 'description', 'icon', 'category', 'systemPrompt', 'provider', 'model', 'toolAccessMode', 'assignedTools', 'assignedWorkflows', 'assignedSkills'],
    slots: definition => [[definition.provider, 'model']],
    references: (definition, { isCustomTool }) => [
      ...list(definition.assignedTools).filter(id => isCustomTool(id)).map(id => ({ kind: 'tool', id })),
      ...list(definition.assignedWorkflows).map(id => ({ kind: 'workflow', id })),
      ...list(definition.assignedSkills).map(id => ({ kind: 'skill', id })),
    ],
    remap: (definition, remap) => ({
      ...definition,
      assignedTools: list(definition.assignedTools).map(id => remap('tool', id)),
      assignedWorkflows: list(definition.assignedWorkflows).map(id => remap('workflow', id)),
      assignedSkills: list(definition.assignedSkills).map(id => remap('skill', id)),
    }),
  },
  goal: {
    label: 'Goal', order: 4,
    fields: ['title', 'description', 'priority', 'successCriteria', 'tasks'],
    // A goal is a run, not a library item: every copy is a new plan, never an overwrite of one in flight.
    replaceable: false,
    normalize: definition => ({ ...definition, tasks: list(definition.tasks).slice(0, MAX_TASKS).filter(task => task && typeof task === 'object').map(task => pick(task, TASK_FIELDS)) }),
    references: definition => list(definition.tasks).flatMap(task => [
      ...(string(task.agentId) ? [{ kind: 'agent', id: task.agentId }] : []),
      ...(string(task.workflowId) ? [{ kind: 'workflow', id: task.workflowId }] : []),
    ]),
    remap: (definition, remap) => ({
      ...definition,
      tasks: list(definition.tasks).map(task => ({
        ...task,
        ...(string(task.agentId) ? { agentId: remap('agent', task.agentId) } : {}),
        ...(string(task.workflowId) ? { workflowId: remap('workflow', task.workflowId) } : {}),
      })),
    }),
  },
  workspace: {
    label: 'Workspace', order: 5,
    fields: ['name', 'widgets'],
    newId: () => 'ws_' + Date.now().toString(36) + randomBytes(3).toString('hex'),
    normalize: definition => ({ ...definition, widgets: list(definition.widgets).slice(0, MAX_WINDOWS).filter(window => window && typeof window === 'object' && string(window.widgetId)).map(window => pick(window, WINDOW_FIELDS)) }),
    references: definition => list(definition.widgets).map(window => window.widgetId).filter(id => /^cw_/.test(id)).map(id => ({ kind: 'widget', id })),
    remap: (definition, remap) => ({ ...definition, widgets: list(definition.widgets).map(window => ({ ...window, widgetId: remap('widget', window.widgetId) })) }),
  },
});

export const KINDS = Object.freeze(Object.keys(KIND_DEFINITIONS));
export const isKind = kind => Object.prototype.hasOwnProperty.call(KIND_DEFINITIONS, kind);
export const kindOf = kind => KIND_DEFINITIONS[kind];
export const newIdFor = kind => (KIND_DEFINITIONS[kind]?.newId || randomUUID)();
/** The kinds and their labels, for clients that render a picker or a filter. */
export const kindCatalog = () => KINDS.map(kind => ({ kind, label: KIND_DEFINITIONS[kind].label }));
