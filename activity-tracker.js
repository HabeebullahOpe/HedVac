//activity-tracker.js
class ActivityTracker {
  constructor() {
    this.userActivity = new Map();
    this.guildMembers = new Map();
  }

  trackMessage(message) {
    if (message.author.bot) return;
    
    const userId = message.author.id;
    const guildId = message.guild?.id;
    
    if (guildId) {
      if (!this.userActivity.has(guildId)) {
        this.userActivity.set(guildId, new Map());
      }
      
      const guildActivity = this.userActivity.get(guildId);
      guildActivity.set(userId, Date.now());
    }
  }

  trackPresenceUpdate(oldPresence, newPresence) {
    if (!newPresence || newPresence.user.bot) return;
    
    const userId = newPresence.user.id;
    const guildId = newPresence.guild.id;
    
    if (newPresence.status !== 'offline') {
      if (!this.userActivity.has(guildId)) {
        this.userActivity.set(guildId, new Map());
      }
      
      const guildActivity = this.userActivity.get(guildId);
      guildActivity.set(userId, Date.now());
    }
  }

  getActiveUsers(guildId, durationMinutes = 60) {
    const guildActivity = this.userActivity.get(guildId);
    if (!guildActivity) return [];
    
    const cutoffTime = Date.now() - (durationMinutes * 60 * 1000);
    const activeUsers = [];
    
    for (const [userId, lastActivity] of guildActivity) {
      if (lastActivity >= cutoffTime) {
        activeUsers.push(userId);
      }
    }
    
    return activeUsers;
  }
}

module.exports = new ActivityTracker();