/** Registers all admin console views (Stage 5). */

import type { FastifyInstance } from 'fastify';
import type { ViewContext } from '../server.js';
import { registerDashboard } from './dashboard.js';
import { registerMessages } from './messages.js';
import { registerConsent } from './consent.js';
import { registerSettings } from './settings.js';
import { registerInteraction } from './interaction.js';
import { registerAi } from './ai.js';
import { registerAiOnboarding } from './ai-onboarding.js';
import { registerAiPersonality } from './ai-personality.js';
import { registerModeration } from './moderation.js';
import { registerBookOfElii } from './book-of-elii.js';
import { registerRecital } from './recital.js';
import { registerAiProfiles } from './ai-profiles.js';
import { registerPlugins } from './plugins.js';
import { registerEmbeds } from './embeds.js';
import { registerSecurity } from './security.js';
import { registerReports } from './reports.js';
import { registerHolds } from './holds.js';
import { registerAdminMedia } from './admin-media.js';
import { registerScreening } from './screening.js';
import { registerBackup } from './backup.js';
import { registerSelectBot } from './select-bot.js';

export function registerAdminViews(app: FastifyInstance, ctx: ViewContext): void {
  registerSelectBot(app, ctx);
  registerDashboard(app, ctx);
  registerMessages(app, ctx);
  registerConsent(app, ctx);
  registerSettings(app, ctx);
  registerInteraction(app, ctx);
  registerAi(app, ctx);
  registerAiOnboarding(app, ctx);
  registerAiPersonality(app, ctx);
  registerModeration(app, ctx);
  registerBookOfElii(app, ctx);
  registerRecital(app, ctx);
  registerAiProfiles(app, ctx);
  registerPlugins(app, ctx);
  registerSecurity(app, ctx);
  registerEmbeds(app, ctx);
  registerReports(app, ctx);
  registerHolds(app, ctx);
  registerAdminMedia(app, ctx);
  registerScreening(app, ctx);
  registerBackup(app, ctx);
}
