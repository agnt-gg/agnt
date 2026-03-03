import { API_CONFIG } from '@/tt.config.js';

function getHeaders() {
  const headers = { 'Content-Type': 'application/json' };
  const token = localStorage.getItem('token');
  if (token) headers['Authorization'] = `Bearer ${token}`;
  return headers;
}

export async function getTree(dir = '') {
  const params = dir ? `?dir=${encodeURIComponent(dir)}` : '';
  const res = await fetch(`${API_CONFIG.BASE_URL}/filesystem/tree${params}`, { headers: getHeaders() });
  if (!res.ok) throw new Error(`Failed to fetch tree: ${res.statusText}`);
  return res.json();
}

export async function getFile(path) {
  const res = await fetch(`${API_CONFIG.BASE_URL}/filesystem/file?path=${encodeURIComponent(path)}`, { headers: getHeaders() });
  if (!res.ok) throw new Error(`Failed to read file: ${res.statusText}`);
  return res.json();
}

export async function saveFile(path, content) {
  const res = await fetch(`${API_CONFIG.BASE_URL}/filesystem/file`, {
    method: 'POST',
    headers: getHeaders(),
    body: JSON.stringify({ path, content }),
  });
  if (!res.ok) throw new Error(`Failed to save file: ${res.statusText}`);
  return res.json();
}

export async function createDirectory(path) {
  const res = await fetch(`${API_CONFIG.BASE_URL}/filesystem/mkdir`, {
    method: 'POST',
    headers: getHeaders(),
    body: JSON.stringify({ path }),
  });
  if (!res.ok) throw new Error(`Failed to create directory: ${res.statusText}`);
  return res.json();
}

export async function renameFile(oldPath, newPath) {
  const res = await fetch(`${API_CONFIG.BASE_URL}/filesystem/rename`, {
    method: 'POST',
    headers: getHeaders(),
    body: JSON.stringify({ oldPath, newPath }),
  });
  if (!res.ok) throw new Error(`Failed to rename: ${res.statusText}`);
  return res.json();
}

export async function deleteFile(path) {
  const res = await fetch(`${API_CONFIG.BASE_URL}/filesystem/file?path=${encodeURIComponent(path)}`, {
    method: 'DELETE',
    headers: getHeaders(),
  });
  if (!res.ok) throw new Error(`Failed to delete: ${res.statusText}`);
  return res.json();
}
