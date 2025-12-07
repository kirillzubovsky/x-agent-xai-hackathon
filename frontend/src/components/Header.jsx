import { Activity, Database, Settings, Zap } from 'lucide-react';

export function Header({ apiStatus }) {
  return (
    <header className="border-b border-x-border bg-x-dark">
      <div className="flex items-center justify-between px-4 py-3">
        <div className="flex items-center space-x-4">
          <h1 className="text-2xl font-bold">X-Agent</h1>
          <span className="text-x-gray text-sm">Advanced Twitter Analytics</span>
        </div>

        <div className="flex items-center space-x-6">
          {/* API Status */}
          <div className="flex items-center space-x-2">
            <Activity className={`w-4 h-4 ${apiStatus?.api?.success ? 'text-green-500' : 'text-yellow-500'}`} />
            <span className="text-sm text-x-gray">
              API: {apiStatus?.api?.success ? 'Connected' : 'Demo Mode'}
            </span>
          </div>

          {/* Database Stats */}
          <div className="flex items-center space-x-2">
            <Database className="w-4 h-4 text-x-blue" />
            <span className="text-sm text-x-gray">
              {apiStatus?.database?.tweets || 0} tweets
            </span>
          </div>

          {/* Embeddings */}
          <div className="flex items-center space-x-2">
            <Zap className="w-4 h-4 text-purple-500" />
            <span className="text-sm text-x-gray">
              {apiStatus?.database?.embeddings || 0} embeddings
            </span>
          </div>

          {/* Settings */}
          <button className="p-2 hover:bg-x-border rounded-lg transition-colors">
            <Settings className="w-5 h-5" />
          </button>
        </div>
      </div>
    </header>
  );
}
