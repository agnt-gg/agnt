/**
 * Client for `/api/pairing/*` — phone access and QR device pairing.
 */

import axios from 'axios';
import { API_CONFIG } from '@/tt.config.js';

const auth = () => {
  const token = localStorage.getItem('token');
  return token ? { Authorization: `Bearer ${token}` } : {};
};

const base = () => `${API_CONFIG.BASE_URL}/pairing`;

/** @returns {Promise<{lanEnabled:boolean,bindHost:string,bindSource:string,port:number,restartRequired:boolean,addresses:Array,urls:string[]}>} */
export async function getStatus() {
  const { data } = await axios.get(`${base()}/status`, { headers: auth() });
  return data;
}

/** @param {boolean} enabled */
export async function setLanAccess(enabled) {
  const { data } = await axios.post(`${base()}/lan-access`, { enabled }, { headers: auth() });
  return data;
}

/** Mint a single-use pairing code. @returns {Promise<{code:string,url:string,expiresAt:number,ttlMs:number,origin:string}>} */
export async function createCode() {
  const { data } = await axios.post(`${base()}/code`, {}, { headers: auth() });
  return data;
}

/**
 * Redeem a pairing code for the authorising session's token.
 * Deliberately sends NO Authorization header — the phone has no credentials
 * yet; the code is the credential.
 */
export async function claimCode(code) {
  const { data } = await axios.post(`${base()}/claim`, { code });
  return data;
}

export async function revokeAll() {
  const { data } = await axios.post(`${base()}/revoke`, {}, { headers: auth() });
  return data;
}

export async function restartBackend() {
  const { data } = await axios.post(`${API_CONFIG.BASE_URL}/system/restart`, { reason: 'phone access toggle' }, { headers: auth() });
  return data;
}

export default { getStatus, setLanAccess, createCode, claimCode, revokeAll, restartBackend };
