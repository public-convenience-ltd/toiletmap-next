import { randomBytes } from 'crypto';

export const LOO_ID_LENGTH = 24;

export const generateLooId = () => randomBytes(12).toString('hex');
