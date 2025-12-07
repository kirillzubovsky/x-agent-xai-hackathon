import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

export function MarkdownRenderer({ content }) {
  return (
    <div className="prose prose-invert prose-sm max-w-none break-words overflow-wrap-anywhere">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
        // Headings
        h1: ({ children }) => <h1 className="text-lg font-bold mb-2 mt-3">{children}</h1>,
        h2: ({ children }) => <h2 className="text-base font-bold mb-2 mt-3">{children}</h2>,
        h3: ({ children }) => <h3 className="text-sm font-bold mb-1 mt-2">{children}</h3>,

        // Paragraph
        p: ({ children }) => <p className="mb-2 text-sm break-words whitespace-pre-wrap">{children}</p>,

        // Lists
        ul: ({ children }) => <ul className="list-disc list-inside mb-2 space-y-1">{children}</ul>,
        ol: ({ children }) => <ol className="list-decimal list-inside mb-2 space-y-1">{children}</ol>,
        li: ({ children }) => <li className="text-sm">{children}</li>,

        // Code
        code: ({ inline, children }) => {
          if (inline) {
            return <code className="px-1 py-0.5 bg-x-border rounded text-xs">{children}</code>;
          }
          return (
            <pre className="bg-x-border rounded p-2 mb-2 overflow-x-auto">
              <code className="text-xs">{children}</code>
            </pre>
          );
        },

        // Blockquote
        blockquote: ({ children }) => (
          <blockquote className="border-l-2 border-x-gray pl-3 my-2 italic text-x-gray">
            {children}
          </blockquote>
        ),

        // Links
        a: ({ href, children }) => (
          <a
            href={href}
            target="_blank"
            rel="noopener noreferrer"
            className="text-x-blue hover:underline"
          >
            {children}
          </a>
        ),

        // Strong/Bold
        strong: ({ children }) => <strong className="font-bold">{children}</strong>,

        // Emphasis/Italic
        em: ({ children }) => <em className="italic">{children}</em>,

        // Horizontal Rule
        hr: () => <hr className="my-3 border-x-border" />,

        // Table
        table: ({ children }) => (
          <div className="overflow-x-auto mb-2">
            <table className="min-w-full text-sm">{children}</table>
          </div>
        ),
        thead: ({ children }) => <thead className="border-b border-x-border">{children}</thead>,
        tbody: ({ children }) => <tbody>{children}</tbody>,
        tr: ({ children }) => <tr className="border-b border-x-border">{children}</tr>,
        th: ({ children }) => <th className="px-2 py-1 text-left font-medium">{children}</th>,
        td: ({ children }) => <td className="px-2 py-1">{children}</td>,
      }}
      >
        {content}
      </ReactMarkdown>
    </div>
  );
}