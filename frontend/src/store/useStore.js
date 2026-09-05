import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';

export const useStore = create(
  persist(
    (set, get) => ({
  // User columns
  columns: [],

  addColumn: (userId, username = null) => {
    const id = Date.now().toString();
    set((state) => ({
      columns: [...state.columns, { id, userId, username }],
    }));
  },

  removeColumn: (columnId) => {
    set((state) => ({
      columns: state.columns.filter((c) => c.id !== columnId),
    }));
  },

  // Grok context
  grokContext: {
    userIds: [],
    includeEmbeddings: false,
    includeFollowers: false,
  },

  updateGrokContext: (context) => {
    set((state) => ({
      grokContext: { ...state.grokContext, ...context },
    }));
  },

  // Selected tweets for comparison
  selectedTweets: [],

  toggleTweetSelection: (tweetId) => {
    set((state) => {
      const isSelected = state.selectedTweets.includes(tweetId);
      return {
        selectedTweets: isSelected
          ? state.selectedTweets.filter((id) => id !== tweetId)
          : [...state.selectedTweets, tweetId],
      };
    });
  },

  clearSelection: () => {
    set({ selectedTweets: [] });
  },
    }),
    {
      name: 'x-agent-storage', // unique name for localStorage key
      storage: createJSONStorage(() => localStorage), // use localStorage
      partialize: (state) => ({
        // Only persist essential state
        columns: state.columns,
        grokContext: state.grokContext,
        selectedTweets: state.selectedTweets,
      }),
      version: 1, // state version for migrations
    }
  )
);