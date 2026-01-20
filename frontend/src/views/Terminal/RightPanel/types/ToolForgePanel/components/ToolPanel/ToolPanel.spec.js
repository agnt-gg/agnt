import { shallowMount } from '@vue/test-utils'
import { describe, it, expect, vi } from 'vitest'
import { reactive, ref } from 'vue'
import ToolPanel from './ToolPanel.vue'

// Mock child components
vi.mock('./components/TopMenu/TopMenu.vue', () => ({
  default: {
    name: 'TopMenu',
    template: '<div class="top-menu">Top Menu</div>'
  }
}))

vi.mock('./components/FieldsArea/FieldsArea.vue', () => ({
  default: {
    name: 'FieldsArea',
    template: '<div class="fields-area">Fields Area</div>'
  }
}))

// Mock custom wrapper components
const mockComponent = (name) => ({
  name,
  template: `<div class="${name}">${name}<slot></slot></div>`
})

const initialFormState = {
  title: "",
  instructions: "",
  icon: "custom",
  provider: "",
  model: "",
  customFields: {},
};

// Mock the useToolPanel composable
const mockFormData = reactive({...initialFormState});
const mockSelectedTool = ref(null);
const mockClearFields = vi.fn();

vi.mock('./useToolPanel', () => ({
  useToolPanel: () => ({
    selectedTool: mockSelectedTool,
    formData: mockFormData,
    templates: [],
    handleGenerateClick: vi.fn(),
    onFormUpdated: vi.fn((key, value) => {
      mockFormData[key] = value;
    }),
    onToolSelected: vi.fn((tool) => {
      mockSelectedTool.value = tool;
    }),
    clearFields: mockClearFields,
    onToolSaved: vi.fn(),
    onToolDeleted: vi.fn(),
    saveFormDataToDB: vi.fn(),
    confirmDelete: vi.fn(),
    importTemplate: vi.fn(),
    shareTemplate: vi.fn(),
    onToolGenerated: vi.fn(),
    fetchTemplates: vi.fn()
  })
}))

describe('ToolPanel', () => {
  it('renders correctly', async () => {
    const wrapper = shallowMount(ToolPanel, {
      global: {
        stubs: {
          'editor-panel': mockComponent('editor-panel'),
          'top-section': mockComponent('top-section'),
          'bottom-menu': mockComponent('bottom-menu'),
        }
      }
    })
    
    expect(wrapper.findComponent({ name: 'TopMenu' }).exists()).toBe(true)
    expect(wrapper.findComponent({ name: 'FieldsArea' }).exists()).toBe(true)
    expect(wrapper.find('.editor-panel').exists()).toBe(true)
    expect(wrapper.find('.top-section').exists()).toBe(true)
    expect(wrapper.find('.bottom-menu').exists()).toBe(true)
  })

  it('clears fields when clear button is clicked', async () => {
    const wrapper = shallowMount(ToolPanel, {
      global: {
        stubs: {
          'editor-panel': mockComponent('editor-panel'),
          'top-section': mockComponent('top-section'),
          'bottom-menu': mockComponent('bottom-menu'),
        }
      }
    })

    const topMenu = wrapper.findComponent({ name: 'TopMenu' })
    await topMenu.vm.$emit('clear-fields')

    expect(mockClearFields).toHaveBeenCalled()
  })

  it('updates form data when FieldsArea emits form-updated', async () => {
    const wrapper = shallowMount(ToolPanel, {
      global: {
        stubs: {
          'editor-panel': mockComponent('editor-panel'),
          'top-section': mockComponent('top-section'),
          'bottom-menu': mockComponent('bottom-menu'),
        }
      }
    })

    const fieldsArea = wrapper.findComponent({ name: 'FieldsArea' })
    await fieldsArea.vm.$emit('form-updated', 'title', 'New Title')

    expect(mockFormData.title).toBe('New Title')
  })

  it('calls handleGenerateClick when generate button is clicked', async () => {
    const wrapper = shallowMount(ToolPanel, {
      global: {
        stubs: {
          'editor-panel': mockComponent('editor-panel'),
          'top-section': mockComponent('top-section'),
          'bottom-menu': mockComponent('bottom-menu'),
        }
      }
    })

    const generateButton = wrapper.find('#generate')
    await generateButton.trigger('click')

    expect(wrapper.vm.handleGenerateClick).toHaveBeenCalled()
  })

  it('updates selectedTool when TopMenu emits tool-selected', async () => {
    const wrapper = shallowMount(ToolPanel, {
      global: {
        stubs: {
          'editor-panel': mockComponent('editor-panel'),
          'top-section': mockComponent('top-section'),
          'bottom-menu': mockComponent('bottom-menu'),
        }
      }
    })

    const mockTool = { id: '1', title: 'Test Tool' }
    const topMenu = wrapper.findComponent({ name: 'TopMenu' })
    await topMenu.vm.$emit('tool-selected', mockTool)

    expect(mockSelectedTool.value).toEqual(mockTool)
  })

  it('provides toolActions and toolSelector', () => {
    const wrapper = shallowMount(ToolPanel, {
      global: {
        stubs: {
          'editor-panel': mockComponent('editor-panel'),
          'top-section': mockComponent('top-section'),
          'bottom-menu': mockComponent('bottom-menu'),
        }
      }
    })

    const toolActions = wrapper.vm.$.provides.toolActions
    const toolSelector = wrapper.vm.$.provides.toolSelector

    expect(toolActions).toBeDefined()
    expect(toolSelector).toBeDefined()
    expect(toolActions.selectedTool).toBeDefined()
    expect(toolActions.formData).toBeDefined()
    expect(toolSelector.templates).toBeDefined()
    expect(toolSelector.selectedTemplate).toBeDefined()
  })
})