<template>
  <div class="provider-form">
    <h3>{{ isEditing ? "Edit Provider" : "Add New Provider" }}</h3>
    <form @submit.prevent="submitForm">
      <div class="form-group">
        <label for="id">ID:</label>
        <input
          type="text"
          id="id"
          v-model="form.id"
          required
          :disabled="isEditing"
        />
      </div>
      <div class="form-group">
        <label for="name">Name:</label>
        <input type="text" id="name" v-model="form.name" required />
      </div>
      <div class="form-group">
        <label for="icon">Icon:</label>
        <input type="text" id="icon" v-model="form.icon" required />
      </div>
      <div class="form-group">
        <label for="categories">Categories:</label>
        <input type="text" id="categories" v-model="categoriesInput" required />
        <small>Separate categories with commas</small>
      </div>
      <div class="form-group">
        <label for="connectionType">Connection Type:</label>
        <select id="connectionType" v-model="form.connectionType" required>
          <option value="oauth">OAuth</option>
          <option value="apikey">API Key</option>
        </select>
      </div>
      <div class="form-group">
        <label for="instructions">Instructions:</label>
        <textarea
          id="instructions"
          v-model="form.instructions"
          rows="3"
        ></textarea>
      </div>
      <div class="form-group" v-if="form.connectionType === 'apikey'">
        <label for="customPrompt">Custom Prompt:</label>
        <input type="text" id="customPrompt" v-model="form.customPrompt" />
      </div>
      <button type="submit">{{ isEditing ? "Update" : "Add" }} Provider</button>
    </form>
    <SimpleModal ref="modal" />
  </div>
</template>

<script setup>
import { ref, computed, watch } from "vue";
import { API_CONFIG } from "@/tt.config.js";
import SimpleModal from "@/views/_components/common/SimpleModal.vue";

const props = defineProps({
  provider: {
    type: Object,
    default: () => ({
      id: "",
      name: "",
      icon: "",
      categories: [],
      connectionType: "oauth",
      instructions: "",
      customPrompt: "",
    }),
  },
});

const emit = defineEmits(["provider-added", "provider-updated"]);

const form = ref({ ...props.provider });
const categoriesInput = ref(props.provider.categories.join(", "));

const isEditing = computed(() => !!props.provider.id);

watch(
  () => props.provider,
  (newProvider) => {
    form.value = { ...newProvider };
    categoriesInput.value = newProvider.categories.join(", ");
  },
  { deep: true }
);

const modal = ref(null);

const submitForm = async () => {
  const providerData = {
    ...form.value,
    categories: categoriesInput.value.split(",").map((cat) => cat.trim()),
  };

  const token = localStorage.getItem("token");
  const url = isEditing.value
    ? `${API_CONFIG.REMOTE_URL}/auth/providers/${form.value.id}`
    : `${API_CONFIG.REMOTE_URL}/auth/providers`;
  const method = isEditing.value ? "PUT" : "POST";

  try {
    const response = await fetch(url, {
      method,
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify(providerData),
    });

    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }

    const result = await response.json();
    if (isEditing.value) {
      emit("provider-updated", providerData);
    } else {
      emit("provider-added", providerData);
    }

    // Reset form if adding a new provider
    if (!isEditing.value) {
      form.value = {
        id: "",
        name: "",
        icon: "",
        categories: [],
        connectionType: "oauth",
        instructions: "",
        customPrompt: "",
      };
      categoriesInput.value = "";
    }
  } catch (error) {
    console.error("Error submitting provider:", error);
    await modal.value.showModal({
      title: "Error",
      message: `Failed to ${isEditing.value ? "update" : "add"} provider. Please try again.`,
      confirmText: "OK",
      showCancel: false,
    });
  }
};
</script>

<style scoped>
.provider-form {
  max-width: 500px;
  margin: 0 auto;
}

.form-group {
  width: 100%;
  margin-bottom: 15px;
}

label {
  display: block;
  margin-bottom: 5px;
}

input[type="text"],
select,
textarea {
  width: 100%;
  padding: 8px;
  border: 1px solid #ddd;
  border-radius: 4px;
}

button {
  background-color: var(--color-primary);
  color: white;
  padding: 10px 15px;
  border: none;
  border-radius: 4px;
  cursor: pointer;
}

button:hover {
  background-color: var(--color-primary-dark);
}
</style>
