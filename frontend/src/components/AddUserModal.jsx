import { useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { X, Search, User } from 'lucide-react';
import axios from 'axios';

export function AddUserModal({ onClose, onAdd }) {
  const [username, setUsername] = useState('');

  const lookupMutation = useMutation({
    mutationFn: async (username) => {
      const res = await axios.post('/api/users/lookup', { username });
      return res.data;
    },
    onSuccess: (user) => {
      onAdd(user);
    },
  });

  const handleSubmit = (e) => {
    e.preventDefault();
    if (username.trim()) {
      lookupMutation.mutate(username.trim());
    }
  };

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
      <div className="bg-x-dark border border-x-border rounded-lg w-full max-w-md">
        <div className="p-6">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-xl font-bold">Add User Column</h2>
            <button
              onClick={onClose}
              className="p-1 hover:bg-x-border rounded transition-colors"
            >
              <X className="w-5 h-5" />
            </button>
          </div>

          <form onSubmit={handleSubmit}>
            <div className="mb-4">
              <label className="block text-sm text-x-gray mb-2">
                Enter Twitter/X username
              </label>
              <div className="relative">
                <input
                  type="text"
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  placeholder="@username or username"
                  disabled={lookupMutation.isPending}
                  className="w-full input pl-10"
                  autoFocus
                />
                <User className="absolute left-3 top-1/2 transform -translate-y-1/2 w-5 h-5 text-x-gray" />
              </div>
            </div>

            {lookupMutation.error && (
              <div className="mb-4 p-3 bg-red-900 bg-opacity-20 border border-red-500 rounded-lg">
                <p className="text-sm text-red-400">
                  {lookupMutation.error.response?.data?.error || 'Failed to find user'}
                </p>
              </div>
            )}

            <div className="flex space-x-3">
              <button
                type="button"
                onClick={onClose}
                className="flex-1 btn-secondary"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={!username.trim() || lookupMutation.isPending}
                className="flex-1 btn-primary"
              >
                {lookupMutation.isPending ? (
                  <>
                    <Search className="w-4 h-4 inline mr-1 animate-spin" />
                    Searching...
                  </>
                ) : (
                  <>
                    <Search className="w-4 h-4 inline mr-1" />
                    Add User
                  </>
                )}
              </button>
            </div>
          </form>

          <div className="mt-6 pt-6 border-t border-x-border">
            <p className="text-xs text-x-gray">
              Enter any X/Twitter username to load their tweets and analyze their content.
              You can add multiple users to compare their tweets and find similarities.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}