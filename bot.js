import { VolumeBoosterBot } from './src/VolumeBoosterBot.js';

// Run the bot
const bot = new VolumeBoosterBot();

// Graceful shutdown function
function gracefulShutdown() {
  if (bot.config && bot.config.enableKeyboard) {
    process.stdin.setRawMode(false);
  }
  bot.stop(); // Ensure bot is stopped
}

// Keyboard triggers
process.on('SIGINT', gracefulShutdown);

bot.init().then(() => {
  if (bot.config.enableKeyboard) {
    process.stdin.setRawMode(true);
    process.stdin.resume();
    process.stdin.on('data', async key => {
      const keyStr = key.toString().toLowerCase();
      if (keyStr.includes('q')) {
        console.log('\nGraceful shutdown triggered...');
        gracefulShutdown();
      } else if (keyStr.includes('w')) {
        console.log('\nMANUAL TRIGGER: Withdrawing all funds...');
        await bot.withdrawAllFunds(); // Call the dedicated withdrawal function
      }
    });
  }
}).catch(console.error);
