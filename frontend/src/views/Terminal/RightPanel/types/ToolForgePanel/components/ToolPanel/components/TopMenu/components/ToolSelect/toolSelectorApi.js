import axios from 'axios';
import { API_CONFIG } from '@/tt.config.js';

export const fetchCustomTools = async () => {
  try {
    const response = await axios.get(`${API_CONFIG.BASE_URL}/custom-tools`);
    return response.data.tools;
  } catch (error) {
    console.error('Error fetching custom tools:', error);
    throw error;
  }
};