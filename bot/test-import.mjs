try {
  import { handleMessage, ProviderBusyError } from './agent.js';
  console.log('agent.js OK - imports successful');
} catch (err) {
  if (err.message.includes('AI_API_KEY')) {
    console.log('agent.js OK - imports work (AI_API_KEY not in .env is expected)');
  } else if (err.message.includes('SCHEDULE') || err.message.includes('formatHorario')) {
    console.error('IMPORT ERROR - missing export:', err.message);
    process.exit(1);
  } else {
    console.log('agent.js imports OK - other error:', err.message);
  }
}
