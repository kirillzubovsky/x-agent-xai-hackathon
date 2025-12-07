import { useState, useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link2, Users, Loader, ChevronDown, ChevronRight, ExternalLink } from 'lucide-react';
import axios from 'axios';

export function SimilarityPanel({ columns }) {
  const [selectedPair, setSelectedPair] = useState(null);
  const [minSimilarity, setMinSimilarity] = useState(0.7);
  const [expandedPairs, setExpandedPairs] = useState(new Set());
  const [columnsWithUsernames, setColumnsWithUsernames] = useState([]);

  // Fetch usernames if missing
  useEffect(() => {
    const fetchMissingUsernames = async () => {
      const updatedColumns = await Promise.all(
        columns.map(async (col) => {
          if (!col.username) {
            try {
              const res = await axios.get(`/api/users/${col.userId}`);
              return { ...col, username: res.data.username };
            } catch (error) {
              return { ...col, username: 'Unknown' };
            }
          }
          return col;
        })
      );
      setColumnsWithUsernames(updatedColumns);
    };

    if (columns.length > 0) {
      fetchMissingUsernames();
    }
  }, [columns]);

  // Only enable when we have 2+ columns
  const canCompare = columnsWithUsernames.length >= 2;

  // Get similarity data when we have a pair selected
  const { data: similarities, isLoading } = useQuery({
    queryKey: ['similarities', selectedPair?.user1.id, selectedPair?.user2.id, minSimilarity],
    queryFn: async () => {
      const res = await axios.get(
        `/api/similarities/compare/users/${selectedPair.user1.id}/${selectedPair.user2.id}`,
        {
          params: { minSimilarity, limit: 50 }
        }
      );
      return res.data;
    },
    enabled: !!selectedPair,
  });

  const toggleExpanded = (index) => {
    const newExpanded = new Set(expandedPairs);
    if (newExpanded.has(index)) {
      newExpanded.delete(index);
    } else {
      newExpanded.add(index);
    }
    setExpandedPairs(newExpanded);
  };

  const formatSimilarity = (value) => {
    return `${(value * 100).toFixed(1)}%`;
  };

  return (
    <div className="bg-x-dark p-4 rounded-lg">
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center space-x-2">
          <Link2 className="w-5 h-5 text-purple-500" />
          <h3 className="font-bold">Tweet Similarities</h3>
        </div>

        {canCompare && (
          <div className="flex items-center space-x-2 text-sm">
            <label className="text-x-gray">Min similarity:</label>
            <select
              value={minSimilarity}
              onChange={(e) => setMinSimilarity(parseFloat(e.target.value))}
              className="bg-x-border px-2 py-1 rounded"
            >
              <option value="0.5">50%</option>
              <option value="0.6">60%</option>
              <option value="0.7">70%</option>
              <option value="0.8">80%</option>
              <option value="0.9">90%</option>
            </select>
          </div>
        )}
      </div>

      {!canCompare ? (
        <div className="text-center py-8 text-x-gray">
          <Users className="w-12 h-12 mx-auto mb-3 opacity-50" />
          <p>Add at least 2 users to compare their tweets</p>
        </div>
      ) : (
        <>
          {/* User Pair Selection */}
          <div className="mb-4">
            <div className="flex flex-wrap gap-2">
              {columnsWithUsernames.map((col1, i) =>
                columnsWithUsernames.slice(i + 1).map(col2 => (
                  <button
                    key={`${col1.userId}-${col2.userId}`}
                    onClick={() => setSelectedPair({
                      user1: { id: col1.userId, username: col1.username },
                      user2: { id: col2.userId, username: col2.username }
                    })}
                    className={`px-3 py-1 rounded text-sm transition-colors ${
                      selectedPair?.user1.id === col1.userId && selectedPair?.user2.id === col2.userId
                        ? 'bg-x-blue text-white'
                        : 'bg-x-border hover:bg-opacity-70'
                    }`}
                  >
                    @{col1.username} ↔ @{col2.username}
                  </button>
                ))
              )}
            </div>
          </div>

          {/* Results */}
          {selectedPair && (
            <div>
              {isLoading ? (
                <div className="flex items-center justify-center py-8">
                  <Loader className="w-6 h-6 animate-spin text-x-gray" />
                  <span className="ml-2 text-x-gray">Finding similar tweets...</span>
                </div>
              ) : similarities?.similarities?.length > 0 ? (
                <div className="space-y-2">
                  <p className="text-sm text-x-gray mb-3">
                    Found {similarities.totalFound} similar tweet pairs
                  </p>

                  {similarities.similarities.map((pair, index) => (
                    <div
                      key={index}
                      className="border border-x-border rounded-lg overflow-hidden"
                    >
                      {/* Header */}
                      <button
                        onClick={() => toggleExpanded(index)}
                        className="w-full px-3 py-2 flex items-center justify-between hover:bg-x-border transition-colors"
                      >
                        <div className="flex items-center space-x-3">
                          <span className={`text-sm font-bold ${
                            pair.similarity >= 0.9 ? 'text-green-400' :
                            pair.similarity >= 0.8 ? 'text-yellow-400' :
                            'text-orange-400'
                          }`}>
                            {formatSimilarity(pair.similarity)}
                          </span>
                          <span className="text-xs text-x-gray">
                            @{pair.tweet1.user.username} ↔ @{pair.tweet2.user.username}
                          </span>
                        </div>
                        {expandedPairs.has(index) ?
                          <ChevronDown className="w-4 h-4 text-x-gray" /> :
                          <ChevronRight className="w-4 h-4 text-x-gray" />
                        }
                      </button>

                      {/* Expanded Content */}
                      {expandedPairs.has(index) && (
                        <div className="px-3 py-2 border-t border-x-border space-y-3">
                          <div className="space-y-2">
                            <div className="p-2 bg-x-border rounded">
                              <div className="flex justify-between items-start mb-1">
                                <p className="text-xs text-x-gray">
                                  @{pair.tweet1.user.username} • {new Date(pair.tweet1.createdAt).toLocaleDateString()}
                                </p>
                                <a
                                  href={`https://x.com/${pair.tweet1.user.username}/status/${pair.tweet1.id}`}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  className="text-x-gray hover:text-x-blue transition-colors"
                                  title="View on X"
                                >
                                  <ExternalLink className="w-3 h-3" />
                                </a>
                              </div>
                              <p className="text-sm">{pair.tweet1.content}</p>
                            </div>

                            <div className="p-2 bg-x-border rounded">
                              <div className="flex justify-between items-start mb-1">
                                <p className="text-xs text-x-gray">
                                  @{pair.tweet2.user.username} • {new Date(pair.tweet2.createdAt).toLocaleDateString()}
                                </p>
                                <a
                                  href={`https://x.com/${pair.tweet2.user.username}/status/${pair.tweet2.id}`}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  className="text-x-gray hover:text-x-blue transition-colors"
                                  title="View on X"
                                >
                                  <ExternalLink className="w-3 h-3" />
                                </a>
                              </div>
                              <p className="text-sm">{pair.tweet2.content}</p>
                            </div>
                          </div>
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              ) : (
                <div className="text-center py-8 text-x-gray">
                  <p>No similar tweets found above {formatSimilarity(minSimilarity)} threshold</p>
                  <p className="text-xs mt-2">Try lowering the minimum similarity</p>
                </div>
              )}
            </div>
          )}

          {!selectedPair && (
            <div className="text-center py-8 text-x-gray">
              <p>Select a user pair above to compare their tweets</p>
            </div>
          )}
        </>
      )}
    </div>
  );
}