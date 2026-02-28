import express from 'express';
import SkillService from '../services/SkillService.js';
import { authenticateToken } from './Middleware.js';

const SkillRoutes = express.Router();

SkillRoutes.get('/', authenticateToken, SkillService.getAllSkills);
SkillRoutes.post('/', authenticateToken, SkillService.createSkill);
SkillRoutes.get('/:id', authenticateToken, SkillService.getSkill);
SkillRoutes.put('/:id', authenticateToken, SkillService.updateSkill);
SkillRoutes.delete('/:id', authenticateToken, SkillService.deleteSkill);

console.log('Skill Routes Started...');

export default SkillRoutes;
