const HISTORY_KEY = 'watchPathHistory';
const MAX_HISTORY = 50;

export const pathHistoryService = {
  getHistory(): string[] {
    try {
      const stored = localStorage.getItem(HISTORY_KEY);
      return stored ? JSON.parse(stored) : [];
    } catch (error) {
      console.error('Error loading path history:', error);
      return [];
    }
  },

  addPath(path: string): string[] {
    try {
      let history = this.getHistory();
      
      // Remove the path if it already exists
      history = history.filter(p => p !== path);
      
      // Add to the beginning
      history.unshift(path);
      
      // Keep only the last MAX_HISTORY items
      if (history.length > MAX_HISTORY) {
        history = history.slice(0, MAX_HISTORY);
      }
      
      localStorage.setItem(HISTORY_KEY, JSON.stringify(history));
      return history;
    } catch (error) {
      console.error('Error saving path history:', error);
      return [path];
    }
  },

  clearHistory(): void {
    try {
      localStorage.removeItem(HISTORY_KEY);
    } catch (error) {
      console.error('Error clearing path history:', error);
    }
  }
};