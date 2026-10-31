process.removeAllListeners('warning');
process.on('warning', (warning) => {
  if (warning.name === 'ExperimentalWarning' && /SQLite/.test(warning.message)) {
    return;
  }

  console.error(warning);
});