import { useState, useEffect, useRef } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { X, Download, Zap, Users, MessageSquare, CheckCircle, AlertCircle, ExternalLink, PlayCircle, Trash2, User, Brain, Copy, Check, Search, ChevronDown, ChevronUp, Rocket } from 'lucide-react';
import { MarkdownRenderer } from './MarkdownRenderer';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer, ReferenceLine } from 'recharts';
import axios from 'axios';

export function UserColumn({ columnId, userId, onClose }) {
  const [showReplies, setShowReplies] = useState(true);
  const [selectedDate, setSelectedDate] = useState(null);
  const [collectionMessage, setCollectionMessage] = useState(null);
  const [embeddingMessage, setEmbeddingMessage] = useState(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchMode, setSearchMode] = useState('text');
  const [showSearchBar, setShowSearchBar] = useState(false);
  const [semanticResults, setSemanticResults] = useState(null);
  const searchTimeoutRef = useRef(null);
  const [followers, setFollowers] = useState([]);
  const [showActions, setShowActions] = useState(false);
  const [dismissedIncomplete, setDismissedIncomplete] = useState(false);
  const [collectAmount, setCollectAmount] = useState(1000);
  const [showCollectDropdown, setShowCollectDropdown] = useState(false);
  // Auto-load stored followers from DB on mount
  const storedFollowersQuery = useQuery({
    queryKey: ['stored-followers', userId],
    queryFn: async () => {
      const res = await axios.get(`/api/users/${userId}/stored-followers`);
      return res.data.data || [];
    },
    enabled: !!userId,
    staleTime: 5 * 60 * 1000,
  });

  // Sync followers state from stored query
  useEffect(() => {
    if (storedFollowersQuery.data && storedFollowersQuery.data.length > 0 && followers.length === 0) {
      setFollowers(storedFollowersQuery.data);
    }
  }, [storedFollowersQuery.data]);

  const getFollowersMutation = useMutation({
    mutationFn: async (maxUsers = 500) => {
      console.log('[Followers] Starting fetch for userId:', userId, 'maxUsers:', maxUsers);
      const res = await axios.post(`/api/users/${userId}/followers-full`, { maxUsers });
      console.log('[Followers] Response received:', res.data);
      console.log('[Followers] Followers data:', res.data.data);
      return res.data.data;
    },
    onSuccess: (data) => {
      console.log('[Followers] Success! Setting followers:', data?.length, 'items');
      setFollowers(data);
      // Invalidate stored followers query to refresh
      queryClient.invalidateQueries({ queryKey: ['stored-followers', userId] });
    },
    onError: (error) => {
      console.error('[Followers] ERROR:', error);
      console.error('[Followers] Error response:', error.response?.data);
      console.error('[Followers] Error status:', error.response?.status);
    }
  });

  // Sync follower IDs from X API (cheap - links existing DB records)
  const syncFollowersMutation = useMutation({
    mutationFn: async () => {
      const res = await axios.post(`/api/users/${userId}/sync-follower-ids`);
      return res.data;
    },
    onSuccess: (data) => {
      console.log('[Followers] Synced:', data.linkedInDb, 'linked from', data.totalFromApi, 'API results');
      queryClient.invalidateQueries({ queryKey: ['stored-followers', userId] });
    },
    onError: (error) => {
      console.error('[Followers] Sync error:', error);
    }
  });
  const [blocked, setBlocked] = useState([]);
  const getBlockedMutation = useMutation({
    mutationFn: async () => {
      console.log('[Blocking] Starting fetch for userId:', userId);
      const res = await axios.post(`/api/users/${userId}/blocking-full`, { maxUsers: 999999 });
      console.log('[Blocking] Response received:', res.data);
      console.log('[Blocking] Blocked data:', res.data.data);
      return res.data.data;
    },
    onSuccess: (data) => {
      console.log('[Blocking] Success! Setting blocked users:', data?.length, 'items');
      setBlocked(data);
    },
    onError: (error) => {
      console.error('[Blocking] ERROR:', error);
      console.error('[Blocking] Error response:', error.response?.data);
      console.error('[Blocking] Error status:', error.response?.status);
      // Optional toast/error message
    }
  });
  const [followerSort, setFollowerSort] = useState('recent'); // 'recent' | 'followers' | 'alphabetical' | 'tweets' | 'oldest'
  const [blockedSort, setBlockedSort] = useState('recent');
  const [activeTab, setActiveTab] = useState('tweets'); // 'tweets' | 'followers' | 'blocking' | 'dossier' | 'metrics'
const [activeMetric, setActiveMetric] = useState('views'); // 'views' | 'likes' | 'engagements'
const metricsQuery = useQuery({
  queryKey: ['userMetrics', userId],
  queryFn: async () => {
    const res = await axios.get(`/api/users/${userId}/metrics?days=30`);
    return res.data;
  },
  enabled: !!userId,
});
  const [dossier, setDossier] = useState(null);
  const [dossierCopied, setDossierCopied] = useState(false);
  const dossierMutation = useMutation({
    mutationFn: async ({ regenerate = false }) => {
      const res = await axios.post(`/api/users/${userId}/dossier?regenerate=${regenerate}`, { maxTweets: 5000 });
      return res.data;
    },
    onSuccess: (data) => {
      setDossier(data.dossier);
    },
    onError: (error) => {
      console.error('Failed to generate dossier', error);
      // Optional message
    }
  });

  const [showSimilarModal, setShowSimilarModal] = useState(false);
  const [similarData, setSimilarData] = useState(null);
  const [discoveryMode, setDiscoveryMode] = useState('followers'); // 'followers' | 'search' – toggle for mode
  const [showSearchesModal, setShowSearchesModal] = useState(false);
  const [suggestedSearches, setSuggestedSearches] = useState([]);
  const [liveTimelineData, setLiveTimelineData] = useState(null);
  const [liveProgress, setLiveProgress] = useState(null);
  const [onboardingStatus, setOnboardingStatus] = useState(null);
  const [showOnboardingModal, setShowOnboardingModal] = useState(false);

  const searchesMutation = useMutation({
    mutationFn: async () => {
      const res = await axios.post(`/api/users/${userId}/suggest-searches`);
      return res.data;
    },
    onSuccess: (data) => {
      refetchSearches(); // Refresh saved searches
      setActiveTab('searches'); // Switch to searches tab to show results
    },
    onError: (error) => {
      console.error('Failed to generate searches', error);
    }
  });

  const semanticSearchMutation = useMutation({
    mutationFn: async (text) => {
      const res = await axios.post('/api/similarities/search', {
        text,
        userId,
        minSimilarity: 0.3,
        limit: 50
      });
      return res.data;
    },
    onSuccess: (data) => {
      setSemanticResults(data.results);
    },
    onError: (error) => {
      console.error('Semantic search failed', error);
      setSemanticResults(null);
    }
  });

  const handleSearchChange = (value) => {
    setSearchQuery(value);
    if (searchMode === 'semantic') {
      if (searchTimeoutRef.current) clearTimeout(searchTimeoutRef.current);
      if (value.trim().length > 0) {
        searchTimeoutRef.current = setTimeout(() => {
          semanticSearchMutation.mutate(value.trim());
        }, 500);
      } else {
        setSemanticResults(null);
      }
    }
  };

  const handleSearchModeChange = (mode) => {
    setSearchMode(mode);
    setSemanticResults(null);
    if (mode === 'semantic' && searchQuery.trim().length > 0) {
      semanticSearchMutation.mutate(searchQuery.trim());
    }
  };

  const clearSearch = () => {
    setSearchQuery('');
    setSemanticResults(null);
    if (searchTimeoutRef.current) clearTimeout(searchTimeoutRef.current);
  };

  const liveTimelineMutation = useMutation({
    mutationFn: async () => {
      setLiveProgress({ stage: 'starting', message: 'Loading saved searches...' });
      const res = await axios.post(`/api/users/${userId}/live-timeline`);
      return res.data;
    },
    onSuccess: (data) => {
      setLiveTimelineData(data);
      setActiveTab('newline');
      setLiveProgress(null);
    },
    onError: (error) => {
      console.error('Failed to generate live timeline', error);
      setLiveProgress(null);
    }
  });

  const onboardingMutation = useMutation({
    mutationFn: async (maxTweets) => {
      const res = await axios.post(`/api/users/${userId}/onboard`, {
        maxTweets: maxTweets || collectAmount,
        includeReplies: false,
        skipIfExists: true
      });
      return res.data;
    },
    onSuccess: (data) => {
      console.log('Onboarding started:', data);
      setShowOnboardingModal(true);
      // Start polling for status
      pollOnboardingStatus();
    },
    onError: (error) => {
      console.error('Failed to start onboarding', error);
    }
  });

  // Poll onboarding status
  const pollOnboardingStatus = async () => {
    const pollInterval = 3000; // 3 seconds
    const maxDuration = 20 * 60 * 1000; // 20 minutes
    const startTime = Date.now();

    const poll = async () => {
      try {
        const res = await axios.get(`/api/users/${userId}/onboard/status`);
        const status = res.data;

        setOnboardingStatus(status);

        // Check if completed or failed
        if (status.currentStep === 'completed' || status.currentStep === 'failed') {
          console.log('Onboarding finished:', status);
          queryClient.invalidateQueries(['user', userId]);
          queryClient.invalidateQueries(['tweets', userId]);
          refetchSearches();
          return;
        }

        // Check if timed out
        if (Date.now() - startTime > maxDuration) {
          console.error('Onboarding polling timed out');
          return;
        }

        // Continue polling
        setTimeout(poll, pollInterval);
      } catch (error) {
        console.error('Failed to poll onboarding status', error);
      }
    };

    poll();
  };

  const similarMutation = useMutation({
    mutationFn: async () => {
      const params = new URLSearchParams({
        limit: 10,
        minSim: 0.6,
        autoCollect: true,
        mode: discoveryMode,
        useDossierSim: true,
        maxCandidates: 50,
        forceRefresh: 'true' // Always compute fresh results instead of using cache
      });
      const res = await axios.get(`/api/users/${userId}/similar-accounts?${params}`);
      return res.data;
    },
    onSuccess: (data) => {
      console.log('Discovered similar accounts for userId:', userId, data);
      setSimilarData(data);
      setShowSimilarModal(true);
      queryClient.invalidateQueries(['users']); // Refresh main users list
    },
    onError: (error) => {
      console.error('Failed to discover similar accounts', error);
    }
  });
  const queryClient = useQueryClient();

  // Fetch user data
  const { data: user } = useQuery({
    queryKey: ['user', userId],
    queryFn: async () => {
      const res = await axios.get(`/api/users/${userId}`);
      return res.data;
    },
  });

  // Fetch tweets
  const { data: tweets, refetch: refetchTweets } = useQuery({
    queryKey: ['tweets', userId, showReplies],
    queryFn: async () => {
      const res = await axios.get(`/api/tweets/user/${userId}?includeReplies=${showReplies}`);
      return res.data;
    },
  });

  // Fetch stats
  const { data: stats } = useQuery({
    queryKey: ['tweetStats', userId],
    queryFn: async () => {
      const res = await axios.get(`/api/tweets/stats/${userId}`);
      return res.data;
    },
  });

  // Fetch saved searches
  const { data: savedSearches, refetch: refetchSearches } = useQuery({
    queryKey: ['searches', userId],
    queryFn: async () => {
      const res = await axios.get(`/api/users/${userId}/searches`);
      return res.data;
    },
  });

  // Fetch collection status to check for interrupted collections
  const { data: collectionStatus, refetch: refetchCollectionStatus } = useQuery({
    queryKey: ['collectionStatus', userId],
    queryFn: async () => {
      const res = await axios.get(`/api/users/${userId}/collection-status`);
      return res.data;
    },
    refetchInterval: 5000 // Refresh every 5 seconds
  });

  // Check for interrupted collections
  const interruptedCollection = collectionStatus?.find(c => c.status === 'interrupted');
  const runningCollection = collectionStatus?.find(c => c.status === 'running');

  // Collection mutation
  const collectMutation = useMutation({
    mutationFn: async (maxTweets) => {
      const body = { includeReplies: true };
      if (maxTweets && maxTweets !== 'all') body.maxTweets = maxTweets;
      const res = await axios.post(`/api/users/${userId}/collect`, body);
      return res.data;
    },
    onSuccess: (data) => {
      setCollectionMessage({
        type: 'success',
        text: `Collection started for @${data.username}`
      });

      // Poll for collection status
      const pollInterval = setInterval(async () => {
        try {
          const statusRes = await axios.get(`/api/users/${userId}/collection-status`);
          const latestCollection = statusRes.data[0];

          if (latestCollection?.status === 'completed') {
            clearInterval(pollInterval);
            setCollectionMessage({
              type: 'success',
              text: `Collected ${latestCollection.itemsCollected} new tweets!`
            });
            queryClient.invalidateQueries(['tweets', userId]);
            queryClient.invalidateQueries(['tweetStats', userId]);
            setTimeout(() => setCollectionMessage(null), 5000);
          } else if (latestCollection?.status === 'failed') {
            clearInterval(pollInterval);
            setCollectionMessage({
              type: 'error',
              text: 'Collection failed: ' + (latestCollection.errorMessage || 'Unknown error')
            });
            setTimeout(() => setCollectionMessage(null), 5000);
          }
        } catch (error) {
          clearInterval(pollInterval);
        }
      }, 2000);

      // Clear message after 30 seconds if still running
      setTimeout(() => {
        clearInterval(pollInterval);
        setCollectionMessage(null);
      }, 30000);
    },
    onError: (error) => {
      setCollectionMessage({
        type: 'error',
        text: error.response?.data?.error || 'Collection failed'
      });
      setTimeout(() => setCollectionMessage(null), 5000);
    }
  });

  // Embeddings mutation
  const embeddingMutation = useMutation({
    mutationFn: async () => {
      const res = await axios.post(`/api/embeddings/process/${userId}`);
      return res.data;
    },
    onSuccess: (data) => {
      setEmbeddingMessage({
        type: 'success',
        text: `Embedding generation started (Job ID: ${data.jobId})`
      });

      // Poll for embedding status
      const pollInterval = setInterval(async () => {
        try {
          const statusRes = await axios.get(`/api/embeddings/status/${data.jobId}`);
          const job = statusRes.data;

          if (job?.status === 'completed') {
            clearInterval(pollInterval);
            setEmbeddingMessage({
              type: 'success',
              text: `Successfully generated embeddings for tweets!`
            });
            queryClient.invalidateQueries(['tweets', userId]);
            queryClient.invalidateQueries(['tweetStats', userId]);
            setTimeout(() => setEmbeddingMessage(null), 5000);
          } else if (job?.status === 'failed') {
            clearInterval(pollInterval);
            setEmbeddingMessage({
              type: 'error',
              text: 'Embedding generation failed: ' + (job.errorMessage || 'Unknown error')
            });
            setTimeout(() => setEmbeddingMessage(null), 5000);
          }
        } catch (error) {
          // If status endpoint doesn't exist, just show success message
          clearInterval(pollInterval);
          setEmbeddingMessage({
            type: 'success',
            text: 'Embedding request submitted successfully'
          });
          queryClient.invalidateQueries(['tweets', userId]);
          queryClient.invalidateQueries(['tweetStats', userId]);
          setTimeout(() => setEmbeddingMessage(null), 5000);
        }
      }, 2000);

      // Clear message after 30 seconds if still running
      setTimeout(() => {
        clearInterval(pollInterval);
        setEmbeddingMessage(null);
      }, 30000);
    },
    onError: (error) => {
      setEmbeddingMessage({
        type: 'error',
        text: error.response?.data?.error || 'Embedding generation failed'
      });
      setTimeout(() => setEmbeddingMessage(null), 5000);
    }
  });

  // Resume collection mutation
  const resumeCollectionMutation = useMutation({
    mutationFn: async () => {
      const res = await axios.post(`/api/users/${userId}/collect/resume`);
      return res.data;
    },
    onSuccess: (data) => {
      setCollectionMessage({
        type: 'success',
        text: `Collection resumed from ${data.previousItems} items`
      });
      queryClient.invalidateQueries(['collectionStatus', userId]);

      // Poll for collection status (same as regular collection)
      const pollInterval = setInterval(async () => {
        try {
          const statusRes = await axios.get(`/api/users/${userId}/collection-status`);
          const latestCollection = statusRes.data[0];

          if (latestCollection?.status === 'completed') {
            clearInterval(pollInterval);
            setCollectionMessage({
              type: 'success',
              text: `Collected ${latestCollection.itemsCollected} tweets!`
            });
            queryClient.invalidateQueries(['tweets', userId]);
            queryClient.invalidateQueries(['tweetStats', userId]);
            queryClient.invalidateQueries(['collectionStatus', userId]);
            setTimeout(() => setCollectionMessage(null), 5000);
          } else if (latestCollection?.status === 'failed') {
            clearInterval(pollInterval);
            setCollectionMessage({
              type: 'error',
              text: 'Collection failed: ' + (latestCollection.errorMessage || 'Unknown error')
            });
            setTimeout(() => setCollectionMessage(null), 5000);
          }
        } catch (error) {
          clearInterval(pollInterval);
        }
      }, 2000);

      // Clear after 30 seconds
      setTimeout(() => {
        clearInterval(pollInterval);
        setCollectionMessage(null);
      }, 30000);
    },
    onError: (error) => {
      setCollectionMessage({
        type: 'error',
        text: error.response?.data?.error || 'Failed to resume collection'
      });
      setTimeout(() => setCollectionMessage(null), 5000);
    }
  });

  // Clear interrupted collection mutation
  const clearInterruptedMutation = useMutation({
    mutationFn: async () => {
      const res = await axios.delete(`/api/users/${userId}/collect/interrupted`);
      return res.data;
    },
    onSuccess: async (data) => {
      setCollectionMessage({
        type: 'success',
        text: `Dismissed ${data.cleared} interrupted collection(s)`
      });
      await queryClient.invalidateQueries(['collectionStatus', userId]);
      await refetchCollectionStatus();
      setTimeout(() => setCollectionMessage(null), 3000);
    },
    onError: (error) => {
      setCollectionMessage({
        type: 'error',
        text: error.response?.data?.error || 'Failed to dismiss interrupted collection'
      });
      setTimeout(() => setCollectionMessage(null), 5000);
    }
  });

  // Sorting functions
  const sortUsers = (users, sortType) => {
    if (!users || users.length === 0) return users;

    const sorted = [...users];

    switch (sortType) {
      case 'followers':
        return sorted.sort((a, b) =>
          (b.public_metrics?.followers_count || 0) - (a.public_metrics?.followers_count || 0)
        );
      case 'alphabetical':
        return sorted.sort((a, b) =>
          a.username.toLowerCase().localeCompare(b.username.toLowerCase())
        );
      case 'tweets':
        return sorted.sort((a, b) =>
          (b.public_metrics?.tweet_count || 0) - (a.public_metrics?.tweet_count || 0)
        );
      case 'oldest':
        return sorted.reverse();
      case 'recent':
      default:
        return sorted; // Keep original order (most recent from API)
    }
  };

  const sortedFollowers = sortUsers(followers, followerSort);
  const sortedBlocked = sortUsers(blocked, blockedSort);

  if (!user) return null;

  return (
    <div className="flex-shrink-0 w-96 border-r border-x-border flex flex-col">
      {/* Header */}
      <div className="p-4 border-b border-x-border bg-x-dark">
        <div className="flex items-start justify-between mb-3">
          <div className="flex items-center space-x-3">
            {user.profileImageUrl && (
              <img
                src={user.profileImageUrl}
                alt={user.displayName}
                className="w-12 h-12 rounded-full"
              />
            )}
            <div>
              <h3 className="font-bold">{user.displayName}</h3>
              <p className="text-sm text-x-gray">@{user.username}</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1 hover:bg-x-border rounded transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Stats */}
        <div className="flex justify-between text-sm text-x-gray mb-3">
          <span>{user.followersCount} followers</span>
          <span>{stats?.totalTweets || 0} tweets</span>
          <span>{stats?.withEmbeddings || 0} embedded</span>
        </div>

        {/* Onboarding Quick Start */}
        {stats?.totalTweets === 0 && !onboardingMutation.isPending && !onboardingStatus && (
          <div className="p-4 mb-3 rounded-lg bg-gradient-to-r from-blue-900/30 to-purple-900/30 border border-blue-500/30">
            <div className="flex items-start justify-between mb-2">
              <div className="flex-1">
                <div className="flex items-center text-blue-300 font-semibold mb-1">
                  <Rocket className="w-5 h-5 mr-2" />
                  Quick Start Onboarding
                </div>
                <p className="text-xs text-gray-300 leading-relaxed">
                  Automatically collect tweets, generate embeddings, create AI dossier, find relevant searches, and generate LIVE timeline.
                </p>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <select
                value={collectAmount}
                onChange={(e) => setCollectAmount(e.target.value === 'all' ? 'all' : parseInt(e.target.value))}
                className="bg-x-dark border border-x-border rounded px-2 py-2 text-sm text-white focus:outline-none focus:border-blue-500"
              >
                <option value={100}>100 tweets</option>
                <option value={500}>500 tweets</option>
                <option value={1000}>1,000 tweets</option>
                <option value={5000}>5,000 tweets</option>
                <option value="all">All tweets</option>
              </select>
              <button
                onClick={() => onboardingMutation.mutate(collectAmount === 'all' ? undefined : collectAmount)}
                className="flex-1 bg-blue-600 hover:bg-blue-500 text-white font-medium py-2 px-4 rounded-lg transition-colors flex items-center justify-center"
              >
                <Rocket className="w-4 h-4 mr-2" />
                Start
              </button>
            </div>
          </div>
        )}

        {/* Resume Incomplete Onboarding */}
        {stats?.totalTweets > 0 && (!user.embedding || !savedSearches?.hasSearches) && !onboardingMutation.isPending && !onboardingStatus && !dismissedIncomplete && (
          <div className="p-3 mb-3 rounded-lg bg-gradient-to-r from-orange-900/30 to-yellow-900/30 border border-orange-500/30">
            <div className="flex items-start justify-between mb-2">
              <div className="flex-1">
                <div className="flex items-center text-orange-300 font-semibold mb-1 text-sm">
                  <AlertCircle className="w-4 h-4 mr-2" />
                  Incomplete Setup
                </div>
                <p className="text-xs text-gray-300 leading-relaxed">
                  {!user.embedding && 'Missing embeddings. '}
                  {!savedSearches?.hasSearches && 'Missing search suggestions. '}
                  Complete setup to unlock all features.
                </p>
              </div>
              <button
                onClick={() => setDismissedIncomplete(true)}
                className="text-gray-500 hover:text-gray-300 ml-2"
                title="Dismiss"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <button
              onClick={() => onboardingMutation.mutate()}
              className="w-full bg-orange-600 hover:bg-orange-500 text-white font-medium py-1.5 px-3 rounded-lg transition-colors flex items-center justify-center text-sm"
            >
              <PlayCircle className="w-4 h-4 mr-2" />
              Resume Onboarding
            </button>
          </div>
        )}

        {/* Interrupted Collection Notice */}
        {interruptedCollection && !runningCollection && (
          <div className="p-3 mb-3 rounded bg-yellow-900/20 border border-yellow-600/30">
            <div className="flex items-start justify-between">
              <div className="flex-1">
                <div className="flex items-center text-yellow-400 text-sm font-medium mb-1">
                  <AlertCircle className="w-4 h-4 mr-2" />
                  Collection Interrupted
                </div>
                <p className="text-xs text-yellow-400/80">
                  {interruptedCollection.itemsCollected} tweets collected before interruption
                </p>
              </div>
              <button
                onClick={() => clearInterruptedMutation.mutate()}
                disabled={clearInterruptedMutation.isPending}
                className="text-gray-500 hover:text-gray-300 ml-2"
                title="Dismiss"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="flex space-x-2 mt-2">
              <button
                onClick={() => resumeCollectionMutation.mutate()}
                disabled={resumeCollectionMutation.isPending}
                className="flex-1 btn-secondary text-xs py-1.5"
              >
                <PlayCircle className="w-3 h-3 inline mr-1" />
                {resumeCollectionMutation.isPending ? 'Resuming...' : 'Resume'}
              </button>
              <button
                onClick={() => clearInterruptedMutation.mutate()}
                disabled={clearInterruptedMutation.isPending}
                className="flex-1 btn-secondary text-xs py-1.5"
              >
                <Trash2 className="w-3 h-3 inline mr-1" />
                {clearInterruptedMutation.isPending ? 'Clearing...' : 'Dismiss'}
              </button>
            </div>
          </div>
        )}

        {/* Collection Message */}
        {collectionMessage && (
          <div className={`p-2 mb-3 rounded text-sm flex items-center ${
            collectionMessage.type === 'success' ? 'bg-green-900/20 text-green-400' : 'bg-red-900/20 text-red-400'
          }`}>
            {collectionMessage.type === 'success' ? (
              <CheckCircle className="w-4 h-4 mr-2" />
            ) : (
              <AlertCircle className="w-4 h-4 mr-2" />
            )}
            {collectionMessage.text}
          </div>
        )}

        {/* Embedding Message */}
        {embeddingMessage && (
          <div className={`p-2 mb-3 rounded text-sm flex items-center ${
            embeddingMessage.type === 'success' ? 'bg-blue-900/20 text-blue-400' : 'bg-red-900/20 text-red-400'
          }`}>
            {embeddingMessage.type === 'success' ? (
              <Zap className="w-4 h-4 mr-2" />
            ) : (
              <AlertCircle className="w-4 h-4 mr-2" />
            )}
            {embeddingMessage.text}
          </div>
        )}

        {/* Actions - Collapsible */}
        <div className="border-t border-x-border">
          <button
            onClick={() => setShowActions(!showActions)}
            className="w-full p-2 flex items-center justify-center gap-2 text-xs text-gray-400 hover:text-white hover:bg-x-border transition-colors"
          >
            {showActions ? (
              <>
                <ChevronUp className="w-4 h-4" />
                Hide Actions
              </>
            ) : (
              <>
                <ChevronDown className="w-4 h-4" />
                Show Actions
              </>
            )}
          </button>

          {showActions && (
            <div className="p-3 grid grid-cols-2 gap-2 border-t border-x-border">
              <div className="relative">
                <div className="flex">
                  <button
                    onClick={() => collectMutation.mutate(collectAmount === 'all' ? undefined : collectAmount)}
                    disabled={collectMutation.isPending || runningCollection}
                    className="btn-primary text-xs p-2 flex-1 rounded-r-none"
                    title={runningCollection ? 'Collection already in progress' : `Collect ${collectAmount === 'all' ? 'all' : collectAmount} tweets`}
                  >
                    <Download className="w-3 h-3 inline mr-1" />
                    {collectAmount === 'all' ? 'All' : collectAmount}
                  </button>
                  <button
                    onClick={() => setShowCollectDropdown(!showCollectDropdown)}
                    disabled={collectMutation.isPending || runningCollection}
                    className="btn-primary text-xs px-1.5 rounded-l-none border-l border-blue-400/30"
                  >
                    <ChevronDown className="w-3 h-3" />
                  </button>
                </div>
                {showCollectDropdown && (
                  <div className="absolute top-full left-0 right-0 mt-1 bg-x-dark border border-x-border rounded shadow-lg z-10">
                    {[100, 500, 1000, 5000, 'all'].map(amount => (
                      <button
                        key={amount}
                        onClick={() => { setCollectAmount(amount === 'all' ? 'all' : amount); setShowCollectDropdown(false); }}
                        className={`w-full text-left text-xs px-3 py-1.5 hover:bg-x-border transition-colors ${collectAmount === amount ? 'text-blue-400' : 'text-gray-300'}`}
                      >
                        {amount === 'all' ? 'All tweets' : `${amount.toLocaleString()} tweets`}
                      </button>
                    ))}
                  </div>
                )}
              </div>
              <button
                onClick={() => embeddingMutation.mutate()}
                disabled={embeddingMutation.isPending}
                className="btn-secondary text-xs p-2"
              >
                <Zap className="w-3 h-3 inline mr-1" />
                Embed
              </button>
              <button
                onClick={() => getFollowersMutation.mutate(500)}
                disabled={getFollowersMutation.isPending}
                className="btn-secondary text-xs p-2"
                title={getFollowersMutation.isPending ? 'Fetching...' : 'Fetch up to 500 followers'}
              >
                <Users className="w-3 h-3 inline mr-1" />
                {getFollowersMutation.isPending ? 'Fetching...' : 'Followers'}
              </button>
              <button
                onClick={() => dossierMutation.mutate({ regenerate: true })}
                disabled={dossierMutation.isPending}
                className="btn-secondary text-xs p-2"
                title={dossierMutation.isPending ? 'Generating...' : 'Regenerate deep CIA-style profile from tweets'}
              >
                <Brain className="w-3 h-3 inline mr-1" />
                {dossierMutation.isPending ? 'Generating...' : 'Dossier'}
              </button>
              <button
                onClick={() => similarMutation.mutate()}
                disabled={similarMutation.isPending}
                className="btn-secondary text-xs p-2"
                title={similarMutation.isPending ? 'Discovering...' : 'Find and auto-collect similar accounts (top 3)'}
              >
                <Users className="w-3 h-3 inline mr-1" />
                {similarMutation.isPending ? 'Discovering...' : 'Get Similar'}
              </button>
              <button
                onClick={() => searchesMutation.mutate()}
                disabled={searchesMutation.isPending}
                className="btn-secondary text-xs p-2"
                title={searchesMutation.isPending ? 'Finding...' : 'Get AI-suggested X searches for this user'}
              >
                <Search className="w-3 h-3 inline mr-1" />
                {searchesMutation.isPending ? 'Finding...' : 'Find Searches'}
              </button>
              <button
                onClick={() => liveTimelineMutation.mutate()}
                disabled={liveTimelineMutation.isPending || !savedSearches?.hasSearches}
                className="btn-primary text-xs p-2 col-span-2"
                title={!savedSearches?.hasSearches ? 'Generate searches first' : liveTimelineMutation.isPending ? 'Generating...' : 'Generate live timeline from saved searches (last 24h)'}
              >
                <Zap className="w-3 h-3 inline mr-1" />
                {liveTimelineMutation.isPending ? 'Generating LIVE...' : 'LIVE'}
              </button>
            </div>
          )}
        </div>
      </div>

      {/* Tabs */}
      <div className="flex overflow-x-auto border-b border-x-border bg-x-dark scrollbar-thin scrollbar-thumb-x-border scrollbar-track-transparent">
        <button
          className={`flex-shrink-0 px-4 py-3 text-sm font-medium whitespace-nowrap ${activeTab === 'tweets' ? 'border-b-2 border-blue-500 text-blue-400' : 'text-x-gray hover:text-white hover:border-b hover:border-gray-600'}`}
          onClick={() => setActiveTab('tweets')}
        >
          Tweets ({stats?.totalTweets || 0})
        </button>
        <button
          className={`flex-shrink-0 px-4 py-3 text-sm font-medium whitespace-nowrap ${activeTab === 'followers' ? 'border-b-2 border-blue-500 text-blue-400' : 'text-x-gray hover:text-white hover:border-b hover:border-gray-600'}`}
          onClick={() => setActiveTab('followers')}
        >
          Followers ({user?.followersCount?.toLocaleString() || 0})
        </button>
        <button
          className={`flex-shrink-0 px-4 py-3 text-sm font-medium whitespace-nowrap ${activeTab === 'dossier' ? 'border-b-2 border-blue-500 text-blue-400' : 'text-x-gray hover:text-white hover:border-b hover:border-gray-600'}`}
          onClick={() => {
            setActiveTab('dossier');
            if (!dossier) dossierMutation.mutate({ regenerate: false });
          }}
        >
          Dossier
        </button>
        <button
          className={`flex-shrink-0 px-4 py-3 text-sm font-medium whitespace-nowrap ${activeTab === 'searches' ? 'border-b-2 border-blue-500 text-blue-400' : 'text-x-gray hover:text-white hover:border-b hover:border-gray-600'}`}
          onClick={() => setActiveTab('searches')}
          title="AI-generated X search suggestions"
        >
          🔍 Searches ({savedSearches?.searches?.length || 0})
        </button>
        <button
          className={`flex-shrink-0 px-4 py-3 text-sm font-medium whitespace-nowrap ${activeTab === 'metrics' ? 'border-b-2 border-blue-500 text-blue-400' : 'text-x-gray hover:text-white hover:border-b hover:border-gray-600'}`}
          onClick={() => setActiveTab('metrics')}
          title="Tweet metrics dashboard with trends"
        >
          📊 Metrics
        </button>
        <button
          className={`flex-shrink-0 px-4 py-3 text-sm font-medium whitespace-nowrap ${activeTab === 'newline' ? 'border-b-2 border-blue-500 text-blue-400' : 'text-x-gray hover:text-white hover:border-b hover:border-gray-600'}`}
          onClick={() => setActiveTab('newline')}
          title="Live timeline from saved searches"
        >
          ⚡ Newline {liveTimelineData && `(${liveTimelineData.matchingTweets.length})`}
        </button>
      </div>

      {/* Content based on tab */}
      {activeTab === 'tweets' && (
        <>
          {/* Filter - only for tweets */}
          <div className="p-2 border-b border-x-border bg-x-dark">
            <div className="flex items-center justify-between">
              <label className="flex items-center space-x-2 text-sm">
                <input
                  type="checkbox"
                  checked={showReplies}
                  onChange={(e) => setShowReplies(e.target.checked)}
                  className="rounded"
                />
                <span>Include replies</span>
              </label>
              <div className="flex items-center gap-2">
                {selectedDate && (
                  <>
                    <span className="text-xs px-2 py-1 bg-blue-600 text-white rounded">
                      {new Date(selectedDate).toLocaleDateString()}
                    </span>
                    <button
                      onClick={() => setSelectedDate(null)}
                      className="text-xs px-2 py-1 bg-gray-600 text-white rounded hover:bg-gray-500"
                    >
                      Clear filter
                    </button>
                  </>
                )}
                <button
                  onClick={() => { setShowSearchBar(!showSearchBar); if (showSearchBar) clearSearch(); }}
                  className={`p-1 rounded transition-colors ${showSearchBar ? 'text-blue-400 bg-blue-400/10' : 'text-x-gray hover:text-white'}`}
                  title="Search tweets"
                >
                  <Search className="w-4 h-4" />
                </button>
              </div>
            </div>
            {showSearchBar && (
              <div className="mt-2 space-y-2">
                <div className="flex items-center gap-2">
                  <input
                    type="text"
                    value={searchQuery}
                    onChange={(e) => handleSearchChange(e.target.value)}
                    placeholder={searchMode === 'text' ? 'Filter by keyword...' : 'Semantic search...'}
                    className="flex-1 bg-x-dark border border-x-border rounded px-3 py-1.5 text-sm text-white placeholder-gray-500 focus:outline-none focus:border-x-gray"
                    autoFocus
                  />
                  {searchQuery && (
                    <button onClick={clearSearch} className="text-x-gray hover:text-white">
                      <X className="w-4 h-4" />
                    </button>
                  )}
                  {semanticSearchMutation.isPending && (
                    <div className="w-4 h-4 border-2 border-blue-400 border-t-transparent rounded-full animate-spin" />
                  )}
                </div>
                <div className="flex gap-1">
                  <button
                    onClick={() => handleSearchModeChange('text')}
                    className={`text-xs px-3 py-1 rounded-full transition-colors ${searchMode === 'text' ? 'bg-blue-600 text-white' : 'bg-x-bg text-x-gray hover:text-white border border-x-border'}`}
                  >
                    Text
                  </button>
                  <button
                    onClick={() => handleSearchModeChange('semantic')}
                    className={`text-xs px-3 py-1 rounded-full transition-colors ${searchMode === 'semantic' ? 'bg-purple-600 text-white' : 'bg-x-bg text-x-gray hover:text-white border border-x-border'}`}
                  >
                    Semantic
                  </button>
                </div>
              </div>
            )}
          </div>
          {/* Tweets List */}
          <div className="flex-1 overflow-y-auto">
            {(() => {
              // Start with semantic results or all tweets
              let displayTweets;
              if (searchMode === 'semantic' && semanticResults && searchQuery.trim()) {
                displayTweets = semanticResults.map(r => ({ ...r.tweet, _similarity: r.similarity }));
              } else {
                displayTweets = tweets || [];
              }

              // Apply text search filter
              if (searchMode === 'text' && searchQuery.trim()) {
                const q = searchQuery.toLowerCase();
                displayTweets = displayTweets.filter(t => t.content?.toLowerCase().includes(q));
              }

              // Apply date filter
              if (selectedDate) {
                displayTweets = displayTweets.filter(t => t.createdAt?.split('T')[0] === selectedDate);
              }

              if (displayTweets.length === 0) {
                return (
                  <div className="text-center py-8 text-gray-400">
                    <p>{searchQuery ? `No tweets found for "${searchQuery}"` : selectedDate ? `No tweets found for ${new Date(selectedDate).toLocaleDateString()}` : 'No tweets'}</p>
                    {selectedDate && (
                      <button
                        onClick={() => setSelectedDate(null)}
                        className="mt-2 text-xs px-3 py-1 bg-blue-600 text-white rounded hover:bg-blue-500"
                      >
                        Clear date filter
                      </button>
                    )}
                  </div>
                );
              }

              return displayTweets.map((tweet) => (
                <TweetCard key={tweet.id} tweet={tweet} username={user?.username} similarity={tweet._similarity} />
              ));
            })()}
          </div>
        </>
      )}
      {activeTab === 'followers' && (
        <div className="flex-1 overflow-y-auto p-4 space-y-2">
          {/* Sorting Dropdown */}
          {followers.length > 0 && (
            <div className="mb-3 flex items-center space-x-2">
              <label className="text-xs text-x-gray">Sort by:</label>
              <select
                value={followerSort}
                onChange={(e) => setFollowerSort(e.target.value)}
                className="bg-x-dark border border-x-border text-white text-xs rounded px-2 py-1 focus:outline-none focus:border-blue-500"
              >
                <option value="recent">Most Recent</option>
                <option value="followers">Most Followers</option>
                <option value="alphabetical">Alphabetical</option>
                <option value="tweets">Most Tweets</option>
                <option value="oldest">Oldest First</option>
              </select>
            </div>
          )}
          {getFollowersMutation.isPending ? (
            <div className="flex items-center justify-center h-full text-x-gray">
              <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-500 mr-3"></div>
              Fetching followers...
            </div>
          ) : followers.length === 0 ? (
            <div className="text-center py-8 text-x-gray">
              <Users className="w-12 h-12 mx-auto mb-4 opacity-50" />
              <p className="text-lg mb-3">
                {storedFollowersQuery.isLoading ? 'Loading stored followers...' : 'No followers loaded'}
              </p>
              {syncFollowersMutation.isPending ? (
                <div className="flex items-center justify-center gap-2 mb-3">
                  <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-green-500"></div>
                  <span className="text-sm text-green-400">Syncing follower IDs...</span>
                </div>
              ) : (
                <button
                  onClick={() => syncFollowersMutation.mutate()}
                  className="text-xs px-4 py-2 mb-3 bg-green-900/30 border border-green-700 rounded hover:border-green-500 hover:text-green-400 transition-colors"
                  title="Links existing DB records using X API follower IDs (very cheap — ~3 API calls)"
                >
                  Sync from X (cheap)
                </button>
              )}
              <p className="text-xs text-x-gray mb-2">Or fetch full profiles from X API:</p>
              <div className="flex items-center justify-center gap-2">
                {[100, 500, 1000].map(n => (
                  <button
                    key={n}
                    onClick={() => getFollowersMutation.mutate(n)}
                    className="text-xs px-3 py-1.5 bg-x-dark border border-x-border rounded hover:border-blue-500 hover:text-blue-400 transition-colors"
                  >
                    {n.toLocaleString()}
                  </button>
                ))}
                <button
                  onClick={() => getFollowersMutation.mutate(999999)}
                  className="text-xs px-3 py-1.5 bg-x-dark border border-x-border rounded hover:border-blue-500 hover:text-blue-400 transition-colors"
                >
                  All
                </button>
              </div>
            </div>
          ) : (
            <div className="space-y-2">
              {sortedFollowers.map((follower) => (
                <div key={follower.id} className="p-3 bg-x-dark/50 rounded-lg border border-x-border hover:border-x-blue hover:bg-x-blue/5 transition-colors cursor-pointer" onClick={() => window.open(`https://x.com/${follower.username}`, '_blank')}>
                  <div className="flex items-center space-x-3">
                    {follower.profile_image_url && (
                      <img 
                        src={follower.profile_image_url.replace('_normal', '_400x400')} 
                        alt={follower.name} 
                        className="w-12 h-12 rounded-full flex-shrink-0" 
                      />
                    )}
                    <div className="flex-1 min-w-0">
                      <a 
                        href={`https://x.com/${follower.username}`} 
                        target="_blank" 
                        rel="noopener noreferrer" 
                        className="font-semibold hover:text-x-blue block truncate"
                      >
                        {follower.name}
                      </a>
                      <p className="text-x-gray text-sm">@{follower.username}</p>
                      {follower.public_metrics && (
                        <p className="text-xs text-x-gray mt-1">
                          {follower.public_metrics.followers_count?.toLocaleString() || 0} followers • {follower.public_metrics.tweet_count?.toLocaleString() || 0} tweets
                        </p>
                      )}
                    </div>
                  </div>
                </div>
              ))}
              {followers.length > 0 && (
                <div className="p-3 text-center text-x-gray text-sm border-t border-x-border">
                  Loaded {followers.length} followers. <button className="text-x-blue hover:underline" onClick={() => getFollowersMutation.mutate()}>Refresh</button>
                </div>
              )}
            </div>
          )}
        </div>
      )}
      {activeTab === 'dossier' && (
        <div className="flex-1 flex flex-col overflow-hidden">
          {dossier && (
            <div className="p-3 border-b border-x-border flex justify-end">
              <button
                onClick={() => {
                  navigator.clipboard.writeText(dossier);
                  setDossierCopied(true);
                  setTimeout(() => setDossierCopied(false), 2000);
                }}
                className="btn-secondary text-xs p-2 flex items-center gap-1"
                title="Copy dossier to clipboard"
              >
                {dossierCopied ? (
                  <>
                    <Check className="w-3 h-3" />
                    Copied!
                  </>
                ) : (
                  <>
                    <Copy className="w-3 h-3" />
                    Copy
                  </>
                )}
              </button>
            </div>
          )}
          <div className="flex-1 overflow-y-auto p-4 prose prose-invert max-w-none">
            {dossierMutation.isPending ? (
              <div className="flex items-center justify-center h-full text-x-gray">
                <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-500 mr-3"></div>
                Generating deep profile dossier (analyzing up to 5000 tweets with Grok AI)...
              </div>
            ) : !dossier ? (
              <div className="text-center py-8 text-x-gray">
                <Brain className="w-12 h-12 mx-auto mb-4 opacity-50" />
                <p className="text-lg">No dossier generated</p>
                <p className="text-sm">Click the "Dossier" button or tab to create a CIA-style analysis from the user's tweets using Grok AI.</p>
              </div>
            ) : (
              <MarkdownRenderer content={dossier} />
            )}
          </div>
        </div>
      )}
      {activeTab === 'metrics' && (
        <div className="flex-1 flex flex-col min-h-0">
          <div className="p-4 border-b bg-black/20 flex items-center justify-between">
            <select 
              value={activeMetric} 
              onChange={(e) => setActiveMetric(e.target.value)} 
              className="bg-gray-800 text-white p-2 rounded border border-gray-600"
            >
              <option value="views">Views (Impressions)</option>
              <option value="likes">Likes</option>
              <option value="engagements">Engagements</option>
            </select>
            {metricsQuery.data && metricsQuery.data[activeMetric] && (
              <div className="text-sm text-gray-400 flex flex-col gap-1">
                <div className="flex items-center gap-3">
                  <span>Period: {metricsQuery.data.periodDays} days</span>
                  <span className={`px-2 py-1 rounded text-xs font-bold ${
                    metricsQuery.data[activeMetric].momentum.direction === 'up'
                      ? 'bg-green-600 text-white'
                      : metricsQuery.data[activeMetric].momentum.direction === 'down'
                      ? 'bg-red-600 text-white'
                      : 'bg-gray-600 text-white'
                  }`}>
                    {metricsQuery.data[activeMetric].momentum.direction === 'up' ? '↑' : metricsQuery.data[activeMetric].momentum.direction === 'down' ? '↓' : '→'}
                    {Math.abs(metricsQuery.data[activeMetric].momentum.change)}%
                  </span>
                  <span className={`px-2 py-1 rounded text-xs font-bold ${
                    metricsQuery.data[activeMetric].percentile.tier === 'top'
                      ? 'bg-purple-600 text-white'
                      : metricsQuery.data[activeMetric].percentile.tier === 'above median'
                      ? 'bg-blue-600 text-white'
                      : metricsQuery.data[activeMetric].percentile.tier === 'below median'
                      ? 'bg-orange-600 text-white'
                      : 'bg-gray-600 text-white'
                  }`}>
                    {metricsQuery.data[activeMetric].percentile.tier === 'top' ? 'Top 25%' :
                     metricsQuery.data[activeMetric].percentile.tier === 'bottom' ? 'Bottom 25%' :
                     metricsQuery.data[activeMetric].percentile.tier}
                  </span>
                </div>
              </div>
            )}
          </div>
          <div className="flex-1 p-4 overflow-hidden">
            {metricsQuery.isLoading ? (
              <div className="flex items-center justify-center h-full text-gray-500">
                <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-500 mr-3"></div>
                Loading metrics...
              </div>
            ) : !metricsQuery.data || !metricsQuery.data.dailyData?.length ? (
              <div className="text-center py-8 text-gray-500">
                <Zap className="w-12 h-12 mx-auto mb-4 opacity-50" />
                <p className="text-lg">No metrics data</p>
                <p className="text-sm">Collect tweets for this user to see trends, averages, and regression analysis.</p>
              </div>
            ) : (
              <ResponsiveContainer width="100%" height="100%">
                <LineChart
                  data={metricsQuery.data.dailyData}
                  margin={{ top: 5, right: 30, left: 0, bottom: 5 }}
                  onClick={(data) => {
                    if (data && data.activePayload && data.activePayload[0]) {
                      const clickedDate = data.activePayload[0].payload.date;
                      setSelectedDate(clickedDate);
                      setActiveTab('tweets');
                    }
                  }}
                >
                  <CartesianGrid strokeDasharray="3 3" stroke="#374151" />
                  <XAxis
                    dataKey="date"
                    stroke="#9ca3af"
                    tickFormatter={(date) => {
                      // Parse date string directly without timezone conversion
                      const [year, month, day] = date.split('-');
                      return `${month}/${day}/${year}`;
                    }}
                  />
                  <YAxis stroke="#9ca3af" />
                  <Tooltip
                    labelFormatter={(date) => {
                      // Parse date string directly without timezone conversion
                      const [year, month, day] = date.split('-');
                      return `${month}/${day}/${year}`;
                    }}
                    content={({ active, payload }) => {
                      if (active && payload && payload.length) {
                        const date = payload[0].payload.date;
                        const [year, month, day] = date.split('-');
                        return (
                          <div className="bg-gray-800 border border-gray-600 p-2 rounded text-xs">
                            <p className="text-white">{`${month}/${day}/${year}`}</p>
                            <p className="text-blue-400">{payload[0].name}: {payload[0].value.toLocaleString()}</p>
                            <p className="text-gray-400 text-[10px] mt-1">Click to view tweets</p>
                          </div>
                        );
                      }
                      return null;
                    }}
                  />
                  <Legend />
                  <Line
                    type="monotone"
                    dataKey={activeMetric}
                    stroke="#3b82f6"
                    name={activeMetric.charAt(0).toUpperCase() + activeMetric.slice(1)}
                    dot={{ r: 3, cursor: 'pointer' }}
                    activeDot={{ r: 6, cursor: 'pointer' }}
                  />
                  <ReferenceLine
                    y={metricsQuery.data.averages[`avgDaily${activeMetric.charAt(0).toUpperCase() + activeMetric.slice(1)}`]}
                    label="90-day Avg"
                    stroke="orange"
                    strokeDasharray="3 3"
                    strokeWidth={2}
                  />
                </LineChart>
              </ResponsiveContainer>
            )}
          </div>
        </div>
      )}

      {/* Searches Tab */}
      {activeTab === 'searches' && (
        <div className="flex-1 overflow-y-auto p-4">
          <div className="max-w-3xl mx-auto">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-bold">🔍 X Search Suggestions</h3>
              <button
                onClick={() => searchesMutation.mutate()}
                disabled={searchesMutation.isPending}
                className="btn-secondary text-xs px-3 py-1"
              >
                {searchesMutation.isPending ? 'Regenerating...' : 'Regenerate'}
              </button>
            </div>

            {savedSearches?.hasSearches ? (
              <>
                <p className="text-sm text-gray-400 mb-4">
                  AI-generated search queries to discover relevant content and accounts on X
                </p>
                <div className="space-y-2">
                  {savedSearches.searches.map((search, index) => (
                    <SearchItem key={index} search={search} />
                  ))}
                </div>
                <div className="mt-4 text-xs text-gray-500">
                  Last updated: {new Date(savedSearches.updatedAt).toLocaleString()}
                </div>
              </>
            ) : (
              <div className="text-center py-12">
                <Search className="w-12 h-12 text-gray-600 mx-auto mb-4" />
                <p className="text-gray-400 mb-4">No search suggestions yet</p>
                <button
                  onClick={() => searchesMutation.mutate()}
                  disabled={searchesMutation.isPending}
                  className="btn-primary px-4 py-2"
                >
                  {searchesMutation.isPending ? 'Generating...' : 'Generate Search Suggestions'}
                </button>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Newline Tab - Live Timeline */}
      {activeTab === 'newline' && (
        <div className="flex-1 overflow-y-auto p-4">
          {liveProgress && (
            <div className="mb-4 p-4 bg-blue-900/20 border border-blue-500 rounded">
              <div className="flex items-center justify-center mb-2">
                <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-blue-500 mr-3"></div>
                <span className="text-blue-400">{liveProgress.message}</span>
              </div>
            </div>
          )}

          {liveTimelineMutation.isPending ? (
            <div className="flex flex-col items-center justify-center h-full text-x-gray">
              <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-500 mb-4"></div>
              <p className="text-lg mb-2">Generating Live Timeline...</p>
              <p className="text-sm text-center max-w-md">
                Executing searches, generating embeddings, and comparing with your tweets
              </p>
            </div>
          ) : !liveTimelineData ? (
            <div className="text-center py-12">
              <Zap className="w-12 h-12 text-gray-600 mx-auto mb-4" />
              <p className="text-gray-400 mb-2">No live timeline generated yet</p>
              <p className="text-sm text-gray-500 mb-4">
                Click the LIVE button to generate a timeline from your saved searches
              </p>
              <button
                onClick={() => liveTimelineMutation.mutate()}
                disabled={!savedSearches?.hasSearches}
                className="btn-primary px-4 py-2"
              >
                {!savedSearches?.hasSearches ? 'Generate Searches First' : 'Generate LIVE Timeline'}
              </button>
            </div>
          ) : (
            <div>
              {/* Stats Header */}
              <div className="mb-4 p-4 bg-x-dark/50 rounded-lg border border-x-border">
                <h3 className="text-lg font-bold mb-2">⚡ Live Timeline Results</h3>
                <div className="grid grid-cols-3 gap-4 text-sm">
                  <div>
                    <div className="text-x-gray">Searches</div>
                    <div className="text-xl font-bold">{liveTimelineData.searchesExecuted}</div>
                  </div>
                  <div>
                    <div className="text-x-gray">Timeline Tweets</div>
                    <div className="text-xl font-bold">{liveTimelineData.timelineTweets}</div>
                  </div>
                  <div>
                    <div className="text-x-gray">Matches (≥60%)</div>
                    <div className="text-xl font-bold text-green-400">{liveTimelineData.matchingTweets.length}</div>
                  </div>
                </div>
                <div className="mt-2 text-xs text-gray-500">
                  Generated: {new Date(liveTimelineData.generatedAt).toLocaleString()}
                </div>
              </div>

              {/* Matching Tweets */}
              {liveTimelineData.matchingTweets.length === 0 ? (
                <div className="text-center py-8 text-gray-400">
                  <p>No tweets found with ≥60% similarity to your content</p>
                  <p className="text-sm mt-2">Try adjusting your search queries or check back later</p>
                </div>
              ) : (
                <div className="space-y-3">
                  {liveTimelineData.matchingTweets.map((match, index) => (
                    <div key={match.tweet.id} className="p-4 bg-x-dark/50 rounded-lg border border-x-border hover:border-green-500/50 transition-colors">
                      {/* Similarity Badge */}
                      <div className="flex items-center justify-between mb-2">
                        <span className={`text-xs px-2 py-1 rounded font-bold ${
                          match.score >= 80 ? 'bg-green-600 text-white' :
                          match.score >= 70 ? 'bg-blue-600 text-white' :
                          'bg-gray-600 text-white'
                        }`}>
                          {match.score}% Similar
                        </span>
                        <a
                          href={`https://x.com/${match.tweet.authorUsername}/status/${match.tweet.id}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-x-gray hover:text-x-blue transition-colors"
                        >
                          <ExternalLink className="w-4 h-4" />
                        </a>
                      </div>

                      {/* Tweet Content */}
                      <p className="text-sm whitespace-pre-wrap mb-2">{match.tweet.text}</p>

                      {/* Author Info */}
                      <div className="flex items-center text-xs text-x-gray mb-2">
                        <span className="font-medium">@{match.tweet.authorUsername}</span>
                        <span className="mx-2">•</span>
                        <span>{new Date(match.tweet.createdAt).toLocaleDateString()}</span>
                      </div>

                      {/* Matched Tweet Reference */}
                      <div className="mt-3 pt-3 border-t border-x-border">
                        <div className="text-xs text-gray-400 mb-1">Similar to your tweet:</div>
                        <div className="text-xs text-gray-300 italic line-clamp-2">
                          "{match.matchedWith.content}"
                        </div>
                        <div className="text-xs text-gray-500 mt-1">
                          {new Date(match.matchedWith.createdAt).toLocaleDateString()}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* Similar Accounts Modal */}
      {showSimilarModal && similarData && (
        <div key={`similar-${userId}-${similarData.targetUserId}`} className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
          <div className="bg-x-dark p-6 rounded-lg max-w-lg w-full max-h-[80vh] overflow-y-auto">
            <div className="flex justify-between items-center mb-4">
              <div>
                <h3 className="text-xl font-bold">Similar to @{user?.username}</h3>
                <p className="text-sm text-gray-400">
                  {similarData.topSimilar.length} accounts found
                  <span className="text-xs text-gray-500 ml-2">(userId: {userId})</span>
                </p>
              </div>
              <button onClick={() => setShowSimilarModal(false)} className="text-gray-400 hover:text-white">
                <X className="w-5 h-5" />
              </button>
            </div>
            <ul className="space-y-2">
              {similarData.topSimilar.map((s, index) => (
                <li key={s.user.id} className="p-3 bg-gray-800 rounded flex justify-between items-center">
                  <div className="flex-1">
                    <div className="font-medium">@{s.user.username}</div>
                    <div className="text-sm text-gray-400">{s.user.displayName}</div>
                    <div className="text-xs text-green-400 mt-1">Similarity: {s.user.score || s.score || Math.round((s.user.similarity || 0) * 100)}%</div>
                  </div>
                  <button
                    onClick={() => {
                      // Open profile column or add to store
                      useStore.getState().addUser(s.user.username);
                      setShowSimilarModal(false);
                    }}
                    className="bg-blue-500 hover:bg-blue-600 px-3 py-1 rounded text-sm flex-shrink-0"
                  >
                    View Profile
                  </button>
                </li>
              ))}
            </ul>
            {similarData.alerts > 0 && (
              <div className="mt-4 p-3 bg-yellow-500/20 border border-yellow-500 rounded text-yellow-100">
                ⚠️ {similarData.alerts} high-similarity matches – check logs for details
              </div>
            )}
            <button
              onClick={() => setShowSimilarModal(false)}
              className="mt-4 w-full bg-gray-600 hover:bg-gray-500 py-2 rounded"
            >
              Close
            </button>
          </div>
        </div>
      )}

      {/* Onboarding Progress Modal */}
      {showOnboardingModal && onboardingStatus && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
          <div className="bg-x-dark p-6 rounded-lg max-w-md w-full">
            <div className="flex justify-between items-center mb-4">
              <div>
                <h3 className="text-xl font-bold flex items-center">
                  <Rocket className="w-6 h-6 mr-2 text-blue-400" />
                  Onboarding @{user?.username}
                </h3>
                <p className="text-sm text-gray-400 mt-1">
                  {onboardingStatus.currentStep === 'completed' ? 'Completed!' :
                   onboardingStatus.currentStep === 'failed' ? 'Failed' :
                   'In Progress...'}
                </p>
              </div>
              {(onboardingStatus.currentStep === 'completed' || onboardingStatus.currentStep === 'failed') && (
                <button onClick={() => setShowOnboardingModal(false)} className="text-gray-400 hover:text-white">
                  <X className="w-5 h-5" />
                </button>
              )}
            </div>

            {/* Progress Bar */}
            <div className="mb-6">
              <div className="flex justify-between text-sm text-gray-400 mb-2">
                <span>Progress</span>
                <span>{onboardingStatus.progress || 0}%</span>
              </div>
              <div className="w-full bg-gray-700 rounded-full h-2">
                <div
                  className={`h-2 rounded-full transition-all duration-500 ${
                    onboardingStatus.currentStep === 'completed' ? 'bg-green-500' :
                    onboardingStatus.currentStep === 'failed' ? 'bg-red-500' :
                    'bg-blue-500'
                  }`}
                  style={{ width: `${onboardingStatus.progress || 0}%` }}
                />
              </div>
            </div>

            {/* Steps */}
            <div className="space-y-3">
              {onboardingStatus.steps && Object.entries(onboardingStatus.steps).map(([key, step]) => (
                <div key={key} className="flex items-center space-x-3">
                  <div className={`flex-shrink-0 w-6 h-6 rounded-full flex items-center justify-center ${
                    step.status === 'completed' ? 'bg-green-500' :
                    step.status === 'running' ? 'bg-blue-500 animate-pulse' :
                    step.status === 'failed' ? 'bg-red-500' :
                    step.status === 'skipped' ? 'bg-gray-600' :
                    'bg-gray-700'
                  }`}>
                    {step.status === 'completed' && <CheckCircle className="w-4 h-4" />}
                    {step.status === 'failed' && <AlertCircle className="w-4 h-4" />}
                    {step.status === 'running' && <div className="w-3 h-3 bg-white rounded-full" />}
                  </div>
                  <div className="flex-1">
                    <div className="text-sm font-medium capitalize">
                      {key.replace('_', ' ')}
                    </div>
                    {step.status === 'running' && (
                      <div className="text-xs text-gray-400">Processing...</div>
                    )}
                    {step.status === 'skipped' && (
                      <div className="text-xs text-gray-400">Skipped (already exists)</div>
                    )}
                    {step.error && (
                      <div className="text-xs text-red-400">{step.error}</div>
                    )}
                  </div>
                </div>
              ))}
            </div>

            {/* Error Message */}
            {onboardingStatus.error && (
              <div className="mt-4 p-3 bg-red-900/20 border border-red-500 rounded text-red-200 text-sm">
                <AlertCircle className="w-4 h-4 inline mr-2" />
                {onboardingStatus.error}
              </div>
            )}

            {/* Success Message */}
            {onboardingStatus.currentStep === 'completed' && (
              <div className="mt-4 p-3 bg-green-900/20 border border-green-500 rounded text-green-200 text-sm">
                <CheckCircle className="w-4 h-4 inline mr-2" />
                Onboarding completed successfully! All features are now ready to use.
              </div>
            )}

            {/* Close Button */}
            {(onboardingStatus.currentStep === 'completed' || onboardingStatus.currentStep === 'failed') && (
              <button
                onClick={() => {
                  setShowOnboardingModal(false);
                  userOnboardingService.clearStatus(userId);
                }}
                className="mt-4 w-full bg-gray-600 hover:bg-gray-500 py-2 rounded"
              >
                Close
              </button>
            )}
          </div>
        </div>
      )}

      {/* Suggested Searches Modal */}
      {showSearchesModal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
          <div className="bg-x-dark p-6 rounded-lg max-w-lg w-full max-h-[80vh] overflow-y-auto">
            <div className="flex justify-between items-center mb-4">
              <h3 className="text-xl font-bold">🔍 Suggested X Searches</h3>
              <button onClick={() => setShowSearchesModal(false)} className="text-gray-400 hover:text-white">
                <X className="w-5 h-5" />
              </button>
            </div>
            <p className="text-sm text-gray-400 mb-4">
              AI-generated search queries to help you discover relevant content and accounts on X
            </p>
            <ul className="space-y-2">
              {suggestedSearches.map((search, index) => (
                <li key={index}>
                  <SearchItem search={search} />
                </li>
              ))}
            </ul>
            {suggestedSearches.length === 0 && (
              <div className="text-center text-gray-400 py-8">
                No searches suggested yet
              </div>
            )}
            <button
              onClick={() => setShowSearchesModal(false)}
              className="mt-4 w-full bg-gray-600 hover:bg-gray-500 py-2 rounded"
            >
              Close
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function SearchItem({ search }) {
  const [copied, setCopied] = useState(false);
  const encodedQuery = encodeURIComponent(search);
  const searchUrl = `https://x.com/search?q=${encodedQuery}&src=typed_query&f=live`;

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(searchUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (err) {
      console.error('Failed to copy:', err);
    }
  };

  return (
    <div className="p-3 bg-x-bg-secondary rounded hover:bg-x-border transition-colors flex items-center justify-between gap-3">
      <span className="text-sm flex-1 break-words">{search}</span>
      <button
        onClick={handleCopy}
        className="flex-shrink-0 px-3 py-1 bg-x-border hover:bg-x-blue rounded text-xs transition-colors flex items-center gap-1"
        title="Copy search URL"
      >
        {copied ? (
          <>
            <Check className="w-3 h-3" />
            Copied
          </>
        ) : (
          <>
            <Copy className="w-3 h-3" />
            Copy
          </>
        )}
      </button>
    </div>
  );
}

function TweetCard({ tweet, username, similarity }) {
  const metrics = JSON.parse(tweet.metricsJson || '{}');
  const tweetUrl = username ? `https://x.com/${username}/status/${tweet.id}` : null;
  const [showLikers, setShowLikers] = useState(false);
  const [likers, setLikers] = useState(null);
  const [likersLoading, setLikersLoading] = useState(false);
  const [likersError, setLikersError] = useState(null);
  const [likersNextToken, setLikersNextToken] = useState(null);

  const fetchLikers = async (paginationToken = null) => {
    setLikersLoading(true);
    setLikersError(null);
    try {
      const params = paginationToken ? `?paginationToken=${paginationToken}` : '';
      const res = await axios.get(`/api/tweets/${tweet.id}/liking-users${params}`);
      if (paginationToken && likers) {
        setLikers([...likers, ...(res.data.data || [])]);
      } else {
        setLikers(res.data.data || []);
      }
      setLikersNextToken(res.data.nextToken || null);
    } catch (err) {
      const msg = err.response?.data?.error || err.message;
      setLikersError(msg);
    } finally {
      setLikersLoading(false);
    }
  };

  const handleLikeClick = () => {
    if (!showLikers && !likers) {
      fetchLikers();
    }
    setShowLikers(!showLikers);
  };

  return (
    <div className="p-4 border-b border-x-border hover:bg-x-dark transition-colors">
      <div className="flex justify-between items-start">
        <p className="text-sm whitespace-pre-wrap mb-2 flex-1">{tweet.content}</p>
        <div className="flex items-center gap-1 ml-2">
          {similarity != null && (
            <span className={`text-xs font-medium px-1.5 py-0.5 rounded ${
              similarity >= 0.8 ? 'bg-green-500/20 text-green-400' :
              similarity >= 0.6 ? 'bg-yellow-500/20 text-yellow-400' :
              'bg-orange-500/20 text-orange-400'
            }`}>
              {Math.round(similarity * 100)}%
            </span>
          )}
          {tweetUrl && (
            <a
              href={tweetUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="text-x-gray hover:text-x-blue transition-colors"
              title="View on X"
            >
              <ExternalLink className="w-4 h-4" />
            </a>
          )}
        </div>
      </div>
      <div className="flex items-center space-x-4 text-xs text-x-gray">
        <span>{new Date(tweet.createdAt).toLocaleDateString()}</span>
        {tweet.isReply && <span className="text-x-blue">Reply</span>}
        <span className="flex items-center font-medium text-blue-400">
          👁️ {(metrics.impression_count || 0).toLocaleString()}
        </span>
        <button
          onClick={handleLikeClick}
          className="flex items-center font-medium text-pink-400 hover:text-pink-300 hover:bg-pink-500/10 px-1.5 py-0.5 rounded transition-colors cursor-pointer"
          title="Click to see who liked this"
        >
          ❤️ {(metrics.like_count || 0).toLocaleString()}
          {showLikers ? <ChevronUp className="w-3 h-3 ml-1" /> : <ChevronDown className="w-3 h-3 ml-1" />}
        </button>
        {metrics.reply_count > 0 && (
          <span className="flex items-center">
            <MessageSquare className="w-3 h-3 mr-1" />
            {metrics.reply_count}
          </span>
        )}
        {tweet.embedding && (
          <Zap className="w-3 h-3 text-purple-500" />
        )}
      </div>

      {showLikers && (
        <div className="mt-3 p-3 bg-x-dark rounded-lg border border-x-border">
          <p className="text-xs font-semibold text-x-gray mb-2">
            <Users className="w-3 h-3 inline mr-1" />
            Liked by
          </p>

          {likersError && (
            <p className="text-xs text-red-400">{likersError}</p>
          )}

          {likers && likers.length === 0 && !likersLoading && (
            <p className="text-xs text-x-gray">No liking users found (may be private or too old)</p>
          )}

          {likers && likers.length > 0 && (
            <div className="space-y-2 max-h-60 overflow-y-auto">
              {likers.map((user) => (
                <div key={user.id} className="flex items-center gap-2">
                  {user.profile_image_url && (
                    <img
                      src={user.profile_image_url}
                      alt=""
                      className="w-6 h-6 rounded-full"
                    />
                  )}
                  <div className="min-w-0 flex-1">
                    <a
                      href={`https://x.com/${user.username}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-xs font-semibold hover:text-x-blue truncate block"
                    >
                      {user.name}
                    </a>
                    <span className="text-xs text-x-gray">@{user.username}</span>
                    {user.public_metrics && (
                      <span className="text-xs text-x-gray ml-2">
                        {user.public_metrics.followers_count?.toLocaleString()} followers
                      </span>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}

          {likersNextToken && !likersLoading && (
            <button
              onClick={() => fetchLikers(likersNextToken)}
              className="mt-2 text-xs text-x-blue hover:underline"
            >
              Load more...
            </button>
          )}

          {likersLoading && (
            <p className="text-xs text-x-gray animate-pulse">Loading liking users...</p>
          )}
        </div>
      )}
    </div>
  );
}