import express from 'express';
import ContractModel from '../models/ContractModel.js';
import ContractsService from '../services/evolution/ContractsService.js';
import { authenticateToken } from './Middleware.js';

const ContractRoutes = express.Router();

ContractRoutes.get('/', authenticateToken, async (req, res) => {
  try {
    const { status, targetType } = req.query;
    const contracts = await ContractModel.findByUserId(req.user.userId, { status, targetType });
    res.json({ success: true, contracts });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

ContractRoutes.post('/', authenticateToken, async (req, res) => {
  try {
    const { targetType, targetId, name, predicate, confidence } = req.body || {};
    if (!targetType || !name || !predicate) {
      return res.status(400).json({ error: 'targetType, name, predicate required' });
    }
    const id = await ContractModel.create({
      userId: req.user.userId, targetType, targetId, name, predicate,
      source: 'authored', confidence,
    });
    const contract = await ContractModel.findOne(id);
    res.status(201).json({ success: true, contract });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

ContractRoutes.get('/:id', authenticateToken, async (req, res) => {
  try {
    const contract = await ContractModel.findOne(req.params.id);
    if (!contract) return res.status(404).json({ error: 'Not found' });
    if (contract.user_id !== req.user.userId) return res.status(403).json({ error: 'Forbidden' });
    res.json({ success: true, contract });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

ContractRoutes.get('/:id/violations', authenticateToken, async (req, res) => {
  try {
    const contract = await ContractModel.findOne(req.params.id);
    if (!contract) return res.status(404).json({ error: 'Not found' });
    if (contract.user_id !== req.user.userId) return res.status(403).json({ error: 'Forbidden' });
    const violations = await ContractModel.violationsForContract(req.params.id);
    res.json({ success: true, violations });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

ContractRoutes.patch('/:id', authenticateToken, async (req, res) => {
  try {
    const contract = await ContractModel.findOne(req.params.id);
    if (!contract) return res.status(404).json({ error: 'Not found' });
    if (contract.user_id !== req.user.userId) return res.status(403).json({ error: 'Forbidden' });
    if (typeof req.body.status === 'string') {
      await ContractModel.setStatus(req.params.id, req.body.status);
    }
    const updated = await ContractModel.findOne(req.params.id);
    res.json({ success: true, contract: updated });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

ContractRoutes.post('/check', authenticateToken, async (req, res) => {
  try {
    const { targetType, targetId, runtimeState, sourceExecutionId } = req.body || {};
    const result = await ContractsService.check({ targetType, targetId, runtimeState, sourceExecutionId });
    res.json({ success: true, ...result });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

ContractRoutes.delete('/:id', authenticateToken, async (req, res) => {
  try {
    const changes = await ContractModel.delete(req.params.id, req.user.userId);
    res.json({ success: true, deleted: changes > 0 });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

console.log('Contract Routes Started...');
export default ContractRoutes;
