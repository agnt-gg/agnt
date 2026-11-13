/** Client for the year in review behind AGNT One's Wrapped cards: `/api/wrapped/:year`. */
import axios from 'axios';
import { API_CONFIG } from '@/tt.config.js';

const auth = () => {
  const token = localStorage.getItem('token');
  return token ? { Authorization: `Bearer ${token}` } : {};
};

export async function getYearInReview(year) {
  return (await axios.get(`${API_CONFIG.BASE_URL}/wrapped/${encodeURIComponent(year)}`, { headers: auth() })).data;
}
