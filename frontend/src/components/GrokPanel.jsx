import { useState, useEffect } from 'react';
import { useQuery, useMutation } from '@tanstack/react-query';
import { Send, Sparkles, RefreshCw, Cpu, Bot, Brain, Link2, MessageCircle, Image as ImageIcon, Download } from 'lucide-react';
import { useStore } from '../store/useStore';
import { MarkdownRenderer } from './MarkdownRenderer';
import { SimilarityPanel } from './SimilarityPanel';
import axios from 'axios';

export function GrokPanel({ columns }) {
  const [message, setMessage] = useState('');
  const [conversation, setConversation] = useState([]);
  const [activeTab, setActiveTab] = useState('chat'); // 'chat', 'similarity', or 'images'
  const { grokContext, updateGrokContext } = useStore();

  // Image generation states
  const [prompt, setPrompt] = useState('');
  const [editMode, setEditMode] = useState(false);
  const [editImageUrl, setEditImageUrl] = useState('');
  const [generatedImages, setGeneratedImages] = useState([]);
  const [selectedUserForEdit, setSelectedUserForEdit] = useState(null);

  // Get current AI provider info
  const { data: providerInfo } = useQuery({
    queryKey: ['aiProvider'],
    queryFn: async () => {
      const res = await axios.get('/api/grok/provider');
      return res.data;
    },
    refetchInterval: 30000, // Refresh every 30 seconds
  });

  // Get suggestions
  const { data: suggestions } = useQuery({
    queryKey: ['grokSuggestions', columns.map(c => c.userId)],
    queryFn: async () => {
      const userIds = columns.map(c => c.userId);
      const res = await axios.get('/api/grok/suggestions', {
        params: { userIds }
      });
      return res.data;
    },
    enabled: columns.length > 0,
  });

  // Fetch users for image editing options
  const { data: columnUsers = [] } = useQuery({
    queryKey: ['columnUsers', columns.map(c => c.userId)],
    queryFn: async () => {
      const promises = columns.map(c => axios.get(`/api/users/${c.userId}`));
      const responses = await Promise.all(promises);
      return responses.map(res => res.data);
    },
    enabled: columns.length > 0 && editMode,
    staleTime: 5 * 60 * 1000,
  });

  // Ask Grok mutation
  const askMutation = useMutation({
    mutationFn: async (message) => {
      const res = await axios.post('/api/grok/ask', {
        message,
        userIds: columns.map(c => c.userId),
        includeEmbeddings: grokContext.includeEmbeddings,
        includeFollowers: grokContext.includeFollowers,
      });
      return res.data;
    },
    onSuccess: (data) => {
      setConversation(prev => [
        ...prev,
        { role: 'user', content: message },
        {
          role: 'assistant',
          content: data.response,
          provider: data.provider,
          model: data.model,
          usage: data.usage
        }
      ]);
      setMessage('');
    },
  });

  // Image generation/editing mutation
  const imageMutation = useMutation({
    mutationFn: async (payload) => {
      const endpoint = payload.editMode ? '/api/grok/edit-image' : '/api/grok/generate-image';
      const body = { ...payload };
      delete body.editMode; // Not needed in request body
      const res = await axios.post(endpoint, body);
      return res.data;
    },
    onSuccess: (data) => {
      setGeneratedImages(prev => [...prev, ...data.images]);
      setPrompt('');
      if (editMode) setEditImageUrl('');
    },
    onError: (error) => {
      console.error('Image generation error:', error);
      // Could add toast notification here
    },
  });

  const handleSend = () => {
    if (message.trim() && !askMutation.isPending) {
      askMutation.mutate(message);
    }
  };

  const handleSelectUser = (user) => {
    setSelectedUserForEdit(user);
    setEditImageUrl(user?.profileImageUrl || '');
  };

  const handleImageGenerate = () => {
    if (!prompt.trim()) return;
    if (editMode && !editImageUrl.trim()) {
      alert('Please provide an image for editing (select user or enter URL)');
      return;
    }

    const payload = {
      prompt,
      options: {
        model: 'grok-imagine-v0p9',
        n: 1,
        response_format: 'url',
        ...(editMode ? {} : { quality: 'high' })
      },
      editMode
    };

    if (editMode) {
      payload.image = editImageUrl;
    }

    imageMutation.mutate(payload);
  };

  // Set default user for editing when mode changes
  useEffect(() => {
    if (editMode && columnUsers.length > 0 && !selectedUserForEdit && columnUsers[0]) {
      handleSelectUser(columnUsers[0]);
    }
  }, [editMode, columnUsers, selectedUserForEdit]);

  return (
    <div className="flex-1 bg-x-dark flex flex-col">
      {/* Header with Tabs */}
      <div className="p-4 border-b border-x-border">
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center space-x-2">
            <Sparkles className="w-5 h-5 text-purple-500" />
            <h3 className="font-bold text-lg">AI & Analysis</h3>
            {activeTab === 'chat' && providerInfo?.current && (
              <div className="flex items-center space-x-2 px-2 py-1 bg-x-border rounded-lg text-xs">
                {providerInfo.current.name === 'Grok' && <Bot className="w-3 h-3" />}
                {providerInfo.current.name === 'OpenAI' && <Brain className="w-3 h-3" />}
                {providerInfo.current.name === 'Ollama' && <Cpu className="w-3 h-3" />}
                <span className="text-x-gray">
                  {providerInfo.current.name} ({providerInfo.current.model})
                </span>
              </div>
            )}
          </div>
          <div className="text-sm text-x-gray">
            Analyzing {columns.length} user{columns.length !== 1 ? 's' : ''}
          </div>
        </div>

        {/* Tab Navigation */}
        <div className="flex space-x-2">
          <button
            onClick={() => setActiveTab('chat')}
            className={`flex items-center space-x-2 px-3 py-2 rounded transition-colors ${
              activeTab === 'chat'
                ? 'bg-x-blue text-white'
                : 'bg-x-border text-x-gray hover:text-white'
            }`}
          >
            <MessageCircle className="w-4 h-4" />
            <span className="text-sm">Chat</span>
          </button>
          <button
            onClick={() => setActiveTab('similarity')}
            className={`flex items-center space-x-2 px-3 py-2 rounded transition-colors ${
              activeTab === 'similarity'
                ? 'bg-x-blue text-white'
                : 'bg-x-border text-x-gray hover:text-white'
            }`}
          >
            <Link2 className="w-4 h-4" />
            <span className="text-sm">Similar Tweets</span>
            {columns.length >= 2 && (
              <span className="text-xs bg-x-dark px-1.5 py-0.5 rounded">
                {columns.length * (columns.length - 1) / 2}
              </span>
            )}
          </button>
          <button
            onClick={() => setActiveTab('images')}
            className={`flex items-center space-x-2 px-3 py-2 rounded transition-colors ${
              activeTab === 'images'
                ? 'bg-x-blue text-white'
                : 'bg-x-border text-x-gray hover:text-white'
            }`}
          >
            <ImageIcon className="w-4 h-4" />
            <span className="text-sm">Images</span>
            {generatedImages.length > 0 && (
              <span className="text-xs bg-green-500 text-white px-1.5 py-0.5 rounded">
                {generatedImages.length}
              </span>
            )}
          </button>
        </div>

        {/* Settings - Only show for chat tab */}
        {activeTab === 'chat' && (
          <div className="mt-3 space-y-2">
            <div className="flex items-center space-x-4">
              <label className="flex items-center space-x-2 text-sm">
                <input
                  type="checkbox"
                  checked={grokContext.includeEmbeddings}
                  onChange={(e) => updateGrokContext({ includeEmbeddings: e.target.checked })}
                  className="rounded"
                />
                <span>Include embeddings</span>
              </label>
              <label className="flex items-center space-x-2 text-sm">
                <input
                  type="checkbox"
                  checked={grokContext.includeFollowers}
                  onChange={(e) => updateGrokContext({ includeFollowers: e.target.checked })}
                  className="rounded"
                />
                <span>Include followers</span>
              </label>
            </div>

            {/* Available Providers Info */}
            {providerInfo?.available && providerInfo.available.length > 1 && (
              <div className="text-xs text-x-gray">
                Available providers: {providerInfo.available.map(p => p.name).join(', ')}
              </div>
            )}
          </div>
        )}
      </div>

      {/* Chat Tab Content */}
      {activeTab === 'chat' && (
        <>
          {/* Suggestions */}
          {false && suggestions && suggestions.length > 0 && conversation.length === 0 && (
            <div className="p-4 border-b border-x-border">
              <p className="text-sm text-x-gray mb-2">Suggested questions:</p>
              <div className="space-y-2">
                {suggestions.slice(0, 4).map((suggestion, i) => (
                  <button
                    key={i}
                    onClick={() => setMessage(suggestion)}
                    className="block w-full text-left text-sm p-2 rounded-lg bg-x-border hover:bg-opacity-50 transition-colors"
                  >
                    {suggestion}
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Conversation */}
          <div className="flex-1 overflow-y-auto p-4 min-h-0">
            {conversation.length === 0 ? (
              <div className="text-center text-x-gray mt-8">
                <Sparkles className="w-12 h-12 mx-auto mb-4 opacity-50" />
                <p>Ask questions about the loaded users and their content</p>
                {columns.length === 0 && (
                  <p className="text-sm mt-2">Add user columns to start analyzing</p>
                )}
              </div>
            ) : (
              <div className="space-y-4 pb-4">
                {conversation.map((msg, i) => (
                  <div
                    key={i}
                    className={`p-3 rounded-lg ${
                      msg.role === 'user'
                        ? 'bg-x-blue bg-opacity-20 ml-8'
                        : 'bg-x-border mr-8'
                    }`}
                  >
                    {msg.role === 'user' ? (
                      <p className="text-sm whitespace-pre-wrap break-words">{msg.content}</p>
                    ) : (
                      <div className="overflow-x-hidden break-words">
                        <MarkdownRenderer content={msg.content} />
                      </div>
                    )}
                    {msg.role === 'assistant' && msg.provider && (
                      <div className="mt-2 pt-2 border-t border-x-dark flex items-center justify-between text-xs text-x-gray">
                        <span>{msg.provider} ({msg.model})</span>
                        {msg.usage && (
                          <span>{msg.usage.total_tokens} tokens</span>
                        )}
                      </div>
                    )}
                  </div>
                ))}
                {askMutation.isPending && (
                  <div className="flex items-center space-x-2 text-x-gray">
                    <RefreshCw className="w-4 h-4 animate-spin" />
                    <span className="text-sm">Thinking...</span>
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Input */}
          <div className="p-4 border-t border-x-border">
            <div className="flex space-x-2">
              <input
                type="text"
                value={message}
                onChange={(e) => setMessage(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && handleSend()}
                placeholder={columns.length > 0 ? "Ask about the loaded users..." : "Add users first..."}
                disabled={columns.length === 0 || askMutation.isPending}
                className="flex-1 input"
              />
              <button
                onClick={handleSend}
                disabled={!message.trim() || columns.length === 0 || askMutation.isPending}
                className="btn-primary"
              >
                <Send className="w-5 h-5" />
              </button>
            </div>
          </div>
        </>
      )}

      {/* Similarity Tab Content */}
      {activeTab === 'similarity' && (
        <div className="flex-1 overflow-y-auto p-4">
          <SimilarityPanel columns={columns} />
        </div>
      )}

      {/* Images Tab Content */}
      {activeTab === 'images' && (
        <>
          {/* Images Form */}
          <div className="p-4 border-b border-x-border">
            <div className="mb-3">
              <label className="block text-sm font-medium mb-2">Image Prompt</label>
              <textarea
                value={prompt}
                onChange={(e) => setPrompt(e.target.value)}
                placeholder="Describe the image you want to generate or edit (e.g., 'a futuristic cityscape' or 'make this person an influencer')"
                className="w-full p-3 border border-x-border rounded-lg resize-none h-20 text-sm"
                disabled={imageMutation.isPending}
              />
            </div>

            <div className="flex items-center space-x-4 mb-3">
              <label className="flex items-center space-x-2">
                <input
                  type="checkbox"
                  checked={editMode}
                  onChange={(e) => {
                    setEditMode(e.target.checked);
                    if (!e.target.checked) {
                      setEditImageUrl('');
                      setSelectedUserForEdit(null);
                    }
                  }}
                  className="rounded"
                />
                <span className="text-sm">Edit existing image</span>
              </label>
            </div>

            {editMode && (
              <div className="space-y-2 mb-3">
                <label className="block text-sm font-medium">Select user profile to edit (or enter URL below)</label>
                {columnUsers.length > 0 ? (
                  <select
                    value={selectedUserForEdit?.id || ''}
                    onChange={(e) => {
                      const user = columnUsers.find(u => u.id === e.target.value);
                      handleSelectUser(user);
                    }}
                    className="w-full p-2 border border-x-border rounded"
                  >
                    <option value="">Choose user...</option>
                    {columnUsers.map(user => (
                      <option key={user.id} value={user.id}>
                        @{user.username} ({user.displayName})
                      </option>
                    ))}
                  </select>
                ) : (
                  <p className="text-xs text-x-gray">Add user columns to select profile images</p>
                )}
                <input
                  type="url"
                  value={editImageUrl}
                  onChange={(e) => setEditImageUrl(e.target.value)}
                  placeholder="Or enter image URL/base64 data URI"
                  className="w-full p-2 border border-x-border rounded text-sm"
                  disabled={imageMutation.isPending}
                />
              </div>
            )}

            <button
              onClick={handleImageGenerate}
              disabled={!prompt.trim() || (editMode && !editImageUrl) || imageMutation.isPending}
              className="btn-primary w-full"
            >
              {imageMutation.isPending ? (
                <>
                  <RefreshCw className="w-4 h-4 animate-spin mr-2 inline" />
                  Generating...
                </>
              ) : (
                `Generate ${editMode ? 'Edited ' : ''}Image`
              )}
            </button>
          </div>

          {/* Generated Images Gallery */}
          <div className="flex-1 overflow-y-auto p-4 space-y-4">
            {generatedImages.length === 0 ? (
              <div className="text-center text-x-gray mt-8">
                <ImageIcon className="w-12 h-12 mx-auto mb-4 opacity-50" />
                <p>Generate images using Grok Imagine API</p>
                <p className="text-sm mt-2 text-x-gray">Supports text-to-image and image editing</p>
                {columns.length === 0 && <p className="text-xs">Load users for easy profile editing</p>}
              </div>
            ) : (
              generatedImages.map((img, i) => (
                <div key={i} className="bg-x-dark border border-x-border rounded-lg p-4 shadow-md">
                  <img
                    src={img.url}
                    alt="Generated"
                    className="w-full max-h-64 object-contain rounded-lg mb-2 shadow-md border border-x-border dark:border-x-border/50"
                  />
                  {img.revised_prompt && (
                    <p className="text-sm text-white/80 mb-3 italic bg-x-dark/50 p-2 rounded border border-x-border/50">
                      Revised: {img.revised_prompt.substring(0, 100)}...
                    </p>
                  )}
                  <div className="flex justify-between items-center pt-2 border-t border-x-border/50">
                    <button
                      onClick={() => setGeneratedImages(prev => prev.filter((_, idx) => idx !== i))}
                      className="text-sm text-x-gray hover:text-white px-2 py-1 rounded transition-colors"
                    >
                      Delete
                    </button>
                    <a
                      href={img.url}
                      download={`generated-image-${i + 1}.png`}
                      className="flex items-center space-x-1 text-sm text-white hover:text-x-blue bg-x-border px-3 py-1 rounded transition-colors"
                    >
                      <Download className="w-4 h-4" />
                      <span>Download</span>
                    </a>
                  </div>
                </div>
              ))
            )}
          </div>
        </>
      )}
    </div>
  );
}
