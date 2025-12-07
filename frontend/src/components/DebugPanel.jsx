import { useState, useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import axios from 'axios';
import { ChevronRight, ChevronDown, X, RefreshCw, Trash2, Eye, EyeOff, Copy, Check } from 'lucide-react';

/**
 * Debug Panel for inspecting raw API requests and responses
 */
export function DebugPanel({ isOpen, onClose }) {
  const [selectedEntry, setSelectedEntry] = useState(null);
  const [expandedSections, setExpandedSections] = useState({
    request: true,
    response: true,
    metadata: false
  });
  const [showSensitive, setShowSensitive] = useState(false);
  const [copiedField, setCopiedField] = useState(null);
  const [autoRefresh, setAutoRefresh] = useState(false);

  // Fetch inspection data
  const { data: inspectionData, isLoading, error, refetch } = useQuery({
    queryKey: ['inspection', 'latest'],
    queryFn: async () => {
      const response = await axios.get('/api/inspection/latest?count=50');
      return response.data.data;
    },
    refetchInterval: autoRefresh ? 3000 : false,
    enabled: isOpen
  });

  // Fetch statistics
  const { data: stats } = useQuery({
    queryKey: ['inspection', 'stats'],
    queryFn: async () => {
      const response = await axios.get('/api/inspection/stats/summary');
      return response.data.stats;
    },
    enabled: isOpen
  });

  // Clear all inspection data
  const handleClear = async () => {
    if (!confirm('Are you sure you want to clear all inspection data?')) return;

    try {
      await axios.delete('/api/inspection/clear');
      refetch();
      setSelectedEntry(null);
    } catch (error) {
      console.error('Failed to clear inspection data:', error);
    }
  };

  // Copy to clipboard
  const copyToClipboard = async (text, fieldName) => {
    try {
      await navigator.clipboard.writeText(
        typeof text === 'object' ? JSON.stringify(text, null, 2) : text
      );
      setCopiedField(fieldName);
      setTimeout(() => setCopiedField(null), 2000);
    } catch (error) {
      console.error('Failed to copy:', error);
    }
  };

  // Toggle section expansion
  const toggleSection = (section) => {
    setExpandedSections(prev => ({
      ...prev,
      [section]: !prev[section]
    }));
  };

  // Format JSON for display
  const formatJSON = (data, indent = 0) => {
    if (!data) return 'null';
    if (typeof data !== 'object') return String(data);

    return (
      <pre className="text-xs font-mono whitespace-pre-wrap break-all">
        {JSON.stringify(data, null, 2)}
      </pre>
    );
  };

  // Render a collapsible section
  const renderSection = (title, content, key) => {
    const isExpanded = expandedSections[key];

    return (
      <div className="mb-4">
        <button
          onClick={() => toggleSection(key)}
          className="flex items-center gap-2 text-sm font-medium text-x-gray hover:text-x-white mb-2"
        >
          {isExpanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
          {title}
        </button>

        {isExpanded && (
          <div className="bg-x-bg rounded-lg border border-x-border p-3">
            {content}
          </div>
        )}
      </div>
    );
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex">
      {/* Overlay */}
      <div
        className="absolute inset-0 bg-black/50 backdrop-blur-sm"
        onClick={onClose}
      />

      {/* Panel */}
      <div className="relative ml-auto w-full max-w-4xl bg-x-bg-secondary border-l border-x-border flex flex-col h-full">
        {/* Header */}
        <div className="px-6 py-4 border-b border-x-border">
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-semibold">Request/Response Inspector</h2>
            <button
              onClick={onClose}
              className="p-2 hover:bg-x-bg rounded-lg transition-colors"
            >
              <X size={18} />
            </button>
          </div>

          {/* Stats */}
          {stats && (
            <div className="mt-3 flex gap-4 text-xs text-x-gray">
              <span>Total: {stats.total}</span>
              <span>Errors: {stats.errors}</span>
              {stats.avgDuration > 0 && <span>Avg: {stats.avgDuration}ms</span>}
            </div>
          )}

          {/* Controls */}
          <div className="mt-3 flex gap-2">
            <button
              onClick={refetch}
              className="px-3 py-1.5 bg-x-bg rounded-lg border border-x-border hover:bg-x-border text-sm flex items-center gap-2"
              disabled={isLoading}
            >
              <RefreshCw size={14} className={isLoading ? 'animate-spin' : ''} />
              Refresh
            </button>

            <button
              onClick={() => setAutoRefresh(!autoRefresh)}
              className={`px-3 py-1.5 rounded-lg border text-sm ${
                autoRefresh
                  ? 'bg-x-blue/20 border-x-blue text-x-blue'
                  : 'bg-x-bg border-x-border hover:bg-x-border'
              }`}
            >
              Auto-refresh: {autoRefresh ? 'ON' : 'OFF'}
            </button>

            <button
              onClick={() => setShowSensitive(!showSensitive)}
              className="px-3 py-1.5 bg-x-bg rounded-lg border border-x-border hover:bg-x-border text-sm flex items-center gap-2"
            >
              {showSensitive ? <EyeOff size={14} /> : <Eye size={14} />}
              {showSensitive ? 'Hide' : 'Show'} Sensitive
            </button>

            <button
              onClick={handleClear}
              className="px-3 py-1.5 bg-x-bg rounded-lg border border-x-border hover:bg-red-900/20 hover:border-red-800 text-sm flex items-center gap-2 ml-auto"
            >
              <Trash2 size={14} />
              Clear All
            </button>
          </div>
        </div>

        {/* Content */}
        <div className="flex-1 flex overflow-hidden">
          {/* List */}
          <div className="w-96 border-r border-x-border overflow-y-auto">
            {isLoading ? (
              <div className="p-4 text-center text-x-gray">Loading...</div>
            ) : error ? (
              <div className="p-4 text-center text-red-400">Error loading data</div>
            ) : inspectionData?.length === 0 ? (
              <div className="p-4 text-center text-x-gray">No inspection data yet</div>
            ) : (
              <div className="divide-y divide-x-border">
                {inspectionData?.map((entry) => (
                  <button
                    key={entry.id}
                    onClick={() => setSelectedEntry(entry)}
                    className={`w-full p-4 text-left hover:bg-x-bg transition-colors ${
                      selectedEntry?.id === entry.id ? 'bg-x-bg' : ''
                    }`}
                  >
                    <div className="flex items-start justify-between mb-1">
                      <div className="text-sm font-medium">
                        {entry.provider} - {entry.model}
                      </div>
                      {entry.response?.error && (
                        <span className="text-xs px-1.5 py-0.5 bg-red-900/20 text-red-400 rounded">
                          Error
                        </span>
                      )}
                    </div>

                    <div className="text-xs text-x-gray space-y-0.5">
                      <div>{new Date(entry.timestamp).toLocaleTimeString()}</div>
                      {entry.metadata?.duration && (
                        <div>{entry.metadata.duration}ms</div>
                      )}
                      {entry.metadata?.usage?.total_tokens && (
                        <div>{entry.metadata.usage.total_tokens} tokens</div>
                      )}
                    </div>

                    {entry.metadata?.userMessage && (
                      <div className="mt-2 text-xs text-x-gray line-clamp-2">
                        {entry.metadata.userMessage}
                      </div>
                    )}
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Details */}
          <div className="flex-1 overflow-y-auto p-6">
            {!selectedEntry ? (
              <div className="text-center text-x-gray mt-20">
                Select an entry to view details
              </div>
            ) : (
              <div>
                {/* Entry Header */}
                <div className="mb-6">
                  <div className="flex items-center gap-3 mb-2">
                    <h3 className="text-base font-medium">
                      {selectedEntry.provider} - {selectedEntry.model}
                    </h3>
                    {selectedEntry.response?.error && (
                      <span className="text-xs px-1.5 py-0.5 bg-red-900/20 text-red-400 rounded">
                        Error
                      </span>
                    )}
                  </div>
                  <div className="text-xs text-x-gray">
                    {new Date(selectedEntry.timestamp).toLocaleString()}
                  </div>
                </div>

                {/* Request Section */}
                {renderSection(
                  'Request',
                  <div className="space-y-3">
                    <div>
                      <div className="flex items-center justify-between mb-1">
                        <span className="text-xs text-x-gray">URL</span>
                        <button
                          onClick={() => copyToClipboard(selectedEntry.request?.url, 'url')}
                          className="p-1 hover:bg-x-border rounded"
                        >
                          {copiedField === 'url' ? (
                            <Check size={12} className="text-green-400" />
                          ) : (
                            <Copy size={12} />
                          )}
                        </button>
                      </div>
                      <code className="text-xs text-x-white">
                        {selectedEntry.request?.method} {selectedEntry.request?.url}
                      </code>
                    </div>

                    {selectedEntry.request?.headers && (
                      <div>
                        <div className="flex items-center justify-between mb-1">
                          <span className="text-xs text-x-gray">Headers</span>
                          <button
                            onClick={() => copyToClipboard(selectedEntry.request.headers, 'headers')}
                            className="p-1 hover:bg-x-border rounded"
                          >
                            {copiedField === 'headers' ? (
                              <Check size={12} className="text-green-400" />
                            ) : (
                              <Copy size={12} />
                            )}
                          </button>
                        </div>
                        {showSensitive ? (
                          formatJSON(selectedEntry.request.headers)
                        ) : (
                          <div className="text-xs text-x-gray italic">
                            Hidden (click "Show Sensitive" to reveal)
                          </div>
                        )}
                      </div>
                    )}

                    {selectedEntry.request?.body && (
                      <div>
                        <div className="flex items-center justify-between mb-1">
                          <span className="text-xs text-x-gray">Body</span>
                          <button
                            onClick={() => copyToClipboard(selectedEntry.request.body, 'body')}
                            className="p-1 hover:bg-x-border rounded"
                          >
                            {copiedField === 'body' ? (
                              <Check size={12} className="text-green-400" />
                            ) : (
                              <Copy size={12} />
                            )}
                          </button>
                        </div>
                        {formatJSON(selectedEntry.request.body)}
                      </div>
                    )}
                  </div>,
                  'request'
                )}

                {/* Response Section */}
                {renderSection(
                  'Response',
                  <div className="space-y-3">
                    {selectedEntry.response?.status && (
                      <div>
                        <span className="text-xs text-x-gray">Status: </span>
                        <span className={`text-xs ${
                          selectedEntry.response.status >= 200 && selectedEntry.response.status < 300
                            ? 'text-green-400'
                            : 'text-red-400'
                        }`}>
                          {selectedEntry.response.status} {selectedEntry.response.statusText}
                        </span>
                      </div>
                    )}

                    {selectedEntry.response?.error && (
                      <div>
                        <span className="text-xs text-x-gray">Error: </span>
                        <span className="text-xs text-red-400">
                          {selectedEntry.response.error}
                        </span>
                      </div>
                    )}

                    {selectedEntry.response?.data && (
                      <div>
                        <div className="flex items-center justify-between mb-1">
                          <span className="text-xs text-x-gray">Response Data</span>
                          <button
                            onClick={() => copyToClipboard(selectedEntry.response.data, 'response')}
                            className="p-1 hover:bg-x-border rounded"
                          >
                            {copiedField === 'response' ? (
                              <Check size={12} className="text-green-400" />
                            ) : (
                              <Copy size={12} />
                            )}
                          </button>
                        </div>
                        {formatJSON(selectedEntry.response.data)}
                      </div>
                    )}
                  </div>,
                  'response'
                )}

                {/* Metadata Section */}
                {renderSection(
                  'Metadata',
                  <div className="space-y-3">
                    {selectedEntry.metadata?.duration && (
                      <div>
                        <span className="text-xs text-x-gray">Duration: </span>
                        <span className="text-xs">{selectedEntry.metadata.duration}ms</span>
                      </div>
                    )}

                    {selectedEntry.metadata?.usage && (
                      <div>
                        <span className="text-xs text-x-gray">Token Usage:</span>
                        {formatJSON(selectedEntry.metadata.usage)}
                      </div>
                    )}

                    {selectedEntry.metadata?.context && (
                      <div>
                        <span className="text-xs text-x-gray">Context Info:</span>
                        {formatJSON(selectedEntry.metadata.context)}
                      </div>
                    )}

                    {selectedEntry.metadata?.userMessage && (
                      <div>
                        <span className="text-xs text-x-gray">User Message:</span>
                        <div className="mt-1 text-xs">{selectedEntry.metadata.userMessage}</div>
                      </div>
                    )}
                  </div>,
                  'metadata'
                )}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}