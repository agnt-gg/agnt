/**
 * Event Bridge for ToolForge
 * Provides a communication layer between different parts of the ToolForge system
 */

class ToolForgeEventBridge {
  constructor() {
    this.listeners = new Map();
    this.toolPanelMethods = null;
  }

  /**
   * Initialize the event bridge with tool panel methods
   * @param {Object} methods - Object containing tool panel methods
   */
  initialize(methods) {
    this.toolPanelMethods = methods;
  }

  /**
   * Clean up when component is destroyed
   */
  destroy() {
    this.listeners.clear();
    this.toolPanelMethods = null;
  }

  /**
   * Register an event listener
   * @param {string} event - Event name
   * @param {Function} callback - Callback function
   */
  on(event, callback) {
    if (!this.listeners.has(event)) {
      this.listeners.set(event, []);
    }
    this.listeners.get(event).push(callback);
  }

  /**
   * Unregister an event listener
   * @param {string} event - Event name
   * @param {Function} callback - Callback function
   */
  off(event, callback) {
    if (!this.listeners.has(event)) return;

    const callbacks = this.listeners.get(event);
    const index = callbacks.indexOf(callback);
    if (index > -1) {
      callbacks.splice(index, 1);
    }
  }

  /**
   * Emit an event
   * @param {string} event - Event name
   * @param {*} data - Event data
   */
  emit(event, data) {
    if (!this.listeners.has(event)) return;

    this.listeners.get(event).forEach((callback) => {
      callback(data);
    });
  }

  /**
   * Update form data
   * @param {Object} formData - Form data to update
   */
  updateFormData(formData) {
    if (this.toolPanelMethods?.updateFormData) {
      this.toolPanelMethods.updateFormData(formData);
    }
  }

  /**
   * Add a custom field
   * @param {Object} field - Field configuration
   */
  addCustomField(field) {
    if (this.toolPanelMethods?.addCustomField) {
      this.toolPanelMethods.addCustomField(field);
    }
  }

  /**
   * Delete a custom field
   * @param {string} fieldName - Name of field to delete
   */
  deleteCustomField(fieldName) {
    if (this.toolPanelMethods?.deleteCustomField) {
      this.toolPanelMethods.deleteCustomField(fieldName);
    }
  }

  /**
   * Save form data to database
   */
  saveFormDataToDB() {
    if (this.toolPanelMethods?.saveFormDataToDB) {
      return this.toolPanelMethods.saveFormDataToDB();
    }
  }

  /**
   * Clear all fields
   */
  clearFields() {
    if (this.toolPanelMethods?.clearFields) {
      this.toolPanelMethods.clearFields();
    }
  }

  /**
   * Select a tool
   * @param {Object} tool - Tool to select
   */
  onToolSelected(tool) {
    if (this.toolPanelMethods?.onToolSelected) {
      this.toolPanelMethods.onToolSelected(tool);
    }
  }
}

// Export singleton instance
export default new ToolForgeEventBridge();
