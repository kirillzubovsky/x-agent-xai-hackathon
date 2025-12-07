import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Header } from './components/Header';
import { UserColumn } from './components/UserColumn';
import { GrokPanel } from './components/GrokPanel';
import { AddUserModal } from './components/AddUserModal';
import { DebugPanel } from './components/DebugPanel';
import { useStore } from './store/useStore';
import { useResizable } from './hooks/useResizable';
import { Plus, X, GripVertical, Bug, ChevronLeft, ChevronRight, Maximize2, Minimize2 } from 'lucide-react';
import axios from 'axios';

function App() {
  const [showAddModal, setShowAddModal] = useState(false);
  const [showDebugPanel, setShowDebugPanel] = useState(false);
  const [grokPanelState, setGrokPanelState] = useState('collapsed'); // 'collapsed', 'normal', 'fullscreen'
  const { columns, addColumn, removeColumn } = useStore();
  const { width: grokPanelWidth, isResizing, startResizing } = useResizable(500, 300, 800);

  // Fetch API status
  const { data: apiStatus } = useQuery({
    queryKey: ['apiStatus'],
    queryFn: async () => {
      const res = await axios.get('/api/status');
      return res.data;
    },
    refetchInterval: 30000, // Refresh every 30 seconds
  });

  return (
    <div className="flex flex-col h-screen bg-black">
      <Header apiStatus={apiStatus} />

      <div className="flex flex-1 overflow-hidden relative">
        {/* User Columns Container */}
        <div
          className={`flex overflow-x-auto transition-all duration-300 ${
            grokPanelState === 'fullscreen' ? 'hidden' : ''
          }`}
          style={{
            width: grokPanelState === 'collapsed' ? '100%' : `calc(100% - ${grokPanelWidth}px)`
          }}
        >
          {/* User Columns */}
          {columns.map((column) => (
            <UserColumn
              key={column.id}
              columnId={column.id}
              userId={column.userId}
              onClose={() => removeColumn(column.id)}
            />
          ))}

          {/* Add Column Button */}
          <div className={`flex-shrink-0 border-r border-x-border transition-all duration-200 ${
            columns.length === 0 ? 'w-32 hover:w-48' : 'w-20 hover:w-32'
          }`}>
            <button
              onClick={() => setShowAddModal(true)}
              className="w-full h-full flex flex-col items-center justify-center text-x-gray hover:text-white transition-colors group"
            >
              <Plus className={`mb-2 transition-all ${
                columns.length === 0 ? 'w-12 h-12' : 'w-8 h-8 group-hover:w-10 group-hover:h-10'
              }`} />
              <span className={`transition-all ${
                columns.length === 0 ? 'text-lg' : 'text-xs group-hover:text-sm'
              }`}>
                {columns.length === 0 ? 'Add User' : 'Add'}
              </span>
            </button>
          </div>
        </div>

        {grokPanelState === 'normal' && (
          <>
            {/* Resize Handle */}
            <div
              className={`w-1 bg-x-border hover:bg-x-blue cursor-ew-resize flex items-center justify-center transition-colors ${
                isResizing ? 'bg-x-blue' : ''
              }`}
              onMouseDown={startResizing}
            >
              <GripVertical className="w-4 h-4 text-x-gray" />
            </div>

            {/* Grok Panel - Normal */}
            <div style={{ width: `${grokPanelWidth}px` }} className="flex relative">
              <div className="absolute top-4 left-2 z-10 flex gap-1">
                <button
                  onClick={() => setGrokPanelState('collapsed')}
                  className="p-1 bg-x-border hover:bg-x-blue rounded transition-colors"
                  title="Collapse panel"
                >
                  <ChevronRight className="w-4 h-4" />
                </button>
                <button
                  onClick={() => setGrokPanelState('fullscreen')}
                  className="p-1 bg-x-border hover:bg-x-blue rounded transition-colors"
                  title="Fullscreen"
                >
                  <Maximize2 className="w-4 h-4" />
                </button>
              </div>
              <GrokPanel columns={columns} />
            </div>
          </>
        )}

        {/* Fullscreen Panel */}
        {grokPanelState === 'fullscreen' && (
          <div className="absolute inset-0 z-20 bg-x-dark">
            <div className="absolute top-4 left-4 z-10 flex gap-1">
              <button
                onClick={() => setGrokPanelState('normal')}
                className="p-1 bg-x-border hover:bg-x-blue rounded transition-colors"
                title="Exit fullscreen"
              >
                <Minimize2 className="w-4 h-4" />
              </button>
              <button
                onClick={() => setGrokPanelState('collapsed')}
                className="p-1 bg-x-border hover:bg-x-blue rounded transition-colors"
                title="Collapse panel"
              >
                <ChevronRight className="w-4 h-4" />
              </button>
            </div>
            <GrokPanel columns={columns} />
          </div>
        )}

        {/* Collapsed Panel - Expand Button */}
        {grokPanelState === 'collapsed' && (
          <div className="w-12 bg-x-dark border-l border-x-border flex flex-col items-center justify-center">
            <button
              onClick={() => setGrokPanelState('normal')}
              className="p-2 bg-x-border hover:bg-x-blue rounded transition-colors rotate-180"
              title="Expand AI & Analysis panel"
              style={{ writingMode: 'vertical-rl' }}
            >
              <ChevronRight className="w-5 h-5" />
            </button>
          </div>
        )}
      </div>

      {/* Add User Modal */}
      {showAddModal && (
        <AddUserModal
          onClose={() => setShowAddModal(false)}
          onAdd={(user) => {
            addColumn(user.id, user.username);
            setShowAddModal(false);
          }}
        />
      )}

      {/* Debug Panel */}
      <DebugPanel isOpen={showDebugPanel} onClose={() => setShowDebugPanel(false)} />

      {/* Debug Button - Floating */}
      <button
        onClick={() => setShowDebugPanel(true)}
        className="fixed bottom-16 right-6 p-3 bg-x-bg-secondary border border-x-border rounded-lg hover:bg-x-border transition-all hover:scale-110 shadow-lg group z-40"
        title="Open Debug Panel (Request/Response Inspector)"
      >
        <Bug size={20} className="text-x-gray group-hover:text-x-white" />
      </button>
    </div>
  );
}

export default App;