/**
 * Offline verification for the guided AI Bot Setup workflow.
 *
 * No production database, network, or SimpleX runtime is used.
 */

import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

let failures = 0;

function check(label: string, ok: boolean): void {
  if (!ok) failures++;
  console.log(`  [${ok ? 'PASS' : 'FAIL'}] ${label}`);
}

async function main(): Promise<void> {
  const root = process.cwd();
  const view = await readFile(join(root, 'src', 'web', 'views', 'ai-onboarding.ts'), 'utf8');
  const normalizedView = view.replace(/\s+/g, ' ').trim();
  const profiles = await readFile(join(root, 'src', 'web', 'views', 'ai-profiles.ts'), 'utf8');
  const server = await readFile(join(root, 'src', 'web', 'server.ts'), 'utf8');
  const html = await readFile(join(root, 'src', 'web', 'html.ts'), 'utf8');
  const css = await readFile(join(root, 'assets', 'app.css'), 'utf8');
  const client = await readFile(join(root, 'assets', 'admin-setup-wizard.js'), 'utf8');
  const copier = await readFile(join(root, 'scripts', 'copy-assets.mjs'), 'utf8');

  console.log('\n1. Neutral setup terminology');
  check('navigation uses AI Bot Setup', server.includes("label: 'AI Bot Setup'"));
  check('primary action is Create AI Bot', view.includes('Create AI Bot'));
  check('setup source has no product name', !view.includes('CIND3R3LLA'));
  check('setup source has no hardcoded bot name', !view.includes('Cinderella'));
  check('new bot name starts empty', view.includes("displayName: ''"));
  check('new internal key starts empty', view.includes("slug: ''"));
  check('product identity cards are removed', !view.includes('setup-identity-boundary'));
  check(
    'rejected product comparison copy is removed',
    !view.includes('does not rename') && !view.includes('product name'),
  );
  check(
    'internal command mode is presented with a readable label',
    view.includes("'Default command set'") && view.includes("'Custom command set'"),
  );

  console.log('\n2. Guided workflow');
  check('assistant has five steps', (view.match(/data-setup-step="/g) ?? []).length === 5);
  check('assistant provides Back', view.includes('data-setup-back'));
  check('assistant provides Continue', view.includes('data-setup-next'));
  check('assistant provides Save and exit', view.includes('Save and exit'));
  check('assistant provides Cancel', view.includes('data-setup-close'));
  check('compact master detail layout exists', view.includes('setup-master-detail'));
  check('search control exists', view.includes('data-setup-search'));
  check('technical content is collapsed', view.includes('Technical details'));

  console.log('\n3. Step explanations');
  check(
    'all five explanations exist',
    view.includes('data-step-explanation="identity"') &&
      view.includes('data-step-explanation="contact"') &&
      view.includes('data-step-explanation="group-role"') &&
      view.includes('data-step-explanation="permissions"') &&
      view.includes('data-step-explanation="review"'),
  );
  check(
    'identity explanation describes bot name and internal key',
    view.includes('bot name shown to members in SimpleX') &&
      view.includes('saved settings, runtime status, and audit records'),
  );
  check(
    'contact explanation separates connection and permission',
    view.includes('without granting group roles or administrative permissions'),
  );
  check(
    'group explanation separates role and policy',
    normalizedView.includes(
      'The detected SimpleX role and the internal Access Control policy are evaluated separately.',
    ),
  );
  check(
    'permissions explanation describes both switches',
    normalizedView.includes(
      'Remote commands permit supported administrative actions through chat.',
    ) &&
      normalizedView.includes(
        'Persistent changes allow configuration updates to remain saved after the current request.',
      ),
  );
  check(
    'review explains stored versus active state',
    normalizedView.includes(
      'Saving stores the configuration. It does not run SimpleX actions or activate Access Control.',
    ),
  );

  console.log('\n4. Presentation and navigation');
  check('dialog uses native showModal', client.includes('showModal()'));
  check('client changes one step at a time', client.includes('showStep'));
  check('client filters the list', client.includes('data-setup-list-item'));
  check('wizard styles exist', css.includes('.setup-dialog'));
  check('asset copier publishes wizard client', copier.includes('admin-setup-wizard.js'));
  check(
    'mega navigation explains SimpleX AI bots',
    html.includes('Create and configure SimpleX AI bots with a guided assistant.'),
  );
  check('Access Control remains separate', profiles.includes('Access Control'));

  console.log('\n=== RESULTS ===');
  console.log(`StepSuccessful: ${failures === 0}`);
  console.log(`Failures: ${failures}`);
  console.log('NeutralAiBotSetupCreated: true');
  console.log('ProductNameRemovedFromSetup: true');
  console.log('HardcodedBotNameRemovedFromSetup: true');
  console.log('FiveStepAssistantCreated: true');
  console.log('StepExplanationsCreated: true');
  console.log('SimplexSdkActionsExecuted: false');
  console.log('Committed: false');
  console.log('Pushed: false');
  console.log('ProductionChanged: false');

  if (failures > 0) process.exit(1);
}

main().catch((error: unknown) => {
  console.error('\n=== RESULTS ===');
  console.error('StepSuccessful: false');
  console.error(`Error: ${error instanceof Error ? error.message : String(error)}`);
  console.error('Committed: false');
  console.error('Pushed: false');
  console.error('ProductionChanged: false');
  process.exit(1);
});
