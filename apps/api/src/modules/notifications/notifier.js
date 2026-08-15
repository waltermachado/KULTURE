import { createLogNotifier } from './log.js';
import { createEvolutionNotifier } from './evolution.js';

export function createNotifier(env, log, prisma) {
  if (env.WHATSAPP_PROVIDER === 'evolution') {
    return createEvolutionNotifier(env, log, prisma);
  }
  return createLogNotifier(env, log, prisma);
}
