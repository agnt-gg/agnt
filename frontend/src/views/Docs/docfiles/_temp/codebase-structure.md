# Vue.js Project Structure Guide

## Overview

This guide outlines the detailed structure of our Vue.js project, explaining the purpose of each directory and file type.

## Project Structure

```
/src
|-- assets/
|   |-- images/
|   |-- fonts/
|   |-- styles/
|       |-- global.css
|
|-- components/
|   |-- Button/
|   |   |-- Button.vue
|   |   |-- useButton.js
|   |   |-- Button.spec.js
|   |
|   |-- Input/
|   |   |-- Input.vue
|   |   |-- useInput.js
|   |   |-- Input.spec.js
|   |
|   |-- Select/
|   |   |-- Select.vue
|   |   |-- useSelect.js
|   |   |-- Select.spec.js
|
|-- layouts/
|   |-- DefaultLayout.vue
|   |-- AdminLayout.vue
|
|-- views/
|   |-- ToolForge/
|   |   |-- ToolForge.vue
|   |   |-- useToolForge.js
|   |   |-- toolForgeApi.js
|   |   |-- ToolForge.spec.js
|   |   |
|   |   |-- components/
|   |       |-- ToolPanel/
|   |       |   |-- ToolPanel.vue
|   |       |   |-- useToolPanel.js
|   |       |   |-- toolPanelApi.js
|   |       |   |-- ToolPanel.spec.js
|   |       |   |-- components/
|   |       |
|   |       |-- ResponseArea/
|   |           |-- ResponseArea.vue
|   |           |-- useResponseArea.js
|   |           |-- responseAreaApi.js
|   |           |-- ResponseArea.spec.js
|   |
|   |-- WorkflowDesigner/
|       |-- WorkflowDesigner.vue
|       |-- useWorkflowDesigner.js
|       |-- workflowDesignerApi.js
|       |-- WorkflowDesigner.spec.js
|       |
|       |-- components/
|           |-- WorkflowCanvas/
|           |   |-- WorkflowCanvas.vue
|           |   |-- useWorkflowCanvas.js
|           |   |-- workflowCanvasApi.js
|           |   |-- WorkflowCanvas.spec.js
|           |   |-- components/
|           |
|           |-- ToolPalette/
|               |-- ToolPalette.vue
|               |-- useToolPalette.js
|               |-- toolPaletteApi.js
|               |-- ToolPalette.spec.js
|
|-- services/
|   |-- api.js
|   |-- userAuth.js
|   |-- toolsApi.js
|   |-- workflowApi.js
|
|-- composables/
|   |-- useAuth.js
|   |-- useTools.js
|   |-- useWorkflow.js
|   |-- usePagination.js
|
|-- router/
|   |-- index.js
|   |-- routes.js
|
|-- store/
|   |-- index.js
|   |-- modules/
|       |-- user.js
|       |-- tools.js
|       |-- workflow.js
|
|-- utils/
|   |-- formatters.js
|   |-- validators.js
|   |-- helpers.js
|
|-- config/
|   |-- constants.js
|   |-- environment.js
|
|-- types/
|   |-- tool.ts
|   |-- user.ts
|   |-- workflow.ts
|
|-- tests/
|   |-- e2e/
|   |   |-- login.spec.js
|   |   |-- toolCreation.spec.js
|   |   |-- workflowDesign.spec.js
|   |
|   |-- unit/
|       |-- components/
|       |-- services/
|       |-- composables/
|
|-- App.vue
|-- main.js
```

## Detailed Breakdown

### `/assets`
Contains static files used throughout the application.
- `/images`: Image files (PNG, JPG, SVG, etc.)
- `/fonts`: Custom font files
- `/styles`: Global CSS files

### `/components`
Reusable Vue components used across multiple views.
Each component has its own directory containing:
- `ComponentName.vue`: The Vue component file
- `useComponentName.js`: Composable for component logic
- `ComponentName.spec.js`: Unit tests for the component

### `/layouts`
Vue components that define the overall structure of pages.
- `DefaultLayout.vue`: Default layout for most pages
- `AdminLayout.vue`: Layout for admin pages

### `/views`
Components that correspond to routes/pages in the application.
Each view has its own directory containing:
- `ViewName.vue`: The main view component
- `useViewName.js`: Composable for view-specific logic
- `viewNameApi.js`: API calls specific to this view
- `ViewName.spec.js`: Unit tests for the view
- `/components`: Subdirectory for view-specific components
  - Each component follows the same structure as in `/components`

### `/services`
Modules for interacting with external APIs.
- `api.js`: Configured Axios instance
- `userAuth.js`: Authentication-related API calls
- `toolsApi.js`: Tool-related API calls
- `workflowApi.js`: Workflow-related API calls

### `/composables`
Reusable logic using Vue's Composition API.
- `useAuth.js`: Authentication logic
- `useTools.js`: Tool-related logic
- `useWorkflow.js`: Workflow-related logic
- `usePagination.js`: Pagination logic

### `/router`
Vue Router setup and route definitions.
- `index.js`: Router instance and configuration
- `routes.js`: Route definitions

### `/store`
Vuex store for state management.
- `index.js`: Store instance and configuration
- `/modules`: Vuex modules for different domains
  - `user.js`: User-related state management
  - `tools.js`: Tool-related state management
  - `workflow.js`: Workflow-related state management

### `/utils`
Pure JavaScript utility functions.
- `formatters.js`: Data formatting functions
- `validators.js`: Data validation functions
- `helpers.js`: Miscellaneous helper functions

### `/config`
Application-wide configuration and constants.
- `constants.js`: Application constants
- `environment.js`: Environment-specific configurations

### `/types`
TypeScript type definitions (if using TypeScript).
- `tool.ts`: Tool-related types
- `user.ts`: User-related types
- `workflow.ts`: Workflow-related types

### `/tests`
Test files for the application.
- `/e2e`: End-to-end tests
- `/unit`: Unit tests, mirroring the src directory structure

### Root Files
- `App.vue`: The root Vue component
- `main.js`: The application entry point

## Key Points

1. **Component Structure**: Each component (whether in `/components` or view-specific) has its own directory with four files: Vue component, composable, API file, and spec file.

2. **API Organization**: 
   - Global API services are in `/services`.
   - Component-specific API calls are in `componentNameApi.js` files within each component's directory.

3. **View Organization**: Each view has its own directory with view-specific components nested in a `components` subdirectory.

4. **Composables**: Used for extracting and reusing component logic.

5. **Testing**: The `tests` directory mirrors the `src` structure for easy correlation between source and test files.

6. **TypeScript Support**: The `/types` directory contains TypeScript definitions, supporting typed development.

## Best Practices

1. **Naming Conventions**: 
   - Use PascalCase for component files and directories
   - Use camelCase for composables and API files
   - Use kebab-case for HTML attributes and CSS classes

2. **Encapsulation**: Keep component-specific logic and API calls within the component's directory.

3. **Reusability**: Extract common logic into composables or utility functions.

4. **State Management**: Use Vuex for global state, and component-level state for local concerns.

5. **Testing**: Write unit tests for all components, composables, and services. Write e2e tests for critical user flows.

6. **Documentation**: Keep inline documentation in components and functions. Update this guide as the structure evolves.

By following this structure and these practices, we ensure a scalable, maintainable, and well-organized Vue.js application.