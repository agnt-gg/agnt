import express from 'express';
import WalletModel from '../models/WalletModel.js';
import WalletService from '../services/wallet/WalletService.js';
import { authenticateToken } from './Middleware.js';

const WalletRoutes = express.Router();

WalletRoutes.get('/', authenticateToken, async (req, res) => {
  try {
    const { ownerType, status } = req.query;
    const wallets = await WalletModel.findByUserId(req.user.userId, { ownerType, status });
    res.json({ success: true, wallets });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

WalletRoutes.get('/root', authenticateToken, async (req, res) => {
  try {
    const wallet = await WalletService.getOrCreateRoot(req.user.userId);
    res.json({ success: true, wallet });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

WalletRoutes.post('/root/topup', authenticateToken, async (req, res) => {
  try {
    const { amount, note } = req.body || {};
    const root = await WalletService.getOrCreateRoot(req.user.userId);
    const updated = await WalletService.topUp(root.id, Number(amount), { note });
    res.json({ success: true, wallet: updated });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

WalletRoutes.get('/:id', authenticateToken, async (req, res) => {
  try {
    const wallet = await WalletModel.findOne(req.params.id);
    if (!wallet) return res.status(404).json({ error: 'Wallet not found' });
    if (wallet.user_id !== req.user.userId) return res.status(403).json({ error: 'Forbidden' });
    res.json({ success: true, wallet });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

WalletRoutes.get('/:id/ledger', authenticateToken, async (req, res) => {
  try {
    const wallet = await WalletModel.findOne(req.params.id);
    if (!wallet) return res.status(404).json({ error: 'Wallet not found' });
    if (wallet.user_id !== req.user.userId) return res.status(403).json({ error: 'Forbidden' });
    const limit = Math.min(parseInt(req.query.limit) || 200, 1000);
    const ledger = await WalletModel.ledgerFor(req.params.id, limit);
    res.json({ success: true, ledger });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

WalletRoutes.post('/:id/release', authenticateToken, async (req, res) => {
  try {
    const wallet = await WalletModel.findOne(req.params.id);
    if (!wallet) return res.status(404).json({ error: 'Wallet not found' });
    if (wallet.user_id !== req.user.userId) return res.status(403).json({ error: 'Forbidden' });
    const closed = await WalletService.release(req.params.id);
    res.json({ success: true, wallet: closed });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

console.log('Wallet Routes Started...');
export default WalletRoutes;
